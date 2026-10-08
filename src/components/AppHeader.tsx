import { tr } from '../lib/i18n'
import { type CSSProperties } from 'react'
import { GitPullRequestArrow, TriangleAlert } from 'lucide-react'
import { config } from '../app/config'
import { SettingsDialog } from './SettingsDialog'
import type { AppLocale } from '../lib/i18n'

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

/** Minimal title bar; app controls live behind the settings button. */
export function AppHeader({ codexConnected, openCodeOnline, codexError, shellError, onResetLayout, locale, onToggleLanguage, handoffVisible, onToggleHandoff }: AppHeaderProps) {
  return <header className="shrink-0 border-b border-line bg-card">
    <div className="flex h-[38px] select-none items-center gap-2 px-5 pr-[150px] text-xs font-extrabold tracking-tight text-ink" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-user-surface text-user-ink">
          <GitPullRequestArrow className="h-4 w-4" aria-hidden="true" />
        </div>
        <span>{config.appTitle}</span>
        <span className="ms-1 hidden text-[10px] font-medium text-ink-soft sm:inline">{tr("التخطيط والتنفيذ والمراجعة بين مساعديك")}</span>
    </div>
    <div className="mx-auto flex max-w-[1800px] justify-end px-4 py-2 sm:px-6">
      <SettingsDialog
        codexConnected={codexConnected}
        openCodeOnline={openCodeOnline}
        codexError={codexError}
        onResetLayout={onResetLayout}
        locale={locale}
        onToggleLanguage={onToggleLanguage}
        handoffVisible={handoffVisible}
        onToggleHandoff={onToggleHandoff}
      />
    </div>

    {shellError ? (
      <p role="alert" className="mx-auto mt-3 flex max-w-[1800px] items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {tr(shellError)}
      </p>
    ) : null}

  </header>
}
