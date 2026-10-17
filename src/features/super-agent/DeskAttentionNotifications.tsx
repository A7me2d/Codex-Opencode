import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, CircleHelp, ScanSearch, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useLocale } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'
import type { SuperAgentTeam, SuperSlotId } from '../../lib/types'
import { deskAttentionItems } from './desk-attention'
import './desk-attention.css'

const icons = {
  waiting_input: CircleHelp,
  failed: CircleAlert,
  tracking_unknown: ScanSearch,
}

/**
 * Desks that need the operator, anchored to the physical left edge inside
 * the Super Agent work area (left in RTL too), between the office legend
 * above and its zoom tools below. One poll per workspace — it parks as soon
 * as the workspace hides — and one item per desk at most, so the operator
 * sees «مكتب رقم 7 ينتظر ردك عشان يكمل» without any running-task noise.
 */
export function DeskAttentionNotifications({ visible, team, onOpen, embedded = false }: { visible: boolean; team: SuperAgentTeam | undefined; onOpen: (slotId: SuperSlotId) => void; embedded?: boolean }) {
  const ar = useLocale() === 'ar'
  const teamId = team?.id ?? ''
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  useEffect(() => { setDismissed(new Set()) }, [teamId])
  const managerThreadId = team?.slots.find(slot => slot.id === 'manager')?.thread?.id
  const tasks = usePolling(
    visible && team ? () => api.superTasks(team.id) : null,
    data => data?.some(task => ['queued', 'dispatching', 'running', 'waiting_input'].includes(task.status)) ? 1500 : 5000,
    { resetKey: teamId },
  )
  const items = useMemo(
    () => tasks.error ? [] : deskAttentionItems(team?.slots || [], tasks.data || [], managerThreadId, ar).filter(item => !dismissed.has(item.key)),
    [team?.slots, tasks.data, managerThreadId, ar, dismissed, tasks.error],
  )
  if (!team || (!items.length && !tasks.error)) return null
  return <div data-office-avoid={embedded ? undefined : true} className={embedded ? 'min-h-0 w-full' : 'pointer-events-none absolute inset-y-0 left-3 z-20 flex w-[min(18rem,46vw)] items-center'} dir={ar ? 'rtl' : 'ltr'}>
    <section role="list" aria-label={ar ? 'تنبيهات المكاتب التي تنتظرك' : 'Desk attention alerts'} className={`desk-attention-stack thin-scroll pointer-events-auto flex w-full flex-col gap-1.5 overflow-y-auto ${embedded ? '' : 'max-h-[calc(100%-7.5rem)]'}`}>
      {items.map(item => {
        const Icon = icons[item.kind]
        return <div key={item.key} role="listitem" data-kind={item.kind} className="desk-attention-item group flex items-start gap-2 rounded-xl px-2.5 py-2">
          <span className="desk-attention-badge inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
          <button type="button" onClick={() => onOpen(item.slotId)} title={item.message} aria-label={ar ? `فتح محادثة: ${item.message}` : `Open conversation: ${item.message}`} className="min-w-0 flex-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
            <span dir="auto" className="block text-[11px] font-semibold text-ink">{item.message}</span>
            {item.detail ? <span dir="auto" className="mt-0.5 line-clamp-2 block break-words text-[10px] leading-4 text-ink-soft">{item.detail}</span> : null}
            <span className="mt-0.5 block text-[10px] text-ink-soft group-hover:text-relay-ink">{ar ? 'افتح المحادثة' : 'Open conversation'}</span>
          </button>
          <button type="button" onClick={() => setDismissed(previous => { const next = new Set(previous); next.add(item.key); return next })} aria-label={ar ? 'إخفاء هذا التنبيه' : 'Dismiss this alert'} className="rounded-md p-1 text-ink-soft hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      })}
      {tasks.error ? <p role="status" className="rounded-xl border border-line bg-card px-2.5 py-2 text-[10px] leading-4 text-ink-soft">{ar ? 'تعذّر تحديث تنبيهات المكاتب' : 'Could not refresh desk alerts'}</p> : null}
    </section>
  </div>
}
