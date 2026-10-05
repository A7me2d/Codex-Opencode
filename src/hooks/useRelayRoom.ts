import { useCallback, useEffect, useMemo, useState } from 'react'
import { config } from '../app/config'
import { api } from '../lib/api'
import { asArray } from '../lib/guards'
import { openCodeReviewPrompt } from '../lib/review'
import type { CodexThread, CodexStatus, OpenCodeSession, OpenCodeStatus, ProjectInfo, RelayEvent } from '../lib/types'
import { useAgentAlerts } from './useAgentAlerts'
import type { Notify } from './useAgentAlerts'
import { useConversation } from './useConversation'
import { usePolling } from './usePolling'

/**
 * The desk's top-level state: which conversations exist, which one is open,
 * how healthy each agent is, and the alerts that come out of all that.
 *
 * Conversation-scoped work lives in `useConversation`; this hook only decides
 * *which* conversation is current and keeps the shell honest.
 */
export function useRelayRoom() {
  const codexStatus = usePolling(api.codexStatus, Math.max(config.poll.codexStatusMs, 30_000))
  const openCodeStatus = usePolling(api.openCodeStatus, Math.max(config.poll.openCodeStatusMs, 30_000))
  const project = usePolling(api.project, config.poll.projectMs)
  const threadList = usePolling(api.threads, Math.max(config.poll.threadsMs, 30_000))
  const relayEvents = usePolling(api.relayEvents, Math.max(config.poll.relayEventsMs, 30_000))
  const models = usePolling(api.models, Math.max(config.poll.modelsMs, 300_000))
  const openCodeSessions = usePolling(api.openCodeSessions, Math.max(config.poll.sessionsMs, 30_000))

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [openingProject, setOpeningProject] = useState(false)
  const [choosingWorkRoot, setChoosingWorkRoot] = useState(false)
  /** Errors from the shell itself (create thread, open folder). */
  const [shellError, setShellError] = useState<string | null>(null)

  const threads = useMemo(() => {
    // Preserve the API's order while tolerating duplicate rollout records
    // from an older server that is still running during a frontend update.
    const seen = new Set<string>()
    return asArray<CodexThread>(threadList.data).filter((thread) => {
      if (seen.has(thread.id)) return false
      seen.add(thread.id)
      return true
    })
  }, [threadList.data])
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

  // The project sessions actually work in, which is often not where this app
  // is installed. Opening the wrong one was a real source of confusion.
  const openWorkRootFolder = useCallback(async () => {
    if (openingProject) return
    setOpeningProject(true)
    setShellError(null)
    try {
      await api.openWorkRoot()
    } catch (failure) {
      setShellError(failure instanceof Error ? failure.message : 'تعذر فتح مجلد المشروع.')
    } finally {
      setOpeningProject(false)
    }
  }, [openingProject])

  // Changing the work root is separate from opening it. The picker is native
  // so Ahmed chooses a real folder instead of having to type a Windows path.
  const chooseWorkRoot = useCallback(async () => {
    if (choosingWorkRoot) return
    setChoosingWorkRoot(true)
    setShellError(null)
    try {
      const result = await api.selectProjectFolder()
      if (result.changed) {
        await Promise.all([
          project.refresh(),
          codexStatus.refresh(),
          openCodeStatus.refresh(),
          threadList.refresh(),
          relayEvents.refresh(),
          openCodeSessions.refresh(),
        ])
        alerts.notify('تم اختيار مجلد المشروع', result.directory, 'openCode')
      }
    } catch (failure) {
      setShellError(failure instanceof Error ? failure.message : 'تعذر اختيار مجلد المشروع.')
    } finally {
      setChoosingWorkRoot(false)
    }
  }, [alerts.notify, choosingWorkRoot, codexStatus, openCodeSessions, openCodeStatus, project, relayEvents, threadList])

  const openThreadFolder = useCallback(async (threadId: string) => {
    setShellError(null)
    try {
      await api.openThreadFolder(threadId)
    } catch (failure) {
      setShellError(failure instanceof Error ? failure.message : 'تعذر فتح مجلد الجلسة.')
    }
  }, [])

  const reviewImplementation = useCallback(() => {
    conversation.composer.onSendText(openCodeReviewPrompt(conversation.view.handoff))
  }, [conversation.composer, conversation.view.handoff])

  const refreshEverything = useCallback(() => {
    void Promise.all([codexStatus.refresh(), openCodeStatus.refresh(), project.refresh(), threadList.refresh(), relayEvents.refresh(), openCodeSessions.refresh()])
  }, [codexStatus, openCodeStatus, project, relayEvents, threadList, openCodeSessions])

  const codex = codexStatus.data as CodexStatus | null
  const openCode = openCodeStatus.data as OpenCodeStatus | null

  return {
    alerts: { list: alerts.alerts, onDismiss: alerts.dismiss, notify: alerts.notify as Notify },
    conversation,
    codexConnected: Boolean(codex?.connected),
    codexError: codex?.error,
    openCodeOnline: Boolean(openCode?.online),
    projectDirectory: (project.data as ProjectInfo | null)?.directory,
    workRoot: (project.data as ProjectInfo | null)?.workRoot,
    threads,
    selectedId,
    events,
    creating,
    openingProject,
    choosingWorkRoot,
    shellError,
    models,
    openCodeSessions: asArray<OpenCodeSession>(openCodeSessions.data),
    onRefreshSessions: () => void openCodeSessions.refresh(),
    onCreateThread: () => void createThread(),
    onOpenProjectFolder: () => void openProjectFolder(),
    onOpenWorkRoot: () => void openWorkRootFolder(),
    onChooseWorkRoot: () => void chooseWorkRoot(),
    onOpenThreadFolder: openThreadFolder,
    onRefreshAll: refreshEverything,
    onSelectThread: setSelectedId,
    onReview: reviewImplementation,
  }
}
