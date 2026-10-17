import { openSupport } from './SupportChat'
import { direction, tr } from '../lib/i18n'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Settings, X, Check, Brain, Wrench, Palette, Puzzle, SlidersHorizontal, Languages, PanelRightClose, PanelRightOpen, RefreshCw, RotateCcw, Wifi, KeyRound, ArrowUpRight, Bot, TerminalSquare, TriangleAlert, Info } from 'lucide-react'
import { api } from '../lib/api'
import { usePolling } from '../hooks/usePolling'
import { cx } from '../lib/cx'
import type { CodexModelInfo, ModelInfo, WorkflowSetup } from '../lib/types'
import { ThemePanel } from './ThemePanel'
import { SettingsSelect } from './ui/SettingsSelect'
import { OpenCodeModelPicker } from './ui/OpenCodeModelPicker'
import { useProviderActivity } from '../hooks/useProviderActivity'
import type { ProviderId } from '../lib/types'

type UpdateCheckResult = { status: string; version?: string; message?: string }

declare global {
  interface Window {
    codingRoomUpdates?: {
      check: () => Promise<UpdateCheckResult>
      retry: () => Promise<UpdateCheckResult>
      onMandatoryUpdate: (callback: (data: { version?: string }) => void) => () => void
      onMandatoryUpdateProgress: (callback: (data: { percent: number }) => void) => () => void
      onMandatoryUpdateError: (callback: (data: { message: string }) => void) => () => void
    }
  }
}

interface SettingsDialogProps {
  codexConnected: boolean
  openCodeOnline: boolean
  codexError?: string
  onResetLayout: () => void
  locale: 'ar' | 'en'
  onToggleLanguage: () => void
  handoffVisible: boolean
  onToggleHandoff: () => void
  onOpenExtensions: () => void
}

