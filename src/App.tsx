import { StandaloneTitleBar } from './components/WindowControls'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useWelcomeSequence } from './hooks/useWelcomeSequence'
import { ProjectEditor } from './components/ProjectEditor'
import { ExtensionsWorkspace } from './components/ExtensionsWorkspace'
import { SupportButton, SupportChat } from './components/SupportChat'
import { direction, setLocale, tr, useLocale } from './lib/i18n'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { GripVertical, LoaderCircle } from 'lucide-react'
import { AppHeader } from './components/AppHeader'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AlertStack } from './features/alerts/AlertStack'
import { TerminalDock } from './components/TerminalDock'
import { CodexConversation } from './features/codex/CodexConversation'
import { SessionList } from './features/codex/SessionList'
import { PlannerConversation } from './features/opencode/PlannerConversation'
import { HandoffRail } from './features/opencode/HandoffRail'
import { useRelayRoom } from './hooks/useRelayRoom'
import { useAutomaticPreview } from './hooks/useAutomaticPreview'
import { persistPreference, preferenceKeys, readHandoffVisibility } from './lib/preferences'
import { api } from './lib/api'
import { ClineConversation } from './features/cline/ClineConversation'
import { usePolling } from './hooks/usePolling'
import { SuperAgentWorkspace } from './features/super-agent/SuperAgentWorkspace'

type PanelName = 'sessions' | 'handoff'
type PanelSizes = Record<PanelName, number>

const PANEL_SIZES_KEY = 'relay-room.panel-sizes'
const DEFAULT_PANEL_SIZES: PanelSizes = { sessions: 272, handoff: 368 }
const MIN_PANEL_SIZES: PanelSizes = { sessions: 224, handoff: 280 }
const MAX_PANEL_SIZES: PanelSizes = { sessions: 420, handoff: 920 }
const MIN_CONVERSATION_WIDTH = 352
const COLLAPSED_SESSIONS_WIDTH = 52

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
 * Open Zero — layout only.
 *
 * Every piece of state lives in `useRelayRoom`; every request is declared in
 * `src/lib/api.ts`; every screen is one file under `src/features`. This file
 * exists to say what sits where, and nothing else.
 */
