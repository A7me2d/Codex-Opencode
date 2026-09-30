import { useCallback, useEffect, useMemo, useState } from 'react'
import { config } from '../app/config'
import { api } from '../lib/api'
import { asArray } from '../lib/guards'
import type { CodexThread, CodexStatus, OpenCodeStatus, ProjectInfo, RelayEvent } from '../lib/types'
import { useAgentAlerts } from './useAgentAlerts'
import type { Notify } from './useAgentAlerts'
import { useConversation } from './useConversation'
import { usePolling } from './usePolling'

/** The canned request behind "اطلب من Codex مراجعة التنفيذ". */
const reviewPrompt = 'راجع الآن آخر تنفيذ من OpenCode: افحص git diff، وشغّل الاختبار أو build أو lint المناسب إن أمكن، ثم اذكر النتيجة وما يحتاج تصحيحًا بدليل واضح.'

/**
 * The desk's top-level state: which conversations exist, which one is open,
 * how healthy each agent is, and the alerts that come out of all that.
 *
 * Conversation-scoped work lives in `useConversation`; this hook only decides
 * *which* conversation is current and keeps the shell honest.
 */
export function useRelayRoom() {
  const codexStatus = usePolling(api.codexStatus, config.poll.codexStatusMs)
  const openCodeStatus = usePolling(api.openCodeStatus, config.poll.openCodeStatusMs)
  const project = usePolling(api.project, config.poll.projectMs)
  const threadList = usePolling(api.threads, config.poll.threadsMs)
  const relayEvents = usePolling(api.relayEvents, config.poll.relayEventsMs)
  const models = usePolling(api.models, config.poll.modelsMs)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [openingProject, setOpeningProject] = useState(false)
  /** Errors from the shell itself (create thread, open folder). */
  const [shellError, setShellError] = useState<string | null>(null)

  const threads = useMemo(() => asArray<CodexThread>(threadList.data), [threadList.data])
  const events = useMemo(() => asArray<RelayEvent>(relayEvents.data), [relayEvents.data])

  // Open the most recent conversation on first load, then leave the choice alone.
  useEffect(() => {
    if (selectedId || threads.length === 0) return
    setSelectedId(threads[0].id)
  }, [selectedId, threads])

  const selectedThread = useMemo(() => threads.find((thread) => thread.id === selectedId) ?? null, [selectedId, threads])
  const conversation = useConversation(selectedThread)

  const alerts = useAgentAlerts({
    codexActive: conversation.turn.active,
    openCodeActive: Boolean(conversation.view.handoff?.active),
    questionCount: conversation.view.questions,
    subject: selectedThread?.title ?? selectedThread?.name ?? 'محادثة Codex',
    scope: selectedId ?? 'none',
  })

  const createThread = useCallback(async () => {
    if (creating || !codexStatus.data?.connected) return
    setCreating(true)
    setShellError(null)
    try {
      const created = await api.createThread('محادثة جديدة')
      setSelectedId(created.id)
      await threadList.refresh()
    } catch (failure) {
      setShellError(failure instanceof Error ? failure.message : 'تعذر إنشاء جلسة Codex.')
    } finally {
      setCreating(false)
    }
  }, [codexStatus.data?.connected, creating, threadList])

  const openProjectFolder = useCallback(async () => {
    if (openingProject) return
    setOpeningProject(true)
    setShellError(null)
    try {
      await api.openProjectFolder()
    } catch (failure) {
      setShellError(failure instanceof Error ? failure.message : 'تعذر فتح ملفات المشروع.')
    } finally {
      setOpeningProject(false)
    }
  }, [openingProject])

  const reviewImplementation = useCallback(() => {
    conversation.composer.onSendText(reviewPrompt)
  }, [conversation.composer])

  const refreshEverything = useCallback(() => {
    void Promise.all([codexStatus.refresh(), openCodeStatus.refresh(), project.refresh(), threadList.refresh(), relayEvents.refresh()])
  }, [codexStatus, openCodeStatus, project, relayEvents, threadList])

  const codex = codexStatus.data as CodexStatus | null
  const openCode = openCodeStatus.data as OpenCodeStatus | null

  return {
    alerts: { list: alerts.alerts, onDismiss: alerts.dismiss, notify: alerts.notify as Notify },
    conversation,
    codexConnected: Boolean(codex?.connected),
    codexError: codex?.error,
    openCodeOnline: Boolean(openCode?.online),
    projectDirectory: (project.data as ProjectInfo | null)?.directory,
    threads,
    selectedId,
    events,
    creating,
    openingProject,
    shellError,
    models,
    onCreateThread: () => void createThread(),
    onOpenProjectFolder: () => void openProjectFolder(),
    onRefreshAll: refreshEverything,
    onSelectThread: setSelectedId,
    onReview: reviewImplementation,
  }
}
