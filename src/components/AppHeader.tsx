import { tr } from '../lib/i18n'
import { type CSSProperties } from 'react'
import { TriangleAlert } from 'lucide-react'
import { config } from '../app/config'
import { SettingsDialog } from './SettingsDialog'
import type { AppLocale } from '../lib/i18n'
import { WindowControls } from './WindowControls'

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
  onOpenExtensions: () => void
  mode: 'agent' | 'ide'
  onChangeMode: (mode: 'agent' | 'ide') => void
}

/** Minimal title bar; app controls live behind the settings button. */
export function AppHeader({ codexConnected, openCodeOnline, codexError, shellError, onResetLayout, locale, onToggleLanguage, handoffVisible, onToggleHandoff, onOpenExtensions, mode, onChangeMode }: AppHeaderProps) {
  return <header className="shrink-0 border-b border-line bg-card">
    <div dir="ltr" onDoubleClick={() => void window.codingRoomWindow?.toggleMaximize?.()} className="flex h-12 select-none items-center justify-between gap-3 ps-4 pe-3 text-xs font-extrabold tracking-tight text-ink" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
      <div className="flex min-w-0 items-center gap-2">
        <img src="/app-icon.png" alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
        <div className="flex min-w-0 flex-col items-start gap-0.5 overflow-hidden">
        <span className="shrink-0">{config.appTitle}</span>
        <span className="ms-1 hidden truncate text-[10px] font-medium text-ink-soft sm:inline">{tr("التخطيط والتنفيذ والمراجعة بين مساعديك")}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3" dir="ltr" onDoubleClick={event => event.stopPropagation()}>
      <div role="tablist" aria-label={locale === 'ar' ? 'وضع مساحة العمل' : 'Workspace mode'} style={{ WebkitAppRegion: 'no-drag' } as CSSProperties} className="flex rounded-full border border-line bg-paper p-1">
        {(['agent', 'ide'] as const).map(value => <button key={value} type="button" role="tab" id={`workspace-mode-${value}`} aria-controls={`workspace-${value}`} aria-selected={mode === value} tabIndex={mode === value ? 0 : -1}
          onClick={() => onChangeMode(value)} onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const next = value === 'agent' ? 'ide' : 'agent'
            onChangeMode(next); document.getElementById(`workspace-mode-${next}`)?.focus()
          }} className={`rounded-full px-4 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 ${mode === value ? 'bg-card text-relay-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:text-ink'}`}>{value === 'agent' ? 'Agent' : 'IDE'}</button>)}
      </div>
      <SettingsDialog
        codexConnected={codexConnected}
        openCodeOnline={openCodeOnline}
        codexError={codexError}
        onResetLayout={onResetLayout}
        locale={locale}
        onToggleLanguage={onToggleLanguage}
        handoffVisible={handoffVisible}
        onToggleHandoff={onToggleHandoff}
        onOpenExtensions={onOpenExtensions}
      />
      {window.codingRoomWindow?.minimize && <span className="h-5 w-px bg-line" aria-hidden="true" />}
      <WindowControls />
      </div>
    </div>

    {shellError ? (
      <p role="alert" className="mx-auto mt-3 flex max-w-[1800px] items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {tr(shellError)}
      </p>
    ) : null}

  </header>
}