function WorkspaceApp() {
  const [workspaceMode, setWorkspaceMode] = useState<'agent' | 'ide' | 'super'>('agent')
  const superOpen = workspaceMode === 'super'
  const extensionsOpen = workspaceMode === 'ide'
  const setExtensionsOpen = (value: boolean) => setWorkspaceMode(value ? 'ide' : 'agent')
  const room = useRelayRoom(!superOpen)
  const { conversation } = room
  const locale = useLocale()
  const layoutRef = useRef<HTMLElement>(null)
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(loadPanelSizes)
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [handoffVisible, setHandoffVisible] = useState(readHandoffVisibility)
  const thread = conversation.view.thread
  const plannerEnabled = room.providerActivity.providers[thread?.workflow?.planner || 'codex']
  const executorEnabled = room.providerActivity.providers[thread?.workflow?.executor || 'opencode']
  const clineWorkflow = Boolean(thread?.workflow && [thread.workflow.planner, thread.workflow.executor].includes('cline'))
  const roleState = usePolling(!superOpen && clineWorkflow && thread && (plannerEnabled || executorEnabled) ? () => api.clineWorkflow(thread.id) : null, state => state?.planner.active || state?.executor.active ? 1_000 : 3_000, { resetKey: `${thread?.id}:${plannerEnabled}:${executorEnabled}` })
  const workflowState = roleState.data?.thread.id === thread?.id ? roleState.data : null
  const [workflowBusy, setWorkflowBusy] = useState(false), [workflowError, setWorkflowError] = useState('')
  useEffect(() => { setWorkflowError('') }, [thread?.id])
  const workflowBlocked = Boolean(workflowBusy || !workflowState || workflowState.planner.active || workflowState.executor.active)
  const pausedPane = (agent: string) => <section dir={direction()} className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center"><strong className="text-sm">{agent === 'opencode' ? 'OpenCode' : agent === 'cline' ? 'Cline' : 'Codex'} · {locale === 'ar' ? 'موقوف' : 'Disabled'}</strong><p className="text-xs leading-6 text-ink-soft">{locale === 'ar' ? 'فعّله من الإعدادات ← الاتصال والتحديثات' : 'Enable it in Settings → Connections & updates'}</p></section>
  async function workflowAction(action: 'execute' | 'review') {
    if (!thread || workflowBusy) return
    setWorkflowBusy(true); setWorkflowError('')
    try {
      await api.workflowAction(thread.id, action)
      window.dispatchEvent(new CustomEvent('coding-room:conversation-activity', { detail: thread.id }))
      conversation.refreshHandoff()
      await roleState.refresh()
    } catch (failure) { setWorkflowError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setWorkflowBusy(false) }
  }
  const [automaticPreview, setAutomaticPreview] = useState(false)
  const [automaticError, setAutomaticError] = useState('')
  useAutomaticPreview(automaticPreview && !extensionsOpen && !superOpen, room.workRoot, message => {
    setAutomaticPreview(false)
    setAutomaticError(locale === 'ar' && message === 'No suitable source files were found for automatic preview.' ? 'لا توجد ملفات كود مناسبة للمعاينة الآلية في المشروع الحالي.' : message)
  })

  useEffect(() => {
    persistPreference(preferenceKeys.panelSizes, JSON.stringify(panelSizes))
  }, [panelSizes])
  useEffect(() => {
    persistPreference(preferenceKeys.handoffVisible, String(handoffVisible))
  }, [handoffVisible])

  const updatePanelSize = useCallback((panel: PanelName, nextSize: number) => {
    setPanelSizes((current) => {
      const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth
      const otherPanel = panel === 'sessions' ? 'handoff' : 'sessions'
      const available = layoutWidth - (otherPanel === 'sessions' && sessionsCollapsed ? COLLAPSED_SESSIONS_WIDTH : current[otherPanel]) - MIN_CONVERSATION_WIDTH
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
    '--relay-sessions-width': `${sessionsCollapsed ? COLLAPSED_SESSIONS_WIDTH : panelSizes.sessions}px`,
    '--relay-handoff-width': `${handoffVisible ? panelSizes.handoff : 0}px`,
  } as CSSProperties

  const reverse = conversation.view.thread?.workflow?.planner === 'opencode'
  const codexToCodex = conversation.view.thread?.workflow?.planner === 'codex' && conversation.view.thread?.workflow?.executor === 'codex'
    && conversation.view.thread?.workflowRole !== 'executor'
  const codexPane = <CodexConversation
          codexIdentity={room.codexIdentity}
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
  const plannerPane = <PlannerConversation key={conversation.view.thread?.id} workflowControls={!clineWorkflow} codexActive={clineWorkflow ? workflowBlocked : conversation.turn.active} codexHasReply={clineWorkflow ? Boolean(workflowState?.executor.messages.some(message => message.role === 'assistant')) : conversation.view.messages.some(message => message.role === 'assistant')}
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
          workRoot={room.workRoot}        />

  const executorConversation = room.executorConversation
  const executorPane = executorConversation.view.thread ? <CodexConversation
    codexIdentity={room.codexIdentity}
    workRoot={room.workRoot}
    codexSelection={executorConversation.codexSelection}
    thread={executorConversation.view.thread}
    messages={executorConversation.view.messages}
    fileChanges={executorConversation.view.fileChanges}
    loading={executorConversation.view.loading}
    turn={executorConversation.turn}
    onNewThread={room.onCreateThread}
    onExecutePlan={room.onExecutePlan}
    sending={executorConversation.composer.sending}
    error={executorConversation.composer.error}
    draft={executorConversation.composer.draft}
    queued={executorConversation.composer.queued}
    attachments={executorConversation.composer.attachments}
    attaching={executorConversation.composer.attaching}
    onDraftChange={executorConversation.composer.onDraftChange}
    onSend={executorConversation.composer.onSend}
    onQueue={executorConversation.composer.onQueue}
    onCancelQueue={executorConversation.composer.onCancelQueue}
    onAttach={executorConversation.composer.onAttach}
    onRemoveAttachment={executorConversation.composer.onRemoveAttachment}
    onStop={executorConversation.composer.onStop}
  /> : null

  return <div dir={direction()} className="openzero-workspace flex min-h-screen flex-col bg-paper text-ink lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <AlertStack alerts={room.alerts.list} onDismiss={room.alerts.onDismiss} />

    <AppHeader
      codexConnected={room.codexConnected}
      openCodeOnline={room.openCodeOnline}
      codexError={room.codexError}
      shellError={room.shellError || automaticError || null}
      onResetLayout={resetPanelSizes}
      locale={locale}
      onToggleLanguage={() => setLocale(locale === 'en' ? 'ar' : 'en')}
      handoffVisible={handoffVisible}
      onToggleHandoff={() => setHandoffVisible(value => !value)}
      onOpenExtensions={() => { setAutomaticPreview(false); setExtensionsOpen(true) }}
      mode={workspaceMode}
      onChangeMode={mode => { if (mode !== 'agent') setAutomaticPreview(false); setWorkspaceMode(mode) }}
      automaticPreview={automaticPreview}
      automaticAvailable={Boolean(room.workRoot) && !superOpen}
      onToggleAutomaticPreview={() => {
        setAutomaticError('')
        if (!automaticPreview) setExtensionsOpen(false)
        setAutomaticPreview(value => !value)
      }}
    />

    {/*
      Three columns, one scroll region each. `dir="ltr"` keeps the source order
      left-to-right (sessions · chat · handoff) while every column renders RTL.
    */}
    <main
      id="workspace-agent" role="tabpanel" aria-labelledby="workspace-mode-agent"
      ref={layoutRef}
      dir="ltr"
      style={{ ...layoutStyle, ...(extensionsOpen || superOpen ? { display: 'none' } : {}) }}
      className="relative mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[var(--relay-sessions-width)_minmax(22rem,1fr)_var(--relay-handoff-width)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
    >
      <ErrorBoundary label={tr("قائمة الجلسات مش معروضة صح دلوقتي.")}>
        <SessionList
          collapsed={sessionsCollapsed}
          onToggle={() => setSessionsCollapsed((value) => !value)}
          threads={room.threads}
            archivedThreads={room.archivedThreads}
            showArchived={room.showArchived}
            archivedLoading={room.archivedLoading}
            archivedError={room.archivedError}
            onShowArchived={room.onShowArchived}
            onRename={room.onRenameThread}
            onArchive={room.onArchiveThread}
            onRestore={room.onRestoreThread}
          selectedId={room.selectedId}
          onSelect={room.onSelectThread}
          onCreate={room.onCreateThread}
          creating={room.creating}
          connected={room.canCreateThread}
          commitModel={conversation.codexSelection.current.model}
          codexIdentity={room.codexIdentity}
          workRoot={room.workRoot}
          onChooseWorkRoot={room.onChooseWorkRoot}
          onOpenThreadFolder={room.onOpenThreadFolder}
          choosingWorkRoot={room.choosingWorkRoot}
        />
      </ErrorBoundary>

      <ErrorBoundary label={tr("محادثة Codex مش معروضة صح دلوقتي.")}>
        <ProjectEditor root={room.workRoot} automatic={automaticPreview && !extensionsOpen && !superOpen} onInsert={text => {
          if (thread?.workflow?.planner === 'cline') window.dispatchEvent(new CustomEvent('openzero:insert-cline-code', { detail: { threadId: thread.id, role: 'planner', text } }))
          else if (reverse) window.dispatchEvent(new CustomEvent('coding-room:insert-planner-code', { detail: text }))
          else conversation.composer.onDraftChange([conversation.composer.draft, text].filter(Boolean).join('\n\n'))
        }}><div className="flex h-full min-h-0 flex-1 flex-col">
          {clineWorkflow && thread ? <div dir={direction()} className="shrink-0 space-y-2 border-b border-line bg-card px-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="me-auto text-ink-soft">{thread.workflow?.planner} → {thread.workflow?.executor}</span>
              <button type="button" disabled={workflowBlocked || !executorEnabled || !workflowState?.planner.messages.some(message => message.role === 'assistant' && message.text.trim())} onClick={() => { setHandoffVisible(true); void workflowAction('execute') }} className="rounded-lg border border-line px-3 py-2 font-semibold text-relay-ink hover:bg-relay-tint disabled:opacity-40">{locale === 'ar' ? 'إرسال الخطة للتنفيذ' : 'Send plan to executor'}</button>
              <button type="button" disabled={workflowBlocked || !plannerEnabled || !workflowState?.executor.messages.some(message => message.role === 'assistant' && message.text.trim())} onClick={() => void workflowAction('review')} className="rounded-lg border border-line px-3 py-2 font-semibold hover:bg-relay-tint disabled:opacity-40">{locale === 'ar' ? 'مراجعة رد المنفّذ' : 'Review executor reply'}</button>
            </div>
            {workflowError || roleState.error ? <p role="alert" className="text-xs text-review-ink">{workflowError || roleState.error}</p> : null}
          </div> : null}
          <div className="flex min-h-0 flex-1 flex-col">{thread && !plannerEnabled ? pausedPane(thread.workflow?.planner || 'codex') : thread?.workflow?.planner === 'cline' ? <ClineConversation thread={thread} role="planner" view={workflowState?.planner} blocked={workflowBlocked} visible={!extensionsOpen && !superOpen} identity={room.codexIdentity} onRefresh={roleState.refresh} /> : reverse ? plannerPane : codexPane}</div>
        </div></ProjectEditor>
      </ErrorBoundary>

      <ErrorBoundary label={tr("مسار التفويض مش معروض صح دلوقتي.")}>
        {handoffVisible ? (thread && !executorEnabled ? <aside className="flex min-h-[22rem] min-w-0 flex-col border-t border-line lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">{pausedPane(thread.workflow?.executor || 'opencode')}</aside> : thread?.workflow?.executor === 'cline' ? <aside className="flex min-h-[22rem] min-w-0 flex-col border-t border-line lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0"><ClineConversation thread={thread} role="executor" view={workflowState?.executor} blocked={workflowBlocked} visible={!extensionsOpen && !superOpen} identity={room.codexIdentity} onRefresh={roleState.refresh} /></aside> : clineWorkflow && thread?.workflow?.executor === 'codex' ? <aside className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">{executorPane ?? <p dir={direction()} className="p-5 text-xs leading-6 text-ink-soft">{locale === 'ar' ? 'هنا تظهر محادثة Codex المنفّذ بعد إرسال الخطة.' : 'Your Codex executor appears here after sending the plan.'}</p>}</aside> : reverse ? codexPane : codexToCodex ? <aside dir={direction()} className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">
          {executorPane ?? <div className="flex flex-1 flex-col px-5 py-6">
            <h2 className="text-sm font-bold text-ink">{tr("Codex · شات التنفيذ")}</h2>
            <p className="mt-2 text-xs leading-6 text-ink-soft">{tr("هنا هتظهر محادثة التنفيذ بعد إرسال الخطة من الشات الرئيسي.")}</p>
            {conversation.view.thread?.workflow?.executorModel ? <code dir="ltr" className="mt-3 self-start rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">{conversation.view.thread.workflow.executorModel}</code> : null}
          </div>}
        </aside> : <HandoffRail
          thread={conversation.view.thread}
          handoff={conversation.view.handoff}
          loading={conversation.view.loading}
          events={room.events}
          onReview={clineWorkflow ? async () => { await workflowAction('review') } : room.onReview}
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
          workRoot={room.workRoot}        />) : null}
      </ErrorBoundary>

      <div
        role="slider"
        tabIndex={0}
        aria-label={tr("تغيير عرض قائمة جلسات Codex")}
        aria-orientation="horizontal"
        aria-valuemin={MIN_PANEL_SIZES.sessions}
        aria-valuemax={MAX_PANEL_SIZES.sessions}
        aria-valuenow={panelSizes.sessions}
        title={tr("اسحب لتغيير عرض قائمة الجلسات. الأسهم للتغيير، وShift لتغيير أسرع. نقرتان لإعادة الضبط.")}
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
        aria-label={tr("تغيير عرض مسار التفويض")}
        aria-orientation="horizontal"
        aria-valuemin={MIN_PANEL_SIZES.handoff}
        aria-valuemax={MAX_PANEL_SIZES.handoff}
        aria-valuenow={panelSizes.handoff}
        title={tr("اسحب لتغيير عرض مسار التفويض. الأسهم للتغيير، وShift لتغيير أسرع. نقرتان لإعادة الضبط.")}
        onPointerDown={(event) => startResize('handoff', event)}
        onKeyDown={(event) => handleResizeKey('handoff', event)}
        onDoubleClick={resetPanelSizes}
        style={{ right: `${panelSizes.handoff - 6}px` }}
        className={`group absolute inset-y-0 z-20 hidden w-3 touch-none cursor-col-resize items-center justify-center outline-none focus-visible:bg-relay/10 ${handoffVisible ? 'lg:flex' : ''}`}
      >
        <span className="flex h-9 w-4 items-center justify-center rounded-full border border-line bg-card text-ink-soft opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </main>
    <ExtensionsWorkspace root={room.workRoot} open={extensionsOpen} />
    <ErrorBoundary label={locale === 'ar' ? 'تعذّر عرض Super Agent.' : 'Could not display Super Agent.'}><SuperAgentWorkspace visible={superOpen} identity={room.codexIdentity} /></ErrorBoundary>
    <div className="shrink-0" style={superOpen ? { display: 'none' } : undefined}><TerminalDock cwd={room.workRoot || conversation.view.thread?.directory} /></div>
  </div>
}

function LicenseGate() {
  const isArabic = useLocale() === 'ar'
  const [checking, setChecking] = useState(true)
  const [active, setActive] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)
  const welcomePhase = useWelcomeSequence(checking)
  const [quotaExhausted, setQuotaExhausted] = useState(false)
  const [resetsAt, setResetsAt] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let running = false
    let revision = 0
    const refresh = async () => {
      if (running) return
      running = true
      const currentRevision = revision
      try {
        const result = await api.licenseStatus()
        if (!mounted || currentRevision !== revision) return
        const exhausted = result.active && (result.entitlement?.remaining ?? 0) <= 0
        setQuotaExhausted(exhausted)
        setResetsAt(result.entitlement?.resetsAt || null)
        setActive(!result.licenseError && result.active && !exhausted)
        setError(result.licenseError || '')
      } catch (reason) {
        if (mounted && currentRevision === revision) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        running = false
        if (mounted) setChecking(false)
      }
    }
    const onActivation = () => { revision++; void refresh() }
    const onVisible = () => { if (!document.hidden) void refresh() }
    const onUsage = (event: Event) => {
      if ((event as CustomEvent<{ remaining: number }>).detail.remaining <= 0) {
        revision++
        setActive(false); setQuotaExhausted(true)
      }
      void refresh()
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 45_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('coding-room:license-activated', onActivation)
    window.addEventListener('coding-room:license-usage', onUsage)
    window.addEventListener('coding-room:license-refresh', refresh)
    return () => {
      mounted = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('coding-room:license-activated', onActivation)
      window.removeEventListener('coding-room:license-usage', onUsage)
      window.removeEventListener('coding-room:license-refresh', refresh)
    }
  }, [])

  const activate = async (event: FormEvent) => {
    event.preventDefault()
    setActivating(true)
    setError('')
    try {
      const result = await api.activateLicense(key)
      window.dispatchEvent(new Event('coding-room:license-activated'))
      const exhausted = result.active && (result.entitlement?.remaining ?? 0) <= 0
      setQuotaExhausted(exhausted)
      setActive(result.active && !exhausted)
      setKey('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setActivating(false) }
  }

  const welcome = welcomePhase !== 'done' ? <WelcomeScreen key="welcome" leaving={welcomePhase === 'leaving'} checking={checking} isArabic={isArabic} /> : null
  // Keep the same overlay mounted across phases so its opacity transition can run.
  if (welcomePhase === 'waiting') return <>{null}{welcome}</>
  if (active) return <><div inert={welcomePhase !== 'done'} aria-hidden={welcomePhase !== 'done' || undefined}><WorkspaceApp /></div>{welcome}</>
  const title = quotaExhausted ? (isArabic ? 'انتهى رصيد الطلبات' : 'Request quota exhausted') : (isArabic ? 'تفعيل Open Zero' : 'Activate Open Zero')
  const description = quotaExhausted
    ? (isArabic ? 'رصيد مفتاحك وصل إلى صفر. الإرسال متوقف حتى تجديد الرصيد اليومي أو تفعيل مفتاح آخر.' : 'Your key has zero requests remaining. Messaging is paused until the daily quota resets or you activate another key.')
    : (isArabic ? 'أدخل مفتاح تفعيل صالح لاستخدام Open Zero. كل رسالة تستهلك طلبًا من رصيد مفتاحك.' : 'Enter a valid activation key to use Open Zero. Each message uses one request from your key quota.')
  return <><main inert={welcomePhase !== 'done'} aria-hidden={welcomePhase !== 'done' || undefined} dir={isArabic ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center overflow-y-auto bg-[#06080f] px-6 py-8 text-[#dce7ff]">
    <StandaloneTitleBar dark />
    <form onSubmit={activate} className="w-full max-w-[380px]">
      <img src="/brand/openzero-logo-animated.svg" alt="" aria-hidden="true" className="mx-auto mb-4 h-28 w-28 object-contain" />
      <img src="/brand/openzero-wordmark-transparent.png" alt="Open Zero" className="mx-auto w-[min(320px,70vw)] object-contain" />
      <h1 className="mt-5 text-center text-xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-center text-sm leading-6 text-[#a9b9d8]">{description}</p>
      {quotaExhausted && <p className="mt-4 rounded-xl border border-[#e9b36c]/25 bg-[#e9b36c]/10 px-4 py-3 text-xs font-semibold leading-6 text-[#f5cc99]">{isArabic ? 'المتبقي: 0 · تجديد الرصيد:' : 'Remaining: 0 · Quota resets:'} {resetsAt ? new Date(resetsAt).toLocaleString(isArabic ? 'ar-EG' : 'en-US') : '00:00 UTC'}</p>}
      <label htmlFor="license-key" className="mt-7 block text-xs font-semibold text-[#becce4]">{isArabic ? 'مفتاح التفعيل' : 'Activation key'}</label>
      <input id="license-key" dir="ltr" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder="CR-…" aria-invalid={Boolean(error)} aria-describedby={error ? 'activation-error' : undefined} className="mt-2 h-12 w-full rounded-xl border border-[#253149] bg-[#0d1320] px-4 font-mono text-sm text-[#eef3ff] outline-none transition placeholder:text-[#667895] hover:border-[#394c6a] focus:border-[#61cfff] focus:ring-4 focus:ring-[#61cfff]/10" />
      {error ? <p id="activation-error" role="alert" className="mt-3 rounded-xl border border-[#f59aab]/25 bg-[#f59aab]/10 px-4 py-3 text-xs leading-5 text-[#ffc1cf]">{isArabic && error === 'License is invalid, expired, or disabled.' ? 'المفتاح غير صالح، أو انتهت مدته، أو تم تعطيله. أدخل مفتاحًا آخر أو تواصل مع الدعم.' : error}</p> : null}
      <button type="submit" disabled={activating || checking || !key.trim()} className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6868ee] to-[#279fca] px-4 text-sm font-bold text-[#f4f7ff] shadow-[0_6px_24px_rgba(71,116,225,0.18)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#86d9ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06080f] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
        {activating || checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {checking ? (isArabic ? 'جارٍ التحقق…' : 'Checking…') : activating ? (isArabic ? 'جارٍ التفعيل…' : 'Activating…') : (isArabic ? 'تفعيل' : 'Activate')}
      </button>
      <div className="mt-6 flex justify-center border-t border-[#253149]/60 pt-5"><SupportButton appearance="welcome" /></div>
    </form>
  </main>{welcome}</>
}

type MandatoryUpdateState = { version?: string; percent?: number; error?: string }

function MandatoryUpdateGate({ children }: { children: ReactNode }) {
  const isArabic = useLocale() === 'ar'
  const [update, setUpdate] = useState<MandatoryUpdateState | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    const updates = window.codingRoomUpdates
    if (!updates) return
    const removeRequired = updates.onMandatoryUpdate(data => setUpdate({ version: data.version, percent: 0 }))
    const removeProgress = updates.onMandatoryUpdateProgress(data => setUpdate(current => current ? { ...current, percent: data.percent, error: undefined } : current))
    const removeError = updates.onMandatoryUpdateError(data => setUpdate(current => current ? { ...current, error: data.message } : current))
    return () => { removeRequired(); removeProgress(); removeError() }
  }, [])

  async function retry() {
    if (!window.codingRoomUpdates) return
    setRetrying(true)
    try {
      const result = await window.codingRoomUpdates.retry()
      if (result.status === 'current') setUpdate(null)
      else if (result.status === 'error') setUpdate(current => current ? { ...current, error: result.message } : current)
      else setUpdate(current => current ? { ...current, error: undefined } : current)
    } catch (error) {
      setUpdate(current => current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current)
    } finally { setRetrying(false) }
  }

  if (!update) return children
  const percent = Math.max(0, Math.min(100, update.percent ?? 0))
  return <main dir={isArabic ? 'rtl' : 'ltr'} className="fixed inset-0 z-[100] flex items-center justify-center bg-paper px-5 text-ink">
    <StandaloneTitleBar />
    <section role="alertdialog" aria-labelledby="mandatory-update-title" aria-describedby="mandatory-update-description" className="w-full max-w-md rounded-2xl border border-line bg-card p-7 shadow-xl shadow-black/5">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-relay-tint text-relay-ink"><LoaderCircle className="h-5 w-5 animate-spin" /></div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-relay-ink">{isArabic ? 'تحديث مطلوب' : 'Update required'}</p>
      <h1 id="mandatory-update-title" className="mt-2 text-xl font-bold">{isArabic ? 'لازم تحدّث Open Zero للمتابعة' : 'Update Open Zero to continue'}</h1>
      <p id="mandatory-update-description" className="mt-2 text-sm leading-6 text-ink-soft">{isArabic ? `الإصدار ${update.version ?? 'الجديد'} بيتنزّل الآن، وسيُثبت التطبيق تلقائيًا بعد اكتمال التنزيل.` : `Version ${update.version ?? 'latest'} is downloading. Open Zero will restart and install it as soon as the download finishes.`}</p>
      <div className="mt-6" aria-live="polite">
        <div className="mb-2 flex justify-between text-xs text-ink-soft"><span>{update.error ? (isArabic ? 'تعذّر تنزيل التحديث' : 'Update download failed') : (isArabic ? 'جارٍ تنزيل التحديث' : 'Downloading update')}</span><span className="tabular-nums">{percent}%</span></div>
        <div role="progressbar" aria-label={isArabic ? 'تقدم تنزيل التحديث' : 'Update download progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-relay transition-[width] duration-200" style={{ width: `${percent}%` }} /></div>
      </div>
      {update.error ? <p role="alert" className="mt-3 break-words text-xs leading-5 text-review-ink">{update.error}</p> : null}
      <button type="button" onClick={() => void retry()} disabled={retrying} className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-paper disabled:opacity-50">{retrying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{isArabic ? 'إعادة المحاولة' : 'Retry update'}</button>
    </section>
  </main>
}

export default function App() {
  return <MandatoryUpdateGate><LicenseGate /><SupportChat /></MandatoryUpdateGate>
}
