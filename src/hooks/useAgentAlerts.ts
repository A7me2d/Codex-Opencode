import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../app/config'

export type AlertTone = 'codex' | 'openCode' | 'question'

export interface AgentAlert {
  id: string
  tone: AlertTone
  title: string
  detail?: string
  /** A blocking question must not vanish on its own. */
  persistent: boolean
}

export interface AgentAlertInput {
  codexActive: boolean
  openCodeActive: boolean
  /** OpenCode questions currently waiting for an answer. */
  questionCount: number
  /** Conversation name, shown as the alert's second line. */
  subject: string
  /** Conversation id: switching conversations is not a finished turn. */
  scope: string
}

export type Notify = (title: string, detail?: string, tone?: AlertTone) => void

/** Fires an OS notification only when permission was already granted. */
function desktopNotify(title: string, body?: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  try {
    new Notification(title, { body, tag: 'relay-room' })
  } catch {
    // A blocked notification must never break the in-app alert.
  }
}

/**
 * Reports the two moments the composer cannot show on its own: a turn that
 * ended while the operator was typing, and a question that blocks the run.
 */
export function useAgentAlerts({ codexActive, openCodeActive, questionCount, subject, scope }: AgentAlertInput) {
  const [alerts, setAlerts] = useState<AgentAlert[]>([])
  const [unread, setUnread] = useState(0)
  const previous = useRef({ codexActive: false, openCodeActive: false, questionCount: 0, startedAt: 0, scope })

  const dismiss = useCallback((id: string) => {
    setAlerts((current) => current.filter((alert) => alert.id !== id))
  }, [])

  const push = useCallback((tone: AlertTone, title: string, detail?: string, persistent = false) => {
    setAlerts((current) => {
      if (current.some((alert) => alert.title === title && alert.detail === detail)) return current
      const next = [...current, { id: `${tone}-${Date.now()}-${current.length}`, tone, title, detail, persistent }]
      return next.length > config.maxAlerts ? next.slice(next.length - config.maxAlerts) : next
    })
    setUnread((count) => count + 1)
    desktopNotify(title, detail)
  }, [])

  const notify: Notify = useCallback((title, detail, tone = 'openCode') => push(tone, title, detail), [push])

  useEffect(() => {
    const before = previous.current
    const now = { codexActive, openCodeActive, questionCount, startedAt: before.startedAt, scope }

    if (before.scope !== scope) {
      // A different conversation: its history is not a turn that just ended here.
      if (codexActive) now.startedAt = Date.now()
      previous.current = now
      return
    }
    if (codexActive && !before.codexActive) now.startedAt = Date.now()
    if (before.codexActive && !codexActive && Date.now() - now.startedAt >= config.minimumTurnMs) {
      push('codex', 'Codex خلّص دوره', subject)
    }
    if (before.openCodeActive && !openCodeActive) {
      push('openCode', 'OpenCode خلّص شغله', subject)
    }
    if (questionCount > before.questionCount) {
      push('question', 'OpenCode ينتظر إجابتك', questionCount > 1 ? `${questionCount} أسئلة مفتوحة` : 'شوف السؤال في المسار الجانبي', true)
    }
    previous.current = now
  }, [codexActive, openCodeActive, push, questionCount, scope, subject])

  useEffect(() => {
    const dismissible = alerts.filter((alert) => !alert.persistent)
    if (dismissible.length === 0) return undefined
    const timers = dismissible.map((alert) => window.setTimeout(() => dismiss(alert.id), config.alertTimeoutMs))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [alerts, dismiss])

  // The tab title is the one signal that reaches a window in the background.
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${config.appTitle}` : config.appTitle
  }, [unread])

  useEffect(() => {
    const markSeen = () => setUnread(0)
    window.addEventListener('focus', markSeen)
    return () => window.removeEventListener('focus', markSeen)
  }, [])

  return { alerts, unread, dismiss, notify }
}
