import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { config } from '../app/config'
import { api } from '../lib/api'
import { readCodexChat } from '../lib/chat'
import { readForms } from '../lib/forms'
import type { ChatMessage, CodexThread, CodexTurnState, HandoffData } from '../lib/types'
import { usePolling } from './usePolling'

/** What the panes need to render one conversation. */
export interface ConversationView {
  thread: CodexThread | null
  messages: ChatMessage[]
  handoff: HandoffData | null
  questions: number
  loading: boolean
  busy: boolean
}

export interface ComposerState {
  draft: string
  queued: string | null
  /** Files waiting to travel with the next message. */
  queuedAttachments: string[]
  attachments: string[]
  sending: boolean
  attaching: boolean
  error: string | null
  onDraftChange: (value: string) => void
  onSend: () => void
  /** Send text directly, bypassing the draft box (e.g. a canned review request). */
  onSendText: (text: string) => void
  onQueue: () => void
  onCancelQueue: () => void
  onAttach: () => void
  onRemoveAttachment: (path: string) => void
  onStop: () => void
}

export interface ConversationController {
  view: ConversationView
  composer: ComposerState
  turn: CodexTurnState
  refreshHandoff: () => void
  model: OpenCodeModel
}

export interface OpenCodeModel {
  /** `providerID/modelID` in effect for this conversation. */
  current: string
  changing: boolean
  error: string | null
  onChange: (selector: string) => void
}

/** Draft text plus the file paths that will travel with it. */
function messageOf(draft: string, attachments: string[]) {
  return [draft.trim(), ...attachments].filter(Boolean).join('\n')
}

/**
 * State and actions for the selected Codex conversation.
 *
 * Everything polled here is scoped to one thread, so each request takes a
 * `resetKey` and drops the previous conversation's data on switch instead of
 * briefly showing one session's transcript under another's title.
 */