export function SettingsDialog({ codexConnected, openCodeOnline, codexError, onResetLayout, locale, onToggleLanguage, handoffVisible, onToggleHandoff, onOpenExtensions }: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const activity = useProviderActivity()
  const [changingProvider, setChangingProvider] = useState<ProviderId | null>(null)
  const [providerError, setProviderError] = useState('')
  const [tab, setTab] = useState<'application' | 'account' | 'setup' | 'themes' | 'system'>('application')
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const saved = usePolling(open ? api.workflow : null, 0)
  const [setup, setSetup] = useState<WorkflowSetup>({ planner: 'codex', plannerModel: '', executor: 'opencode', executorModel: '' })
  const [codexModels, setCodexModels] = useState<CodexModelInfo[]>([])
  const [openCodeModels, setOpenCodeModels] = useState<ModelInfo[]>([])
  const [clineModels, setClineModels] = useState<{ id: string; name: string; free: boolean }[]>([])
  const [clineError, setClineError] = useState('')
  const clineStatus = usePolling(open && activity.providers.cline ? api.clineStatus : null, 0)
  // One-shot probe while the dialog is open so the OpenCode row can tell
  // "confirmed offline" apart from "not yet checked / request failed"
  // (`openCodeOnline` alone collapses both into a red "Offline").
  const openCodeStatus = usePolling(open && activity.providers.opencode ? api.openCodeStatus : null, 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [licenseInfo, setLicenseInfo] = useState<Awaited<ReturnType<NonNullable<Window['codingRoomLicense']>['status']>> | null>(null)
  const [activationKey, setActivationKey] = useState('')
  const [activatingLicense, setActivatingLicense] = useState(false)
  const [licenseError, setLicenseError] = useState('')
  useEffect(() => {
    if (!saved.data) return
    setSetup({
      planner: saved.data.workflow.planner ?? 'codex',
      plannerModel: saved.data.workflow.plannerModel ?? '',
      executor: saved.data.workflow.executor ?? 'opencode',
      executorModel: saved.data.workflow.executorModel ?? '',
      clineProvider: saved.data.workflow.clineProvider ?? 'cline',
    })
  }, [saved.data])
  useEffect(() => {
    if (!open) return
    let current = true
    void Promise.all([activity.providers.codex ? api.codexModels().catch(() => []) : Promise.resolve([]), activity.providers.opencode ? api.models().catch(() => []) : Promise.resolve([])]).then(([codex, opencode]) => {
      if (!current) return
      setCodexModels(codex)
      setOpenCodeModels(opencode)
    })
    return () => { current = false }
  }, [open, activity.providers.codex, activity.providers.opencode])
  useEffect(() => {
    if (!open) return
    if (!activity.providers.cline || (setup.planner !== 'cline' && setup.executor !== 'cline')) { setClineModels([]); return }
    let current = true
    setClineModels([]); setClineError('')
    void api.clineModels(setup.clineProvider || 'cline').then(models => { if (current) setClineModels(models) }).catch(failure => { if (current) setClineError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { current = false }
  }, [open, setup.planner, setup.executor, setup.clineProvider, activity.providers.cline])
  async function toggleProvider(id: ProviderId) {
    if (changingProvider) return
    setChangingProvider(id); setProviderError('')
    try { await activity.set(id, !activity.providers[id]) }
    catch (failure) { setProviderError(failure instanceof Error ? failure.message : String(failure)); await activity.refresh() }
    finally { setChangingProvider(null) }
  }
  useEffect(() => {
    let current = true
    const refresh = async () => {
      try {
        const status = await api.licenseStatus()
        if (current) setLicenseInfo(status)
      } catch (failure) {
        if (current) setLicenseError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 45_000)
    return () => { current = false; window.clearInterval(timer) }
  }, [])
  function show() { setOpen(true); setError(null); setNotice(null); dialog.current?.showModal() }
  const visibleQuota = licenseInfo?.active ? licenseInfo.entitlement?.remaining : 0
  const usageTitle = locale === 'ar'
    ? `الإعدادات · المتبقي ${visibleQuota ?? '…'} طلب`
    : `Settings · ${visibleQuota ?? '…'} requests remaining`
  async function checkForUpdates() {
    if (checkingUpdates) return
    setCheckingUpdates(true)
    setUpdateResult(null)
    try {
      if (!window.codingRoomUpdates) {
        setUpdateResult({ status: 'unsupported' })
        return
      }
      setUpdateResult(await window.codingRoomUpdates.check())
    } catch (failure) {
      setUpdateResult({ status: 'error', message: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setCheckingUpdates(false)
    }
  }
  async function activateLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activationKey.trim()) return
    setActivatingLicense(true)
    setLicenseError('')
    try {
      const activated = await api.activateLicense(activationKey)
      setLicenseInfo(current => ({ ...current, ...activated }))
      setActivationKey('')
      const refreshed = await api.licenseStatus()
      setLicenseInfo(refreshed)
    } catch (failure) { setLicenseError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setActivatingLicense(false) }
  }
  function choose(role: 'planner' | 'executor', agent: WorkflowSetup['planner']) {
    setSetup(current => ({ ...current, [role]: agent, [`${role}Model`]: '' }))
    setNotice(null)
  }
  function modelOptions(agent: WorkflowSetup['planner']) {
    if (agent === 'cline') return clineModels.map(model => ({ id: model.id, name: `${model.free ? 'FREE · ' : ''}${model.name}` }))
    return agent === 'codex'
      ? codexModels.map(model => ({ id: model.model, name: model.displayName }))
      : openCodeModels.filter(model => model.tools).map(model => ({ id: model.id, name: model.name }))
  }
  async function save() {
    setSaving(true); setError(null)
    try { await api.saveWorkflow(setup); window.dispatchEvent(new Event('openzero:workflow-changed')); setNotice(locale === 'ar' ? 'تم الحفظ. افتح محادثة جديدة.' : 'Saved. Open a new conversation.'); await saved.refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : tr("تعذّر حفظ الإعدادات.")) }
    finally { setSaving(false) }
  }
  const sections = [
    { id: 'application' as const, icon: SlidersHorizontal, label: locale === 'ar' ? 'عام' : 'General', description: locale === 'ar' ? 'اللغة وترتيب مساحة العمل وأدوات المشروع' : 'Language, workspace layout and project tools' },
    { id: 'account' as const, icon: KeyRound, label: locale === 'ar' ? 'الحساب والترخيص' : 'Account & license', description: locale === 'ar' ? 'رصيد الطلبات ومفتاح التفعيل والدعم' : 'Request allowance, activation key and support' },
    { id: 'setup' as const, icon: Brain, label: locale === 'ar' ? 'توزيع الأدوار' : 'Agents & roles', description: locale === 'ar' ? 'اختيار المفكّر والمنفّذ والموديلات' : 'Choose your planner, executor and models' },
    { id: 'themes' as const, icon: Palette, label: locale === 'ar' ? 'المظهر' : 'Appearance', description: locale === 'ar' ? 'الثيم وأيقونات الملفات' : 'Theme and file icons' },
    { id: 'system' as const, icon: Wifi, label: locale === 'ar' ? 'الاتصال والتحديثات' : 'Connections & updates', description: locale === 'ar' ? 'حالة المساعدين وإصدار التطبيق' : 'Agent connections and application updates' },
  ]
  const currentSection = sections.find(section => section.id === tab)!
  // Fresh probe first, then the always-on status polling as evidence; no data
  // from both means "unknown", never a confirmed offline.
  const openCodeAvailable = openCodeStatus.data ? openCodeStatus.data.online : openCodeOnline ? true as const : undefined
  const row = 'flex flex-wrap items-center justify-between gap-3 py-4'
  const action = 'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs font-semibold text-ink hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40'
  return <>
    <button type="button" onClick={show} aria-label={usageTitle} title={usageTitle} style={{ WebkitAppRegion: 'no-drag' } as CSSProperties} className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-line px-2 text-ink-soft transition-colors hover:border-relay/40 hover:bg-relay-tint hover:text-relay-ink"><Settings className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="text-[10px] font-bold tabular-nums text-relay-ink" aria-live="polite">{visibleQuota ?? '…'}</span></button>
    <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="settings-title" dir={direction()} style={{ WebkitAppRegion: 'no-drag' } as CSSProperties} className="fixed inset-0 m-auto h-[min(680px,90dvh)] max-h-none w-[min(94vw,920px)] max-w-none overflow-hidden rounded-2xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-overlay/40">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4"><div className="flex items-center gap-2.5"><Settings className="h-4 w-4 text-ink-soft" aria-hidden="true" /><h2 id="settings-title" className="text-base font-semibold">{tr('الإعدادات')}</h2></div><button type="button" aria-label={tr('إغلاق الإعدادات')} onClick={() => dialog.current?.close()} className="rounded-lg p-2 text-ink-soft hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40"><X className="h-4 w-4" /></button></header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={tr('أقسام الإعدادات')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-paper/50 p-3 sm:w-52 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-e">
            {sections.map(section => <button key={section.id} type="button" aria-current={tab === section.id ? 'page' : undefined} onClick={() => setTab(section.id)} className={cx('inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-start text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40', tab === section.id ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-card hover:text-ink')}><section.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{section.label}</button>)}
          </nav>
          <div className="thin-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6" key={tab}>
            <header className="mb-5"><h3 className="text-lg font-semibold text-ink">{currentSection.label}</h3>{tab !== 'setup' && tab !== 'system' ? <p className="mt-1 text-xs leading-5 text-ink-soft">{currentSection.description}</p> : null}</header>
            {tab === 'application' ? <section className="space-y-5">
              <div className="divide-y divide-line rounded-xl border border-line px-4">
                <div className={row}><div><p className="text-xs font-semibold">{locale === 'ar' ? 'لغة الواجهة' : 'Interface language'}</p><p className="mt-1 text-[11px] text-ink-soft">{locale === 'ar' ? 'العربية' : 'English'}</p></div><button type="button" onClick={onToggleLanguage} className={action}><Languages className="h-4 w-4" />{locale === 'en' ? 'العربية' : 'English'}</button></div>
                <div className={row}><div><p className="text-xs font-semibold">{locale === 'ar' ? 'مسار التنفيذ والتفويض' : 'Execution & handoff panel'}</p><p className="mt-1 text-[11px] text-ink-soft">{handoffVisible ? (locale === 'ar' ? 'ظاهر في مساحة الإيجنت' : 'Visible in the Agent workspace') : (locale === 'ar' ? 'مخفي حاليًا' : 'Currently hidden')}</p></div><button type="button" onClick={onToggleHandoff} aria-pressed={handoffVisible} className={action}>{handoffVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}{tr(handoffVisible ? 'إخفاء التفويض' : 'إظهار التفويض')}</button></div>
                <div className={row}><div><p className="text-xs font-semibold">{locale === 'ar' ? 'ترتيب مساحة العمل' : 'Workspace layout'}</p><p className="mt-1 text-[11px] text-ink-soft">{locale === 'ar' ? 'استعادة أحجام اللوحات الافتراضية' : 'Restore default panel sizes'}</p></div><button type="button" onClick={onResetLayout} className={action}><RotateCcw className="h-4 w-4" />{tr('إعادة ضبط العرض')}</button></div>
              </div>
              <button type="button" onClick={() => { dialog.current?.close(); onOpenExtensions() }} className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-4 text-start hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40"><Puzzle className="h-5 w-5 shrink-0 text-relay-ink" aria-hidden="true" /><span className="flex-1"><span className="block text-xs font-semibold">{locale === 'ar' ? 'الإضافات وNx Console' : 'Extensions & Nx Console'}</span><span className="mt-1 block text-[11px] text-ink-soft">{locale === 'ar' ? 'الانتقال إلى مساحة IDE' : 'Switch to the IDE workspace'}</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-ink-soft rtl:-scale-x-100" aria-hidden="true" /></button>
            </section> : null}
            {tab === 'account' ? <section className="space-y-5">
        <section aria-labelledby="quota-title" className="space-y-4 rounded-xl border border-line bg-paper/40 p-4">
          <div className="flex items-center justify-between gap-3"><div><h3 id="quota-title" className="text-sm font-bold">{locale === 'ar' ? 'الاستخدام اليومي' : 'Daily usage'}</h3><p className="mt-1 text-[10px] text-ink-soft">{locale === 'ar' ? 'مفتاح تفعيل صالح مطلوب. الرسائل تستهلك رصيد المفتاح.' : 'A valid activation key is required. Messages use your key quota.'}</p></div>
            <button type="button" onClick={() => void api.licenseStatus().then(setLicenseInfo).catch(failure => setLicenseError(failure instanceof Error ? failure.message : String(failure)))} className="rounded-md p-2 text-ink-soft hover:bg-paper" aria-label={locale === 'ar' ? 'تحديث الرصيد' : 'Refresh usage'}><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
          <div className="divide-y divide-line rounded-lg border border-line bg-paper px-3">
            {licenseInfo?.active ? <QuotaRow label={`${locale === 'ar' ? 'المفتاح المفعّل' : 'Active key'}${licenseInfo.entitlement?.label ? ` · ${licenseInfo.entitlement.label}` : ''}`} remaining={licenseInfo.entitlement?.remaining} dailyLimit={licenseInfo.entitlement?.dailyLimit} loading={false} /> : null}
          </div>
          {licenseInfo?.active && licenseInfo.entitlement?.expiresAt ? <p className="text-[10px] text-ink-soft">{locale === 'ar' ? 'ينتهي المفتاح:' : 'Key expires:'} <time dir="ltr">{new Date(licenseInfo.entitlement.expiresAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</time></p> : null}
          <form onSubmit={event => void activateLicense(event)} className="flex flex-col gap-2 sm:flex-row">
            <input aria-label={locale === 'ar' ? 'مفتاح التفعيل' : 'Activation key'} autoComplete="off" spellCheck={false} value={activationKey} onChange={event => setActivationKey(event.target.value)} placeholder={locale === 'ar' ? 'أدخل مفتاح التفعيل' : 'Enter activation key'} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs outline-none focus:border-relay" />
            <button type="submit" disabled={activatingLicense || !activationKey.trim()} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-relay px-3 py-2 text-xs font-bold text-on-accent hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-50">{activatingLicense ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}{activatingLicense ? (locale === 'ar' ? 'جارٍ التفعيل…' : 'Activating…') : (licenseInfo?.active ? (locale === 'ar' ? 'تغيير المفتاح' : 'Replace key') : (locale === 'ar' ? 'تفعيل المفتاح' : 'Activate key'))}</button>
          </form>
          {licenseError ? <p role="alert" className="text-xs text-review-ink">{licenseError}</p> : null}
        </section>

        <button type="button" onClick={() => { dialog.current?.close(); openSupport() }} className="w-full rounded-lg border border-line bg-relay-tint px-4 py-3 text-start text-sm font-bold text-relay-ink">{locale === 'ar' ? 'شات الدعم' : 'Support chat'}<span className="mt-1 block text-xs font-normal text-ink-soft">{locale === 'ar' ? 'اطلب مفتاح تفعيل أو تواصل مع الدعم' : 'Request an activation key or contact support'}</span></button>

            </section> : null}
            {tab === 'system' ? <section className="space-y-6">
        <section aria-labelledby="settings-agents-title">
          <h4 id="settings-agents-title" className="mb-3 text-xs font-semibold text-ink-soft">{locale === 'ar' ? 'المساعدون' : 'AI assistants'}</h4>
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {(['codex', 'opencode', 'cline'] as const).map(id => {
              const enabled = activity.providers[id]
              const available = id === 'codex' ? codexConnected : id === 'opencode' ? openCodeAvailable : clineStatus.data?.available
              const name = id === 'codex' ? 'Codex' : id === 'opencode' ? 'OpenCode' : 'Cline'
              const Icon = id === 'opencode' ? TerminalSquare : id === 'cline' ? Brain : Bot
              const loading = !activity.ready
                || (enabled && id === 'cline' && clineStatus.status === 'loading')
                || (enabled && id === 'opencode' && openCodeStatus.status === 'loading')
              // Only OpenCode gets a real "unknown" state: Codex stays boolean
              // and Cline keeps its `available` rendering untouched.
              const unknown = enabled && id === 'opencode' && available === undefined
              return <div key={id} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-paper/40">
                <span aria-hidden="true" className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper text-ink-soft', enabled && 'text-relay-ink')}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold"><bdi>{name}</bdi></p><span className={cx('mt-1 inline-flex items-center gap-1.5 text-[11px]', !enabled || loading || unknown ? 'text-ink-soft' : available ? 'text-ready-ink' : 'text-review-ink')}><span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', loading || unknown ? 'bg-ink-soft/40' : !enabled ? 'bg-ink-soft/30' : available ? 'bg-ready' : 'bg-review')} />{loading ? (locale === 'ar' ? 'جارٍ الفحص…' : 'Checking…') : !enabled ? (locale === 'ar' ? 'موقوف' : 'Disabled') : unknown ? (locale === 'ar' ? 'غير معروف' : 'Unknown') : available ? (locale === 'ar' ? 'متاح' : 'Available') : id === 'cline' ? (locale === 'ar' ? 'غير متاح' : 'Unavailable') : (locale === 'ar' ? 'غير متصل' : 'Offline')}</span></div>
                <button type="button" role="switch" aria-checked={enabled} aria-busy={changingProvider === id} title={`${locale === 'ar' ? enabled ? 'إيقاف' : 'تشغيل' : enabled ? 'Disable' : 'Enable'} ${name}`} aria-label={`${locale === 'ar' ? enabled ? 'إيقاف' : 'تشغيل' : enabled ? 'Disable' : 'Enable'} ${name}`} disabled={!activity.ready || Boolean(changingProvider)} onClick={() => void toggleProvider(id)} className="inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-wait disabled:opacity-40">
                  <span aria-hidden="true" className={cx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', enabled ? 'bg-relay' : 'bg-ink-soft/25')}>{changingProvider === id ? <RefreshCw className="mx-auto h-3 w-3 animate-spin text-on-accent" /> : <span className={cx('absolute left-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform', enabled && 'translate-x-4')} />}</span>
                </button>
              </div>
            })}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-ink-soft">{locale === 'ar' ? 'إيقاف المساعد يوقف طلباته في الخلفية.' : 'Disabled assistants stop making background requests.'}</p>
          {providerError || activity.error ? <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-lg bg-review-tint p-3 text-review-ink"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1 break-words text-xs leading-5">{providerError || activity.error}</p><button type="button" onClick={() => { setProviderError(''); void activity.refresh() }} aria-label={locale === 'ar' ? 'إعادة المحاولة' : 'Retry'} title={locale === 'ar' ? 'إعادة المحاولة' : 'Retry'} className="rounded-md p-1.5 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-review/40"><RefreshCw className="h-3.5 w-3.5" /></button></div> : null}
          {activity.providers.codex && !codexConnected && codexError ? <details className="mt-3 text-xs text-ink-soft"><summary className="cursor-pointer py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">{locale === 'ar' ? 'تفاصيل اتصال Codex' : 'Codex connection details'}</summary><p className="mt-2 break-words rounded-lg bg-paper p-3 text-[11px] leading-5">{tr(codexError)}</p></details> : null}
        </section>

              <section aria-labelledby="settings-updates-title" className="border-t border-line pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><h4 id="settings-updates-title" className="inline-flex items-center gap-2 text-sm font-semibold"><RotateCcw className="h-4 w-4 text-ink-soft" aria-hidden="true" />{locale === 'ar' ? 'تحديثات التطبيق' : 'Application updates'}</h4><button type="button" onClick={() => void checkForUpdates()} disabled={checkingUpdates} className={cx(action, 'w-full justify-center sm:w-auto disabled:cursor-wait disabled:opacity-60')}><RefreshCw className={cx('h-3.5 w-3.5', checkingUpdates && 'animate-spin')} aria-hidden="true" />{checkingUpdates ? (locale === 'ar' ? 'جارٍ الفحص…' : 'Checking…') : (locale === 'ar' ? 'فحص التحديثات' : 'Check for updates')}</button></div>
        {checkingUpdates || updateResult ? <div role="status" aria-live="polite" className={cx('mt-4 flex items-start gap-2.5 rounded-lg p-3 text-xs leading-5', !checkingUpdates && ['available', 'current'].includes(updateResult?.status || '') ? 'bg-ready-tint text-ready-ink' : !checkingUpdates && updateResult?.status === 'error' ? 'bg-review-tint text-review-ink' : 'bg-paper text-ink-soft')}>
          {checkingUpdates ? <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : ['available', 'current'].includes(updateResult?.status || '') ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : updateResult?.status === 'error' ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}<p className="min-w-0 break-words">
          {checkingUpdates ? tr("جارٍ التحقق من تحديثات التطبيق…") : updateResult?.status === 'available'
            ? tr("يتوفر الإصدار {{0}} ويجري تنزيله في الخلفية.", [updateResult.version ?? ''])
            : updateResult?.status === 'current' ? tr("التطبيق محدّث بالفعل ({{0}}).", [updateResult.version ?? ''])
              : updateResult?.status === 'portable' ? tr("التحديث التلقائي غير متاح لنسخة Portable؛ ثبّت نسخة Setup.")
                : updateResult?.status === 'unsupported' || updateResult?.status === 'unavailable' ? tr("فحص التحديثات متاح في نسخة سطح المكتب المثبّتة.")
                  : tr("تعذر التحقق من التحديثات: {{0}}", [updateResult?.message ?? ''])}
        </p></div> : null}

              </section>
            </section> : null}
            {tab === 'themes' ? <ThemePanel /> : null}
            {tab === 'setup' ? <section className="space-y-5">
              <div className="divide-y divide-line">
                {(['planner', 'executor'] as const).map(role => <fieldset key={role} disabled={saving || !saved.data} className="min-w-0 py-5 first:pt-0 last:pb-0">
                  <legend className="sr-only">{role === 'planner' ? (locale === 'ar' ? 'المفكّر والمراجع' : 'Planner & reviewer') : (locale === 'ar' ? 'المنفّذ' : 'Executor')}</legend>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold">{role === 'planner' ? <Brain className="h-4 w-4 text-ink-soft" aria-hidden="true" /> : <Wrench className="h-4 w-4 text-ink-soft" aria-hidden="true" />}{role === 'planner' ? (locale === 'ar' ? 'المفكّر والمراجع' : 'Planner & reviewer') : (locale === 'ar' ? 'المنفّذ' : 'Executor')}</div>
                  <div className="flex flex-wrap gap-2">{saved.data?.agents.filter(agent => agent.available).map(agent => {
                    const unavailable = agent.id === 'opencode' && setup[role === 'planner' ? 'executor' : 'planner'] === 'opencode'
                    return <label key={agent.id} title={unavailable ? (locale === 'ar' ? 'OpenCode مستخدم في الدور الآخر' : 'OpenCode is assigned to the other role') : undefined} className={cx('relative flex min-h-10 min-w-24 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-within:ring-2 focus-within:ring-relay/40', setup[role] === agent.id ? 'border-relay/50 bg-relay-tint text-relay-ink' : 'border-line bg-transparent text-ink-soft hover:bg-paper hover:text-ink', unavailable && 'cursor-not-allowed opacity-40')}>
                      <input type="radio" name={role} value={agent.id} checked={setup[role] === agent.id} disabled={unavailable} onChange={() => choose(role, agent.id as WorkflowSetup['planner'])} className="sr-only" /><span dir="ltr">{agent.name}</span>{setup[role] === agent.id ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    </label>
                  })}</div>
                  <div className="mt-3"><label htmlFor={`settings-model-${role}`} className="text-[11px] font-medium text-ink-soft">{locale === 'ar' ? 'الموديل' : 'Model'}</label>
                    {setup[role] === 'opencode' ? <OpenCodeModelPicker id={`settings-model-${role}`} label={locale === 'ar' ? 'موديل OpenCode' : 'OpenCode model'} placeholder={locale === 'ar' ? 'الافتراضي' : 'Default'} allowDefault models={openCodeModels.filter(model => model.tools)} value={setup[`${role}Model`]} disabled={saving || !saved.data} className="mt-2" onChange={value => { setNotice(null); setSetup(current => ({ ...current, [`${role}Model`]: value })) }} /> : <SettingsSelect id={`settings-model-${role}`} label={`${locale === 'ar' ? 'الموديل' : 'Model'} · ${role === 'planner' ? (locale === 'ar' ? 'المفكّر' : 'Planner') : (locale === 'ar' ? 'المنفّذ' : 'Executor')}`} value={setup[`${role}Model`]} disabled={saving || !saved.data}
                      options={[{ value: '', label: setup[role] === 'cline' ? (locale === 'ar' ? 'اختر الموديل' : 'Choose a model') : (locale === 'ar' ? 'الافتراضي' : 'Default') }, ...modelOptions(setup[role]).map(model => ({ value: model.id, label: model.name }))]}
                      onChange={value => { setNotice(null); setSetup(current => ({ ...current, [`${role}Model`]: value })) }} />}
                  </div>
                </fieldset>)}
              </div>
              {setup.planner === 'cline' || setup.executor === 'cline' ? <div className="border-t border-line pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="settings-cline-provider" className="text-xs font-semibold">{locale === 'ar' ? 'مزوّد Cline' : 'Cline provider'}</label>{clineStatus.data ? <span className="text-[11px] text-ink-soft">{clineStatus.data.providers.find(provider => provider.id === (setup.clineProvider || 'cline'))?.configured ? (locale === 'ar' ? 'تسجيل الدخول محفوظ' : 'Login saved') : <code dir="ltr">cline auth</code>}</span> : null}</div>
                <SettingsSelect id="settings-cline-provider" label={locale === 'ar' ? 'مزوّد Cline' : 'Cline provider'} value={setup.clineProvider || 'cline'} disabled={saving} options={[{ value: 'cline', label: 'Cline' }, { value: 'openrouter', label: 'OpenRouter' }, { value: 'anthropic', label: 'Anthropic' }]} onChange={value => { setNotice(null); setSetup(current => ({ ...current, clineProvider: value, plannerModel: current.planner === 'cline' ? '' : current.plannerModel, executorModel: current.executor === 'cline' ? '' : current.executorModel })) }} />
                {clineError || clineStatus.error ? <p role="alert" className="mt-2 text-xs text-review-ink">{clineError || clineStatus.error}</p> : null}
              </div> : null}
              {error || saved.error ? <p role="alert" className="text-xs text-review-ink">{tr(error || saved.error || '')}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p role={notice ? 'status' : undefined} className={cx('text-[11px]', notice ? 'text-ready-ink' : 'text-ink-soft')}>{notice || (locale === 'ar' ? 'يُطبّق على المحادثات الجديدة' : 'Applies to new conversations')}</p>
                <button type="button" onClick={() => void save()} disabled={saving || !saved.data || (setup.planner === 'cline' && !setup.plannerModel) || (setup.executor === 'cline' && !setup.executorModel)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-relay px-5 py-2 text-xs font-semibold text-on-accent hover:bg-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-45"><Check className="h-3.5 w-3.5" aria-hidden="true" />{saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (locale === 'ar' ? 'حفظ' : 'Save')}</button>
              </div>
            </section> : null}
          </div>
        </div>
      </div>
    </dialog>
  </>
}

function QuotaRow({ label, remaining, dailyLimit, loading }: { label: string; remaining?: number; dailyLimit?: number; loading: boolean }) {
  return <div className="flex min-h-11 items-center justify-between gap-3 py-2 text-xs">
    <span className="text-ink-soft">{label}</span>
    <span className="font-semibold tabular-nums text-ink" aria-live="polite">{loading ? '…' : remaining === undefined ? '—' : `${remaining} / ${dailyLimit ?? '—'}`}</span>
  </div>
}
