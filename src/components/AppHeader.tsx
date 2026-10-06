import { GitPullRequestArrow, RefreshCw, RotateCcw, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { config } from '../app/config'
import { StateDot } from './ui/StateDot'
import { StatusPill } from './ui/StatusPill'
import { SettingsDialog } from './SettingsDialog'

export interface AppHeaderProps {
  codexConnected: boolean
  openCodeOnline: boolean
  codexError?: string
  /** A failure that happened in the shell itself (create session, open folder). */
  shellError: string | null
  onRefresh: () => void
  onResetLayout: () => void
}

/** Fixed top bar: who we are, and whether each agent is reachable right now. */
export function AppHeader({ codexConnected, openCodeOnline, codexError, shellError, onRefresh, onResetLayout }: AppHeaderProps) {
  return <header className="shrink-0 border-b border-line bg-card px-4 py-3.5 sm:px-6">
    <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-user-surface text-user-ink">
          <GitPullRequestArrow className="h-4.5 w-4.5" aria-hidden="true" />
        </div>
        <div>
          <div className="text-sm font-extrabold tracking-tight text-ink">{config.appTitle}</div>
          <div className="text-[11px] text-ink-soft">التخطيط والتنفيذ والمراجعة بين مساعديك</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SettingsDialog />
        <StatusPill tone={codexConnected ? 'codex' : 'warning'}>
          {codexConnected ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
          {codexConnected ? 'Codex Desktop متصل' : 'Codex غير متصل'}
        </StatusPill>
        <StatusPill tone={openCodeOnline ? 'openCode' : 'warning'}>
          <StateDot active={openCodeOnline} warning={!openCodeOnline} />
          {openCodeOnline ? 'OpenCode متاح' : 'OpenCode لا يرد'}
        </StatusPill>
        <button type="button" onClick={onResetLayout} title="إعادة أعمدة الواجهة إلى المقاس الافتراضي" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />إعادة ضبط العرض
        </button>
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />تحديث
        </button>
      </div>
    </div>

    {shellError ? (
      <p role="alert" className="mx-auto mt-3 flex max-w-[1800px] items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {shellError}
      </p>
    ) : null}

    {!codexConnected && codexError ? (
      <div className="mx-auto mt-3 max-w-[1800px] rounded-lg bg-review-tint px-3 py-2 text-xs text-review-ink">
        افتح Codex Desktop وسجّل الدخول ثم اضغط تحديث. {codexError}
      </div>
    ) : null}
  </header>
}
