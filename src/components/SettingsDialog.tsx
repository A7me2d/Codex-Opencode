import { direction, tr } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { Settings, X, Check, Brain, Wrench, Palette, SlidersHorizontal, Languages, PanelRightClose, PanelRightOpen, RefreshCw, RotateCcw, Wifi, WifiOff } from 'lucide-react'
import { api } from '../lib/api'
import { usePolling } from '../hooks/usePolling'
import { cx } from '../lib/cx'
import type { CodexModelInfo, ModelInfo, WorkflowSetup } from '../lib/types'
import { ThemePanel } from './ThemePanel'
import { StateDot } from './ui/StateDot'

type UpdateCheckResult = { status: string; version?: string; message?: string }

declare global {
  interface Window {
    codingRoomUpdates?: { check: () => Promise<UpdateCheckResult> }
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
}

export function SettingsDialog({ codexConnected, openCodeOnline, codexError, onResetLayout, locale, onToggleLanguage, handoffVisible, onToggleHandoff }: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'application' | 'setup' | 'themes'>('application')
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const saved = usePolling(open ? api.workflow : null, 0)
  const [setup, setSetup] = useState<WorkflowSetup>({ planner: 'codex', plannerModel: '', executor: 'opencode', executorModel: '' })
  const [codexModels, setCodexModels] = useState<CodexModelInfo[]>([])
  const [openCodeModels, setOpenCodeModels] = useState<ModelInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!saved.data) return
    setSetup({
      planner: saved.data.workflow.planner ?? 'codex',
      plannerModel: saved.data.workflow.plannerModel ?? '',
      executor: saved.data.workflow.executor ?? 'opencode',
      executorModel: saved.data.workflow.executorModel ?? '',
    })
  }, [saved.data])
  useEffect(() => {
    if (!open) return
    void Promise.all([api.codexModels().catch(() => []), api.models().catch(() => [])]).then(([codex, opencode]) => {
      setCodexModels(codex)
      setOpenCodeModels(opencode)
    })
  }, [open])
  function show() { setOpen(true); setError(null); setNotice(null); dialog.current?.showModal() }
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
  function choose(role: 'planner' | 'executor', agent: WorkflowSetup['planner']) {
    setSetup(current => ({ ...current, [role]: agent, [`${role}Model`]: '' }))
    setNotice(null)
  }
  function modelOptions(agent: WorkflowSetup['planner']) {
    return agent === 'codex'
      ? codexModels.map(model => ({ id: model.model, name: model.displayName }))
      : openCodeModels.filter(model => model.tools).map(model => ({ id: model.id, name: model.name }))
  }
  async function save() {
    setSaving(true); setError(null)
    try { await api.saveWorkflow(setup); setNotice(tr("تم حفظ الإعداد. افتح محادثة جديدة لتبدأ بالأدوار المختارة.")); await saved.refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : tr("تعذّر حفظ الإعدادات.")) }
    finally { setSaving(false) }
  }
  return <>
    <button type="button" onClick={show} aria-label={tr("الإعدادات")} title={tr("الإعدادات")} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-relay/40 hover:bg-relay-tint hover:text-relay-ink"><Settings className="h-4 w-4" aria-hidden="true" /></button>
    <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="settings-title" dir={direction()} className="fixed inset-0 m-auto w-[min(94vw,640px)] max-h-[90dvh] overflow-auto rounded-2xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-overlay/40">
      <header className="flex items-center justify-between border-b border-line px-6 py-4"><h2 id="settings-title" className="text-base font-bold">{tr("الإعدادات")}</h2><button aria-label={tr("إغلاق الإعدادات")} onClick={() => dialog.current?.close()} className="rounded-lg p-2 hover:bg-paper"><X className="h-4 w-4" /></button></header>
      <nav aria-label={tr("أقسام الإعدادات")} className="flex flex-wrap gap-2 border-b border-line px-6 py-3">
        <button onClick={() => setTab('application')} aria-pressed={tab === 'application'} className={cx('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold', tab === 'application' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}><SlidersHorizontal className="h-4 w-4" />{tr("عام")}</button>
        <button onClick={() => setTab('setup')} aria-pressed={tab === 'setup'} className={cx('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold', tab === 'setup' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}><Wrench className="h-4 w-4" />{tr("Setup · توزيع الأدوار")}</button>
        <button onClick={() => setTab('themes')} aria-pressed={tab === 'themes'} className={cx('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold', tab === 'themes' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}><Palette className="h-4 w-4" />{tr("الثيمات")}</button>
      </nav>
      {tab === 'application' ? <section className="space-y-5 p-6">
        <div>
          <h3 className="text-sm font-bold">{tr("حالة التطبيق والاتصال")}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-3">
              {codexConnected ? <Wifi className="h-4 w-4 text-relay" aria-hidden="true" /> : <WifiOff className="h-4 w-4 text-review" aria-hidden="true" />}
              <div className="min-w-0"><p className="text-xs font-bold">Codex Desktop</p><p className="mt-1 text-[10px] text-ink-soft">{codexConnected ? tr("متصل") : tr("غير متصل")}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-3">
              <StateDot active={openCodeOnline} warning={!openCodeOnline} />
              <div className="min-w-0"><p className="text-xs font-bold">OpenCode</p><p className="mt-1 text-[10px] text-ink-soft">{openCodeOnline ? tr("متاح") : tr("لا يرد")}</p></div>
            </div>
          </div>
          {!codexConnected && codexError ? <p role="status" className="mt-3 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink">{tr("افتح Codex Desktop وسجّل الدخول. سيحاول التطبيق الاتصال تلقائيًا.")} {tr(codexError)}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">
          <button type="button" onClick={onToggleLanguage} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-soft transition-colors hover:bg-paper"><Languages className="h-4 w-4" />{locale === 'en' ? 'العربية' : 'English'}</button>
          <button type="button" onClick={onResetLayout} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-soft transition-colors hover:bg-paper"><RotateCcw className="h-4 w-4" />{tr("إعادة ضبط العرض")}</button>
          <button type="button" onClick={onToggleHandoff} aria-pressed={handoffVisible} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-soft transition-colors hover:bg-paper">{handoffVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}{tr(handoffVisible ? 'إخفاء التفويض' : 'إظهار التفويض')}</button>
          <button type="button" onClick={() => void checkForUpdates()} disabled={checkingUpdates} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-relay/30 bg-relay-tint px-3 py-2 text-xs font-bold text-relay-ink transition-colors hover:border-relay/50 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={cx('h-4 w-4', checkingUpdates && 'animate-spin')} />{tr("التحقق من تحديثات التطبيق")}</button>
        </div>
        {checkingUpdates || updateResult ? <p role="status" aria-live="polite" className="text-xs leading-5 text-ink-soft">
          {checkingUpdates ? tr("جارٍ التحقق من تحديثات التطبيق…") : updateResult?.status === 'available'
            ? tr("يتوفر الإصدار {{0}} ويجري تنزيله في الخلفية.", [updateResult.version ?? ''])
            : updateResult?.status === 'current' ? tr("التطبيق محدّث بالفعل ({{0}}).", [updateResult.version ?? ''])
              : updateResult?.status === 'portable' ? tr("التحديث التلقائي غير متاح لنسخة Portable؛ ثبّت نسخة Setup.")
                : updateResult?.status === 'unsupported' || updateResult?.status === 'unavailable' ? tr("فحص التحديثات متاح في نسخة سطح المكتب المثبّتة.")
                  : tr("تعذر التحقق من التحديثات: {{0}}", [updateResult?.message ?? ''])}
        </p> : null}
      </section> : tab === 'themes' ? <ThemePanel /> : <section className="space-y-6 p-6">
        <p className="text-xs leading-6 text-ink-soft">{tr("وزّع الشغل بين الطرفين. الاختيار يُحفظ للمحادثات الجديدة؛ كل محادثة موجودة تحتفظ بأدوارها.")}</p>
        {(['planner', 'executor'] as const).map((role, index) => <fieldset key={role} disabled={saving || !saved.data}>
          <legend className="mb-3 flex items-center gap-2 text-sm font-bold">{role === 'planner' ? <Brain className="h-4 w-4 text-relay" /> : <Wrench className="h-4 w-4 text-ready" />}{index + 1}. {role === 'planner' ? tr("تحب مين المفكّر والمراجع؟") : tr("تحب مين المنفّذ؟")}</legend>
          <div className="grid grid-cols-2 gap-3">{saved.data?.agents.filter(agent => agent.available).map(agent => <label key={agent.id} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors', setup[role] === agent.id ? 'border-relay bg-relay-tint/50' : 'border-line bg-paper hover:border-relay/40')}>
            <input type="radio" name={role} value={agent.id} checked={setup[role] === agent.id} disabled={agent.id === 'opencode' && setup[role === 'planner' ? 'executor' : 'planner'] === 'opencode'} onChange={() => choose(role, agent.id as WorkflowSetup['planner'])} className="accent-relay" /><span className="flex-1 text-sm font-semibold" dir="ltr">{agent.name}</span>{setup[role] === agent.id ? <Check className="h-4 w-4 text-relay" /> : null}
          </label>)}</div>
          <label className="mt-3 block text-xs font-semibold text-ink-soft">{tr("الموديل")}<select value={setup[`${role}Model`]} onChange={event => setSetup(current => ({ ...current, [`${role}Model`]: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink">
              <option value="">{tr("استخدم الموديل الافتراضي")}</option>
              {modelOptions(setup[role]).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
        </fieldset>)}
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink-soft">{tr("المفكّر يخطط ويراجع، والمنفّذ يعدّل الملفات ويختبر النتيجة.")}</p>
        <div className="border-t border-line pt-4"><p className="text-xs text-ink-soft">{tr("أطراف إضافية مستقبلًا")}</p><div className="mt-2 flex gap-2">{saved.data?.agents.filter(agent => !agent.available).map(agent => <span key={agent.id} className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-ink-soft">{agent.name} {' '}{tr("· لاحقًا")}</span>)}</div></div>
        {error || saved.error ? <p role="alert" className="text-xs text-review-ink">{tr(error || saved.error || '')}</p> : null}
        {notice ? <p role="status" className="text-xs leading-6 text-ready-ink">{tr(notice)}</p> : null}
        <button onClick={() => void save()} disabled={saving || !saved.data} className="w-full rounded-xl bg-relay px-4 py-3 text-sm font-bold text-on-accent hover:bg-relay-ink disabled:opacity-45">{saving ? tr("جارٍ الحفظ…") : tr("حفظ توزيع الأدوار")}</button>
      </section>}
    </dialog>
  </>
}
