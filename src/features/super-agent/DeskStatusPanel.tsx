import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, CircleAlert, List } from 'lucide-react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { direction, useLocale } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'
import './desk-status.css'
import './desk-status-menu.css'

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

/** Folding preference under its own key; unavailable storage simply falls back to the compact default. */
const OPEN_PREFERENCE_KEY = 'openzero.super-agent.desk-status-open'

const readOpenPreference = () => {
  try { return window.localStorage.getItem(OPEN_PREFERENCE_KEY) === 'true' } catch { return false }
}

const writeOpenPreference = (open: boolean) => {
  try { window.localStorage.setItem(OPEN_PREFERENCE_KEY, open ? 'true' : 'false') } catch { /* the session state still works */ }
}

/** Compact, truthful list of what every desk is doing right now, folded into a toggle beside the desk notifications. */
export function DeskStatusPanel({ team, visible, onOpenDesk, className = '' }: { team: DeskStatusTeamRef | null; visible: boolean; onOpenDesk: (slotId: string) => void; className?: string }) {
  const ar = useLocale() === 'ar'
  const [open, setOpen] = useState(readOpenPreference)
  const root = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  // One poller serves both states: the folded counts and the open list read the same data, it keeps
  // running while the workspace is visible (folded or not) and stays parked while it is hidden.
  // Folding therefore never adds a query and never freezes the statuses the rest of the UI relies on.
  const summary = usePolling(visible && team?.id ? () => api.superDeskStatus(team.id) : null, 8000, { resetKey: team?.id })
  const desks: DeskStatusEntry[] = (summary.data?.desks || []).map(desk => summary.error ? { ...desk, status: 'unknown' } : desk)
  const counts = desks.reduce<{ working: number; waiting: number }>((tally, desk) => ({ working: tally.working + (desk.status === 'working' ? 1 : 0), waiting: tally.waiting + (desk.status === 'waiting' ? 1 : 0) }), { working: 0, waiting: 0 })
  const active = counts.working + counts.waiting
  const detail = active ? ar ? `شغال ${counts.working} · بانتظار ${counts.waiting}` : `Working ${counts.working} · Waiting ${counts.waiting}` : ''
  const triggerTitle = open ? ar ? 'طي قائمة حالة المكاتب' : 'Collapse desk statuses'
    : summary.error ? ar ? 'فتح حالة المكاتب — تعذر التحديث' : 'Open desk statuses — update failed'
    : detail ? ar ? `فتح حالة المكاتب — ${detail}` : `Open desk statuses — ${detail}`
    : ar ? 'فتح قائمة حالة المكاتب' : 'Open desk statuses'
  const deskName = (desk: DeskStatusEntry) => desk.label || (desk.id === 'manager' ? ar ? 'المدير' : 'Manager' : `${ar ? 'مهمة' : 'Task'} ${desk.id.slice(7)}`)
  const deskTitle = (desk: DeskStatusEntry) => desk.id === 'manager' ? ar ? 'المدير — Codex' : 'Manager — Codex'
    : desk.provider ? `${deskName(desk)} — ${desk.provider === 'opencode' ? 'OpenCode' : desk.provider === 'cline' ? 'Cline' : 'Codex'}` : undefined
  const toggle = () => {
    const next = !open
    setOpen(next)
    writeOpenPreference(next)
  }
  const close = (refocus = false) => {
    if (open) writeOpenPreference(false)
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  // A press outside the panel closes the menu without swallowing the click: the event is never
  // prevented, so it still lands on whatever the operator actually aimed at.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <aside ref={root} dir={direction()} data-desk-status-panel data-desk-status-open={open ? 'true' : 'false'}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return
      // Closing the menu must not also close the focused desk chat, so the event stops here.
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }}
    className={cx('desk-status-panel relative rounded-xl border border-line bg-card/95 shadow-sm', open ? 'px-2 pt-2 pb-1.5' : 'px-1.5 py-1', className)}>
    <button ref={trigger} type="button" data-desk-status-trigger aria-expanded={open} aria-controls={listId} onClick={toggle} title={triggerTitle}
      className="flex min-h-7 w-full items-center gap-1.5 rounded-lg px-1 py-1 text-start text-[11px] font-semibold text-ink transition-colors hover:bg-relay-tint/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
      <List className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{ar ? 'حالة المكاتب' : 'Desk statuses'}</span>
      {desks.length ? <span dir="ltr" className="shrink-0 rounded-full bg-paper px-1.5 py-px text-[10px] leading-4 tabular-nums text-ink-soft">{desks.length}</span> : null}
      {counts.waiting ? <span dir="ltr" className="shrink-0 rounded-full bg-review/15 px-1.5 py-px text-[10px] leading-4 tabular-nums text-review-ink">{counts.waiting}</span> : null}
      {counts.working ? <span dir="ltr" className="shrink-0 rounded-full bg-ready/15 px-1.5 py-px text-[10px] leading-4 tabular-nums text-ready-ink">{counts.working}</span> : null}
      {!open && summary.error ? <CircleAlert className="h-3 w-3 shrink-0 text-review-ink" aria-hidden="true" /> : null}
      <ChevronDown className="desk-status-chevron h-3 w-3 shrink-0 text-ink-soft" aria-hidden="true" />
    </button>
    {open ? <div className="desk-status-menu absolute inset-x-0 top-full z-30 mt-1 max-h-64 thin-scroll overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-lg">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="text-[10px] font-semibold text-ink-soft">{ar ? 'حالة كل مكتب' : 'Each desk status'}</span>
        {detail ? <span dir="auto" className="shrink-0 text-[10px] tabular-nums text-ink-soft">{detail}</span> : null}
      </div>
      <ul ref={list} id={listId} className="desk-status-list space-y-px" aria-label={ar ? 'حالة كل مكتب' : 'Each desk status'}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const rows = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-desk-status]') || [])
          if (!rows.length) return
          event.preventDefault()
          const current = rows.indexOf(document.activeElement as HTMLButtonElement)
          const next = current < 0 ? rows[event.key === 'ArrowDown' ? 0 : rows.length - 1]
            : event.key === 'ArrowDown' ? rows[(current + 1) % rows.length] : rows[(current - 1 + rows.length) % rows.length]
          next.focus()
        }}>
        {desks.map(desk => (
          <li key={desk.id}>
            <button type="button" data-desk-status={desk.id} data-status={desk.status} onClick={() => { close(); onOpenDesk(desk.id) }}
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
      {summary.error ? <p role="status" className="px-1.5 pb-1 pt-1 text-[10px] text-review-ink">{ar ? 'تعذر تحديث حالات المكاتب' : 'Desk statuses could not be updated'}</p> : null}
      {!desks.length && !summary.error && (summary.status === 'loading' || summary.status === 'idle') ? <p className="px-1.5 pb-1 pt-1 text-[10px] text-ink-soft">{ar ? 'جارٍ تحديث الحالة' : 'Checking statuses'}</p> : null}
    </div> : null}
  </aside>
}
