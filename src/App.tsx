import { direction, setLocale, tr, useLocale } from './lib/i18n'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { GripVertical, KeyRound, LoaderCircle } from 'lucide-react'
import { AppHeader } from './components/AppHeader'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AlertStack } from './features/alerts/AlertStack'
import { TerminalDock } from './components/TerminalDock'
import { CodexConversation } from './features/codex/CodexConversation'
import { SessionList } from './features/codex/SessionList'
import { PlannerConversation } from './features/opencode/PlannerConversation'
import { HandoffRail } from './features/opencode/HandoffRail'
import { useRelayRoom } from './hooks/useRelayRoom'
import { persistPreference, preferenceKeys, readHandoffVisibility } from './lib/preferences'
import { api } from './lib/api'

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
 * Relay Room — layout only.
 *
 * Every piece of state lives in `useRelayRoom`; every request is declared in
 * `src/lib/api.ts`; every screen is one file under `src/features`. This file
 * exists to say what sits where, and nothing else.
 */
function WorkspaceApp() {
  const room = useRelayRoom()
  const { conversation } = room
  const locale = useLocale()
  const layoutRef = useRef<HTMLElement>(null)
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(loadPanelSizes)
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [handoffVisible, setHandoffVisible] = useState(readHandoffVisibility)

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

  const executorConversation = room.executorConversation
  const executorPane = executorConversation.view.thread ? <CodexConversation
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

  return <div dir={direction()} className="flex min-h-screen flex-col bg-paper text-ink lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <AlertStack alerts={room.alerts.list} onDismiss={room.alerts.onDismiss} />

    <AppHeader
      codexConnected={room.codexConnected}
      openCodeOnline={room.openCodeOnline}
      codexError={room.codexError}
      shellError={room.shellError}
      onResetLayout={resetPanelSizes}
      locale={locale}
      onToggleLanguage={() => setLocale(locale === 'en' ? 'ar' : 'en')}
      handoffVisible={handoffVisible}
      onToggleHandoff={() => setHandoffVisible(value => !value)}
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
      <ErrorBoundary label={tr("قائمة الجلسات مش معروضة صح دلوقتي.")}>
        <SessionList
          collapsed={sessionsCollapsed}
          onToggle={() => setSessionsCollapsed((value) => !value)}
          threads={room.threads}
          selectedId={room.selectedId}
          onSelect={room.onSelectThread}
          onCreate={room.onCreateThread}
          creating={room.creating}
          connected={room.codexConnected}
          codexIdentity={room.codexIdentity}
          workRoot={room.workRoot}
          onChooseWorkRoot={room.onChooseWorkRoot}
          onOpenThreadFolder={room.onOpenThreadFolder}
          choosingWorkRoot={room.choosingWorkRoot}
        />
      </ErrorBoundary>

      <ErrorBoundary label={tr("محادثة Codex مش معروضة صح دلوقتي.")}>
        {reverse ? plannerPane : codexPane}
      </ErrorBoundary>

      <ErrorBoundary label={tr("مسار التفويض مش معروض صح دلوقتي.")}>
        {handoffVisible ? (reverse ? codexPane : codexToCodex ? <aside dir={direction()} className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">
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
        />) : null}
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
    <TerminalDock cwd={room.workRoot || conversation.view.thread?.directory} />
  </div>
}

function LicenseGate() {
  const isArabic = useLocale() === 'ar'
  const [checking, setChecking] = useState(true)
  const [active, setActive] = useState(false)
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    let mounted = true
    void api.licenseStatus().then(result => {
      if (!mounted) return
      setActive(result.active || (result.free?.remaining ?? 0) > 0)
      setFreeRemaining(result.free?.remaining ?? 0)
    }).catch(reason => {
      if (mounted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (mounted) setChecking(false) })
    return () => { mounted = false }
  }, [])

  const activate = async (event: FormEvent) => {
    event.preventDefault()
    setActivating(true)
    setError('')
    try {
      const result = await api.activateLicense(key)
      setActive(result.active)
      setKey('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setActivating(false) }
  }

  if (active) return <WorkspaceApp />
  const title = isArabic ? 'تفعيل Coding Room' : 'Activate Coding Room'
  const description = freeRemaining !== null && freeRemaining <= 0
    ? (isArabic ? 'انتهت الطلبات المجانية لهذا اليوم. أدخل مفتاح تفعيل للمتابعة.' : 'Your free requests for today are used. Enter an activation key to continue.')
    : (isArabic ? 'أدخل مفتاح التفعيل أو استخدم رصيدك المجاني. كل رسالة ترسلها تستهلك طلبًا واحدًا.' : 'Enter an activation key or use your free quota. Each message uses one request.')
  return <main dir={isArabic ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-paper px-5 text-ink">
    <form onSubmit={activate} className="w-full max-w-md rounded-2xl border border-line bg-card p-7 shadow-xl shadow-black/5">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-relay-tint text-relay-ink"><KeyRound className="h-5 w-5" /></div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{description}</p>
      <label htmlFor="license-key" className="mt-6 block text-xs font-semibold">{isArabic ? 'مفتاح التفعيل' : 'Activation key'}</label>
      <input id="license-key" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder="CR-…" className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-sm outline-none focus:border-relay" />
      {error ? <p role="alert" className="mt-3 rounded-lg border border-relay/30 bg-relay-tint px-3 py-2 text-xs leading-5 text-relay-ink">{error}</p> : null}
      <button type="submit" disabled={activating || checking || !key.trim()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-relay px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
        {activating || checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {checking ? (isArabic ? 'جارٍ التحقق…' : 'Checking…') : activating ? (isArabic ? 'جارٍ التفعيل…' : 'Activating…') : (isArabic ? 'تفعيل' : 'Activate')}
      </button>
    </form>
  </main>
}

export default function App() {
  return <LicenseGate />
}
