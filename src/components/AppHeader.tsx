import { tr, type AppLocale } from '../lib/i18n'
import { useState, type CSSProperties } from 'react'
import { GitPullRequestArrow, Languages, PanelRightClose, PanelRightOpen, RefreshCw, RotateCcw, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { config } from '../app/config'
import { StateDot } from './ui/StateDot'
import { StatusPill } from './ui/StatusPill'
import { SettingsDialog } from './SettingsDialog'

type UpdateCheckResult = { status: string; version?: string; message?: string }

declare global {
  interface Window {
    codingRoomUpdates?: { check: () => Promise<UpdateCheckResult> }
  }
}

export interface AppHeaderProps {
  codexConnected: boolean
  openCodeOnline: boolean
  codexError?: string
  /** A failure that happened in the shell itself (create session, open folder). */
  shellError: string | null
  onResetLayout: () => void
  locale: AppLocale
  onToggleLanguage: () => void
  handoffVisible: boolean
  onToggleHandoff: () => void
}

/** Fixed top bar: who we are, and whether each agent is reachable right now. */
export function AppHeader({ codexConnected, openCodeOnline, codexError, shellError, onResetLayout, locale, onToggleLanguage, handoffVisible, onToggleHandoff }: AppHeaderProps) {
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)

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
    } catch (error) {
      setUpdateResult({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setCheckingUpdates(false)
    }
  }

  return <header className="shrink-0 border-b border-line bg-card">
    <div className="flex h-[38px] select-none items-center gap-2 px-5 pr-[150px] text-xs font-extrabold tracking-tight text-ink" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-user-surface text-user-ink">
          <GitPullRequestArrow className="h-4 w-4" aria-hidden="true" />
        </div>
        <span>{config.appTitle}</span>
        <span className="ms-1 hidden text-[10px] font-medium text-ink-soft sm:inline">{tr("التخطيط والتنفيذ والمراجعة بين مساعديك")}</span>
    </div>
    <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-end gap-x-6 gap-y-3 px-4 py-2 sm:px-6">

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToggleLanguage} title={tr(locale === 'en' ? 'التبديل إلى العربية' : 'التبديل إلى الإنجليزية')} aria-label={tr(locale === 'en' ? 'التبديل إلى العربية' : 'التبديل إلى الإنجليزية')} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink">
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />{locale === 'en' ? 'العربية' : 'English'}
        </button>
        <SettingsDialog />
        <StatusPill tone={codexConnected ? 'codex' : 'warning'}>
          {codexConnected ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
          {codexConnected ? tr("Codex Desktop متصل") : tr("Codex غير متصل")}
        </StatusPill>
        <StatusPill tone={openCodeOnline ? 'openCode' : 'warning'}>
          <StateDot active={openCodeOnline} warning={!openCodeOnline} />
          {openCodeOnline ? tr("OpenCode متاح") : tr("OpenCode لا يرد")}
        </StatusPill>
        <button type="button" onClick={onResetLayout} title={tr("إعادة أعمدة الواجهة إلى المقاس الافتراضي")} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{tr("إعادة ضبط العرض")}</button>
        <button type="button" onClick={onToggleHandoff} aria-pressed={handoffVisible} title={tr(handoffVisible ? 'إخفاء مسار التفويض' : 'إظهار مسار التفويض')} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink">
          {handoffVisible ? <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" /> : <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />}{tr(handoffVisible ? 'إخفاء التفويض' : 'إظهار التفويض')}</button>
        <button type="button" onClick={() => void checkForUpdates()} disabled={checkingUpdates} title={tr("التحقق من تحديثات التطبيق")} className="inline-flex items-center gap-1.5 rounded-lg border border-relay/30 bg-relay-tint px-2.5 py-1.5 text-xs font-bold text-relay-ink transition-colors hover:border-relay/50 disabled:cursor-wait disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdates ? 'animate-spin' : ''}`} aria-hidden="true" />{tr("تحديث")}</button>
      </div>
    </div>

    {checkingUpdates || updateResult ? <p role="status" aria-live="polite" className="mx-auto mt-2 max-w-[1800px] text-xs text-ink-soft">
      {checkingUpdates ? tr("جارٍ التحقق من تحديثات التطبيق…") : updateResult?.status === 'available'
        ? tr("يتوفر الإصدار {{0}} ويجري تنزيله في الخلفية.", [updateResult.version ?? ''])
        : updateResult?.status === 'current' ? tr("التطبيق محدّث بالفعل ({{0}}).", [updateResult.version ?? ''])
          : updateResult?.status === 'portable' ? tr("التحديث التلقائي غير متاح لنسخة Portable؛ ثبّت نسخة Setup.")
            : updateResult?.status === 'unsupported' || updateResult?.status === 'unavailable' ? tr("فحص التحديثات متاح في نسخة سطح المكتب المثبّتة.")
              : tr("تعذر التحقق من التحديثات: {{0}}", [updateResult?.message ?? ''])}
    </p> : null}

    {shellError ? (
      <p role="alert" className="mx-auto mt-3 flex max-w-[1800px] items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {tr(shellError)}
      </p>
    ) : null}

    {!codexConnected && codexError ? (
      <div className="mx-auto mt-3 max-w-[1800px] rounded-lg bg-review-tint px-3 py-2 text-xs text-review-ink">
        {tr("افتح Codex Desktop وسجّل الدخول. سيحاول التطبيق الاتصال تلقائيًا.")}{tr(codexError)}
      </div>
    ) : null}
  </header>
}