export function useConversation(thread: CodexThread | null): ConversationController {
  const threadId = thread?.id ?? null
  const scope = threadId ?? 'none'

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<{ threadId: string; text: string; attachments: string[] } | null>(null)
  const [modelChange, setModelChange] = useState<{ changing: boolean; error: string | null }>({ changing: false, error: null })

  const messages = usePolling(() => (threadId ? api.messages(threadId) : null), config.poll.codexMessagesMs, { resetKey: scope })
  const turnRequest = usePolling(() => (threadId ? api.turnState(threadId) : null), config.poll.turnStateMs, { resetKey: scope })
  const handoff = usePolling(() => (threadId ? api.handoff(threadId) : null), config.poll.handoffMs, { resetKey: scope })

  // The model is a property of the conversation: the server reports the one
  // the live OpenCode session really runs, and remembers it per thread.
  const currentModel = handoff.data?.model ?? ''

  const reported = turnRequest.data ?? { active: false }
  const turn = useMemo<CodexTurnState>(() => ({ ...reported, stopping: Boolean(reported.stopping || stopping) }), [reported, stopping])
  const busy = sending || turn.active

  // A parked message belongs to the conversation that typed it, never to the
  // next one, so the queue and the draft are cleared on every switch.
  const previousScope = useRef(scope)
  useEffect(() => {
    if (previousScope.current === scope) return
    previousScope.current = scope
    setDraft('')
    setAttachments([])
    setError(null)
    setQueued(null)
  }, [scope])

  const refreshAll = useCallback(async () => {
    await Promise.all([messages.refresh(), turnRequest.refresh(), handoff.refresh()])
  }, [handoff, messages, turnRequest])

  // `files` defaults to whatever is in the box, so a parked message re-sends
  // with exactly the files it was parked with.
  const send = useCallback(async (override?: string, files?: string[]) => {
    const attached = files ?? attachments
    const text = override ?? messageOf(draft, attached)
    if (!threadId || !text || sending || turn.active) return false
    setSending(true)
    setError(null)
    try {
      // The files are sent as paths as well as being part of the text: Codex
      // reads the text, and the server uses the paths to tell OpenCode which
      // files the work is about.
      await api.sendMessage(threadId, text, attached)
      if (override === undefined) { setDraft(''); setAttachments([]) }
      await refreshAll()
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر إرسال الرسالة إلى Codex.')
      return false
    } finally {
      setSending(false)
    }
  }, [attachments, draft, refreshAll, sending, threadId, turn.active])

  // While Codex works, the operator keeps typing and the send button parks the
  // text instead of dropping it.
  const park = useCallback(() => {
    const text = messageOf(draft, attachments)
    if (!threadId || !text) return
    setQueued({ threadId, text, attachments })
    setDraft('')
    setAttachments([])
  }, [attachments, draft, threadId])

  const cancelQueued = useCallback(() => setQueued(null), [])

  const parkedText = queued?.threadId === scope ? queued.text : null

  // The parked message leaves the instant the turn ends. Reading the parked
  // text from a ref (instead of a dependency) keeps this from re-running on
  // every keystroke.
  const parkedRef = useRef(parkedText)
  parkedRef.current = parkedText
  const parkedFiles = queued?.threadId === scope ? queued.attachments : null
  const parkedFilesRef = useRef(parkedFiles)
  parkedFilesRef.current = parkedFiles
  useEffect(() => {
    if (!parkedRef.current || turn.active || sending) return
    const text = parkedRef.current
    const files = parkedFilesRef.current ?? []
    setQueued(null)
    void send(text, files).then((delivered) => {
      // Never swallow what was typed: a failed hand-off goes back to the box.
      if (!delivered) {
        setDraft((current) => (current.trim() ? current : text))
        setAttachments((current) => (current.length > 0 ? current : files))
      }
    })
  }, [send, sending, turn.active])

  const stop = useCallback(async () => {
    if (!threadId || !turn.active || turn.stopping) return
    setStopping(true)
    setError(null)
    try {
      await api.stopTurn(threadId)
      await refreshAll()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر إيقاف Codex.')
    } finally {
      setStopping(false)
    }
  }, [refreshAll, threadId, turn.active, turn.stopping])

  const attachFile = useCallback(async () => {
    if (!threadId || attaching || busy) return
    setAttaching(true)
    setError(null)
    try {
      // Open the picker in the project this conversation works in.
      const selection = await api.selectProjectFile(thread?.directory)
      if (selection?.path) setAttachments((current) => (current.includes(selection.path) ? current : [...current, selection.path]))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر اختيار ملف من المشروع.')
    } finally {
      setAttaching(false)
    }
  }, [attaching, busy, thread?.directory, threadId])

  const removeAttachment = useCallback((path: string) => {
    setAttachments((current) => current.filter((entry) => entry !== path))
  }, [])

  /**
   * Point this conversation at a different OpenCode model.
   *
   * The server owns the truth: it records the choice, pushes it to the live
   * session, and answers with a readable reason when OpenCode refuses. The
   * handoff is re-read afterwards so the rail shows what the session really
   * runs rather than what was requested.
   */
  const changeModel = useCallback((selector: string) => {
    if (!threadId || !selector || selector === currentModel) return
    setModelChange({ changing: true, error: null })
    void api.setThreadModel(threadId, selector).then(async () => {
      setModelChange({ changing: false, error: null })
      await refreshAll()
    }).catch((failure: unknown) => {
      setModelChange({ changing: false, error: failure instanceof Error ? failure.message : 'تعذّر تغيير الموديل.' })
    })
  }, [currentModel, refreshAll, threadId])

  return {
    view: {
      busy,
      handoff: handoff.data,
      loading: messages.status === 'loading',
      messages: useMemo(() => readCodexChat(messages.data), [messages.data]),
      questions: useMemo(() => readForms(handoff.data?.forms).length, [handoff.data?.forms]),
      thread,
    },
    composer: {
      attaching,
      attachments,
      draft,
      error,
      onAttach: () => void attachFile(),
      onCancelQueue: cancelQueued,
      onDraftChange: setDraft,
      onQueue: park,
      onRemoveAttachment: removeAttachment,
      onSend: () => void send(),
      onSendText: (text: string) => void send(text),
      queued: parkedText,
      queuedAttachments: parkedFiles ?? [],
      sending,
      onStop: () => void stop(),
    },
    turn,
    refreshHandoff: () => void handoff.refresh(),
    model: {
      current: currentModel,
      changing: modelChange.changing,
      error: modelChange.error,
      onChange: changeModel,
    },
  }
}
