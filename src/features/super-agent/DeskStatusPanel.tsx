import { api } from '../../lib/api'
import { direction, useLocale } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'
import { CircleAlert } from 'lucide-react'
import './desk-status.css'

/**
 * Local contract, kept out of the shared types on purpose.
 * `provider` is null on unbound desks; ids are the Super Agent slot ids.
 */
export type DeskStatus = 'unassigned' | 'working' | 'waiting' | 'idle' | 'paused' | 'unknown'
export type DeskStatusEntry = { id: string; label: string; provider: 'codex' | 'opencode' | 'cline' | null; status: DeskStatus }
export type DeskStatusSummary = { teamId: string; updatedAt: string; desks: DeskStatusEntry[] }
/** Accepts the full team shape as well; only `id` is used here. */
export type DeskStatusTeamRef = { id: string }

const statusLabels: Record<DeskStatus, [string, string]> = {
  unassigned: ['غير مرتبط', 'Unassigned'],
  working: ['شغال', 'Working'],
  waiting: ['ينتظر ردك', 'Waiting for you'],
  idle: ['فاضي', 'Idle'],
  paused: ['موقوف', 'Paused'],
  unknown: ['غير معروف', 'Unknown'],
}

/** Compact, truthful list of what every desk is doing right now, next to the desk notifications. */
export function DeskStatusPanel({ team, visible, onOpenDesk, className = '' }: { team: DeskStatusTeamRef | null; visible: boolean; onOpenDesk: (slotId: string) => void; className?: string }) {
  const ar = useLocale() === 'ar'
  const summary = usePolling(visible && team?.id ? () => api.superDeskStatus(team.id) : null, 8000, { resetKey: team?.id })
  const desks: DeskStatusEntry[] = (summary.data?.desks || []).map(desk => summary.error ? { ...desk, status: 'unknown' } : desk)
  const counts = desks.reduce<{ working: number; waiting: number }>((tally, desk) => ({ working: tally.working + (desk.status === 'working' ? 1 : 0), waiting: tally.waiting + (desk.status === 'waiting' ? 1 : 0) }), { working: 0, waiting: 0 })
  const deskName = (desk: DeskStatusEntry) => desk.label || (desk.id === 'manager' ? ar ? 'المدير' : 'Manager' : `${ar ? 'مهمة' : 'Task'} ${desk.id.slice(7)}`)
  const deskTitle = (desk: DeskStatusEntry) => desk.id === 'manager' ? ar ? 'المدير — Codex' : 'Manager — Codex'
    : desk.provider ? `${deskName(desk)} — ${desk.provider === 'opencode' ? 'OpenCode' : desk.provider === 'cline' ? 'Cline' : 'Codex'}` : undefined
  return <aside dir={direction()} data-desk-status-panel className={`desk-status-panel rounded-xl border border-line bg-card/95 px-2 pt-2 pb-1.5 shadow-sm ${className}`.trim()}>
    <header className="flex min-h-6 items-center justify-between gap-2 px-1.5">
      <span className="text-[10px] font-semibold text-ink-soft">{ar ? 'حالة المكاتب' : 'Desk statuses'}</span>
      {counts.working + counts.waiting > 0 ? (
        <span dir="auto" className="shrink-0 text-[10px] tabular-nums text-ink-soft">
          {ar ? `شغال ${counts.working} · بانتظار ${counts.waiting}` : `Working ${counts.working} · Waiting ${counts.waiting}`}
        </span>
      ) : null}
    </header>
    <ul className="desk-status-list thin-scroll max-h-56 min-w-0 space-y-px" aria-label={ar ? 'حالة كل مكتب' : 'Each desk status'}>
      {desks.map(desk => (
        <li key={desk.id}>
          <button type="button" data-desk-status={desk.id} data-status={desk.status} onClick={() => onOpenDesk(desk.id)}
            title={deskTitle(desk)}
            aria-label={`${deskName(desk)}: ${statusLabels[desk.status][ar ? 0 : 1]}`}
            className="desk-status-row flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-start text-[11px] transition-colors hover:bg-relay-tint/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
            <span className="desk-status-dot" aria-hidden="true" />
            <span dir="auto" className="min-w-0 flex-1 truncate font-medium text-ink">{deskName(desk)}</span>
            <span dir="auto" className="shrink-0 text-[10px] text-ink-soft">{statusLabels[desk.status][ar ? 0 : 1]}</span>
            {desk.status === 'unknown' ? <CircleAlert className="h-3 w-3 shrink-0 text-review-ink" aria-hidden="true" /> : null}
          </button>
        </li>
      ))}
    </ul>
    {summary.error ? <p role="status" className="px-1.5 pb-1 text-[10px] text-review-ink">{ar ? 'تعذر تحديث حالات المكاتب' : 'Desk statuses could not be updated'}</p> : null}
    {!desks.length && !summary.error && (summary.status === 'loading' || summary.status === 'idle') ? <p className="px-1.5 pb-1 text-[10px] text-ink-soft">{ar ? 'جارٍ تحديث الحالة' : 'Checking statuses'}</p> : null}
  </aside>
}
