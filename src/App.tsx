import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { AppHeader } from './components/AppHeader'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AlertStack } from './features/alerts/AlertStack'
import { CodexConversation } from './features/codex/CodexConversation'
import { SessionList } from './features/codex/SessionList'
import { PlannerConversation } from './features/opencode/PlannerConversation'
import { HandoffRail } from './features/opencode/HandoffRail'
import { useRelayRoom } from './hooks/useRelayRoom'

type PanelName = 'sessions' | 'handoff'
type PanelSizes = Record<PanelName, number>

const PANEL_SIZES_KEY = 'relay-room.panel-sizes'
const DEFAULT_PANEL_SIZES: PanelSizes = { sessions: 272, handoff: 368 }
const MIN_PANEL_SIZES: PanelSizes = { sessions: 224, handoff: 280 }
const MAX_PANEL_SIZES: PanelSizes = { sessions: 420, handoff: 520 }
const MIN_CONVERSATION_WIDTH = 352

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function loadPanelSizes(): PanelSizes {
  if (typeof window === 'undefined') return DEFAULT_PANEL_SIZES
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_SIZES_KEY) ?? '') as Partial<PanelSizes>
    return {
      sessions: clamp(Number(saved.sessions) || DEFAULT_PANEL_SIZES.sessions, MIN_PANEL_SIZES.sessions, MAX_PANEL_SIZES.sessions),
      handoff: clamp(Number(saved.handoff) || DEFAULT_PANEL_SIZES.handoff, MIN_PANEL_SIZES.handoff, MAX_PANEL_SIZES.handoff),
    }
  } catch {
    return DEFAULT_PANEL_SIZES
  }
}

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
  const layoutRef = useRef<HTMLElement>(null)
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(loadPanelSizes)
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(panelSizes))
  }, [panelSizes])

  const updatePanelSize = useCallback((panel: PanelName, nextSize: number) => {
    setPanelSizes((current) => {
      const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth
      const otherPanel = panel === 'sessions' ? 'handoff' : 'sessions'
      const available = layoutWidth - (otherPanel === 'sessions' && sessionsCollapsed ? 52 : current[otherPanel]) - MIN_CONVERSATION_WIDTH
      const maximum = Math.max(MIN_PANEL_SIZES[panel], Math.min(MAX_PANEL_SIZES[panel], available))
      return { ...current, [panel]: clamp(nextSize, MIN_PANEL_SIZES[panel], maximum) }
    })
  }, [sessionsCollapsed])

  const startResize = useCallback((panel: PanelName, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startSize = panelSizes[panel]
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const finish = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
    }
    const move = (moveEvent: globalThis.PointerEvent) => {
      const movement = moveEvent.clientX - startX
      updatePanelSize(panel, startSize + (panel === 'sessions' ? movement : -movement))
    }

    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }, [panelSizes, updatePanelSize])

  const handleResizeKey = useCallback((panel: PanelName, event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      updatePanelSize(panel, panelSizes[panel] + step)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      updatePanelSize(panel, panelSizes[panel] - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      updatePanelSize(panel, MIN_PANEL_SIZES[panel])
    } else if (event.key === 'End') {
      event.preventDefault()
      updatePanelSize(panel, MAX_PANEL_SIZES[panel])
    }
  }, [panelSizes, updatePanelSize])

  const resetPanelSizes = useCallback(() => { setPanelSizes(DEFAULT_PANEL_SIZES); setSessionsCollapsed(false) }, [])
  const layoutStyle = {
    '--relay-sessions-width': `${sessionsCollapsed ? 52 : panelSizes.sessions}px`,
    '--relay-handoff-width': `${panelSizes.handoff}px`,
  } as CSSProperties

  const reverse = conversation.view.thread?.workflow?.planner === 'opencode'
  const codexToCodex = conversation.view.thread?.workflow?.planner === 'codex' && conversation.view.thread?.workflow?.executor === 'codex'
  const codexPane = <CodexConversation
          workRoot={room.workRoot}
          codexSelection={conversation.codexSelection}
          thread={conversation.view.thread}
          messages={conversation.view.messages}
          fileChanges={conversation.view.fileChanges}
          loading={conversation.view.loading}
          turn={conversation.turn}
          onNewThread={room.onCreateThread}
          onExecutePlan={room.onExecutePlan}
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
  const plannerPane = <PlannerConversation key={conversation.view.thread?.id} codexActive={conversation.turn.active} codexHasReply={conversation.view.messages.some(message => message.role === 'assistant')}
          thread={conversation.view.thread}
          handoff={conversation.view.handoff}
          loading={conversation.view.loading}
          events={room.events}
          onReview={room.onReview}
          reviewing={conversation.view.busy}
          onRefresh={conversation.refreshHandoff}
          onNotify={room.alerts.notify}
          models={room.models.data ?? []}
          model={conversation.model.current}
          onModelChange={conversation.model.onChange}
          changingModel={conversation.model.changing}
          modelError={conversation.model.error}
          sessions={room.openCodeSessions}
          onRefreshSessions={room.onRefreshSessions}
          workRoot={room.workRoot}
          modelIds={(room.models.data ?? []).filter((entry) => entry.tools).map((entry) => entry.id)}
        />

  return <div dir="rtl" className="flex min-h-screen flex-col bg-paper text-ink lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <AlertStack alerts={room.alerts.list} onDismiss={room.alerts.onDismiss} />

    <AppHeader
      codexConnected={room.codexConnected}
      openCodeOnline={room.openCodeOnline}
      codexError={room.codexError}
      shellError={room.shellError}
      onRefresh={room.onRefreshAll}
      onResetLayout={resetPanelSizes}
    />

    {/*
      Three columns, one scroll region each. `dir="ltr"` keeps the source order
      left-to-right (sessions · chat · handoff) while every column renders RTL.
    */}
    <main
      ref={layoutRef}
      dir="ltr"
      style={layoutStyle}
      className="relative mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[var(--relay-sessions-width)_minmax(22rem,1fr)_var(--relay-handoff-width)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
    >
      <ErrorBoundary label="قائمة الجلسات مش معروضة صح دلوقتي.">
        <SessionList
          collapsed={sessionsCollapsed}
          onToggle={() => setSessionsCollapsed((value) => !value)}
          threads={room.threads}
          selectedId={room.selectedId}
          onSelect={room.onSelectThread}
          onCreate={room.onCreateThread}
          creating={room.creating}
          connected={room.codexConnected}
          workRoot={room.workRoot}
          onChooseWorkRoot={room.onChooseWorkRoot}
          onOpenThreadFolder={room.onOpenThreadFolder}
          choosingWorkRoot={room.choosingWorkRoot}
        />
      </ErrorBoundary>

      <ErrorBoundary label="محادثة Codex مش معروضة صح دلوقتي.">
        {reverse ? plannerPane : codexPane}
      </ErrorBoundary>

      <ErrorBoundary label="مسار التفويض مش معروض صح دلوقتي.">
        {reverse ? codexPane : codexToCodex ? <aside dir="rtl" className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card px-5 py-6 lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">
          <h2 className="text-sm font-bold text-ink">Codex · شات التنفيذ</h2>
          <p className="mt-2 text-xs leading-6 text-ink-soft">التخطيط والمراجعة في المحادثة الرئيسية. عند إرسال الخطة، يفتح شات Codex منفصل بالموديل المحدد للتنفيذ ويظهر ضمن قائمة الجلسات.</p>
          {conversation.view.thread?.workflow?.executorModel ? <code dir="ltr" className="mt-3 rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">{conversation.view.thread.workflow.executorModel}</code> : null}
        </aside> : <HandoffRail
          thread={conversation.view.thread}
          handoff={conversation.view.handoff}
          loading={conversation.view.loading}
          events={room.events}
          onReview={room.onReview}
          reviewing={conversation.view.busy}
          onRefresh={conversation.refreshHandoff}
          onNotify={room.alerts.notify}
          models={room.models.data ?? []}
          model={conversation.model.current}
          onModelChange={conversation.model.onChange}
          changingModel={conversation.model.changing}
          modelError={conversation.model.error}
          sessions={room.openCodeSessions}
          onRefreshSessions={room.onRefreshSessions}
          workRoot={room.workRoot}
          modelIds={(room.models.data ?? []).filter((entry) => entry.tools).map((entry) => entry.id)}
        />}
      </ErrorBoundary>

      <div
        role="slider"
        tabIndex={0}
        aria-label="تغيير عرض قائمة جلسات Codex"
        aria-orientation="horizontal"
        aria-valuemin={MIN_PANEL_SIZES.sessions}
        aria-valuemax={MAX_PANEL_SIZES.sessions}
        aria-valuenow={panelSizes.sessions}
        title="اسحب لتغيير عرض قائمة الجلسات. الأسهم للتغيير، وShift لتغيير أسرع. نقرتان لإعادة الضبط."
        onPointerDown={(event) => startResize('sessions', event)}
        onKeyDown={(event) => handleResizeKey('sessions', event)}
        onDoubleClick={resetPanelSizes}
        aria-hidden={sessionsCollapsed}
        style={{ left: `${panelSizes.sessions - 6}px` }}
        className={`group absolute inset-y-0 z-20 hidden w-3 touch-none cursor-col-resize items-center justify-center outline-none ${sessionsCollapsed ? '' : 'lg:flex'} focus-visible:bg-relay/10`}
      >
        <span className="flex h-9 w-4 items-center justify-center rounded-full border border-line bg-card text-ink-soft opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label="تغيير عرض مسار التفويض"
        aria-orientation="horizontal"
        aria-valuemin={MIN_PANEL_SIZES.handoff}
        aria-valuemax={MAX_PANEL_SIZES.handoff}
        aria-valuenow={panelSizes.handoff}
        title="اسحب لتغيير عرض مسار التفويض. الأسهم للتغيير، وShift لتغيير أسرع. نقرتان لإعادة الضبط."
        onPointerDown={(event) => startResize('handoff', event)}
        onKeyDown={(event) => handleResizeKey('handoff', event)}
        onDoubleClick={resetPanelSizes}
        style={{ right: `${panelSizes.handoff - 6}px` }}
        className="group absolute inset-y-0 z-20 hidden w-3 touch-none cursor-col-resize items-center justify-center outline-none lg:flex focus-visible:bg-relay/10"
      >
        <span className="flex h-9 w-4 items-center justify-center rounded-full border border-line bg-card text-ink-soft opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </main>
  </div>
}
