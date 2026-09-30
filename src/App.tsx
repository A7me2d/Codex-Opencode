import { useEffect, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AlertStack } from './features/alerts/AlertStack'
import { CodexConversation } from './features/codex/CodexConversation'
import { SessionList } from './features/codex/SessionList'
import { HandoffRail } from './features/opencode/HandoffRail'
import { useRelayRoom } from './hooks/useRelayRoom'

/** The default implementer: Zen's free Big Pickle. */
const defaultModel = 'opencode/big-pickle'
const modelStorageKey = 'relay-room:model'

/**
 * Relay Room — layout only.
 *
 * Every piece of state lives in `useRelayRoom`; every request is declared in
 * `src/lib/api.ts`; every screen is one file under `src/features`. This file
 * exists to say what sits where, and nothing else.
 */
export default function App() {
  const room = useRelayRoom()
  const { conversation } = room

  // The chosen OpenCode model is a desk preference, not a server setting: it
  // survives reloads and applies to every new handoff.
  const [model, setModel] = useState(() => localStorage.getItem(modelStorageKey) ?? defaultModel)
  useEffect(() => { localStorage.setItem(modelStorageKey, model) }, [model])

  return <div dir="rtl" className="flex min-h-screen flex-col bg-paper text-ink lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <AlertStack alerts={room.alerts.list} onDismiss={room.alerts.onDismiss} />

    <AppHeader
      codexConnected={room.codexConnected}
      openCodeOnline={room.openCodeOnline}
      codexError={room.codexError}
      shellError={room.shellError}
      onRefresh={room.onRefreshAll}
    />

    {/*
      Three columns, one scroll region each. `dir="ltr"` keeps the source order
      left-to-right (sessions · chat · handoff) while every column renders RTL.
    */}
    <main dir="ltr" className="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)_23rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <ErrorBoundary label="قائمة الجلسات مش معروضة صح دلوقتي.">
        <SessionList
          threads={room.threads}
          selectedId={room.selectedId}
          onSelect={room.onSelectThread}
          onCreate={room.onCreateThread}
          creating={room.creating}
          connected={room.codexConnected}
          projectDirectory={room.projectDirectory}
          onOpenProject={room.onOpenProjectFolder}
          openingProject={room.openingProject}
        />
      </ErrorBoundary>

      <ErrorBoundary label="محادثة Codex مش معروضة صح دلوقتي.">
        <CodexConversation
          thread={conversation.view.thread}
          messages={conversation.view.messages}
          loading={conversation.view.loading}
          turn={conversation.turn}
          onNewThread={room.onCreateThread}
          sending={conversation.composer.sending}
          error={conversation.composer.error}
          draft={conversation.composer.draft}
          queued={conversation.composer.queued}
          attachments={conversation.composer.attachments}
          attaching={conversation.composer.attaching}
          onDraftChange={conversation.composer.onDraftChange}
          onSend={conversation.composer.onSend}
          onQueue={conversation.composer.onQueue}
          onCancelQueue={conversation.composer.onCancelQueue}
          onAttach={conversation.composer.onAttach}
          onRemoveAttachment={conversation.composer.onRemoveAttachment}
          onStop={conversation.composer.onStop}
        />
      </ErrorBoundary>

      <ErrorBoundary label="مسار التفويض مش معروض صح دلوقتي.">
        <HandoffRail
          thread={conversation.view.thread}
          handoff={conversation.view.handoff}
          loading={conversation.view.loading}
          events={room.events}
          onReview={room.onReview}
          reviewing={conversation.view.busy}
          onRefresh={conversation.refreshHandoff}
          onNotify={room.alerts.notify}
          models={room.models.data ?? []}
          model={model}
          onModelChange={setModel}
        />
      </ErrorBoundary>
    </main>
  </div>
}
