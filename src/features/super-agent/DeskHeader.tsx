import { useEffect, useRef, useState } from 'react'
import { Crown, FolderOpen, Maximize2, Minimize2, MoreHorizontal, Trash2, Unlink, Users, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { usePolling } from '../../hooks/usePolling'
import { useLocale } from '../../lib/i18n'
import type { SuperAgentSlot } from '../../lib/types'

const action = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-35'
export function DeskHeader({ slot, teamId, live, disabled, focused, office, onChoose, onFocus, onUnlink, onRemove }: {
  slot: SuperAgentSlot; teamId?: string; live?: boolean; disabled: boolean; focused: boolean; office: boolean
  onChoose: () => void; onFocus: () => void; onUnlink: () => void; onRemove: () => void
}) {
  const ar = useLocale() === 'ar', manager = slot.id === 'manager'
  const title = slot.label || (manager ? ar ? 'المدير' : 'Manager' : `${ar ? 'مهمة' : 'Task'} ${slot.id.slice(7)}`)
  const providerId = slot.thread?.provider || 'codex'
  const provider = providerId === 'opencode' ? 'OpenCode' : providerId === 'cline' ? 'Cline' : 'Codex'
  const clineWatch = usePolling(teamId && providerId === 'cline' && live ? () => api.superClineStatus(teamId, slot.id) : null, data => data?.active ? 2500 : 7000, { resetKey: slot.thread?.id })
  // `waitingInput` rides on the execution contract; until the server emits it this prompt stays quiet — no invented state.
  const openCodeWatch = usePolling(teamId && providerId === 'opencode' && live ? () => api.superOpenCodeStatus(teamId, slot.id) : null, data => data?.active ? 2500 : 7000, { resetKey: slot.thread?.id })
  const clineState = !slot.thread || providerId !== 'cline' ? null : clineWatch.data?.waitingPermission ? ar ? 'بانتظار صلاحية' : 'Waiting permission' : clineWatch.data?.error || clineWatch.error ? ar ? 'خطأ' : 'Error' : clineWatch.data?.active ? ar ? 'يعمل…' : 'Working…' : null
  const openCodeState = !slot.thread || providerId !== 'opencode' ? null : openCodeWatch.error || openCodeWatch.data?.status === 'tracking_unknown' ? ar ? 'تعذّرت المتابعة' : 'Tracking unavailable' : openCodeWatch.data?.waitingInput ? ar ? 'بانتظار إجابة' : 'Waiting for answer' : null
  const deskState = clineState || openCodeState
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const chooseLabel = ar ? 'اختيار المحادثة والمشروع' : 'Choose conversation and project'
  const focusLabel = focused ? office ? ar ? 'إغلاق الشات' : 'Close chat' : ar ? 'عودة للتوزيع' : 'Back to overview' : ar ? 'تكبير الشات' : 'Focus conversation'
  return <header className="super-desk-header relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${manager ? 'bg-relay-tint text-relay-ink' : 'bg-paper text-ink-soft'}`} aria-hidden="true">{manager ? <Crown className="h-4 w-4" /> : <Users className="h-3.5 w-3.5" />}</span>
    <div className="min-w-0 flex-1" title={slot.thread ? `${slot.thread.title}\n${slot.thread.directory}` : title}>
      <div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-xs font-semibold">{title}</h2>{slot.thread ? <span dir="ltr" className="rounded-md border border-line px-1.5 py-0.5 text-[9px] leading-3 text-ink-soft">{provider}{providerId === 'cline' && slot.thread.clineProvider ? ` · ${slot.thread.clineProvider}` : ''}</span> : null}{deskState ? <span role="status" className={cx('shrink-0 text-[9px]', providerId === 'opencode' && openCodeWatch.data?.waitingInput && !openCodeWatch.error ? 'text-ink' : 'text-review-ink')}>{deskState}</span> : null}</div>
      {slot.thread?.directory ? <p dir="ltr" className="mt-0.5 truncate text-start font-mono text-[9px] text-ink-soft">{slot.thread.directory}</p> : null}
    </div>
    <button type="button" className={action} disabled={disabled} onClick={onChoose} aria-label={chooseLabel} title={chooseLabel}><FolderOpen className="h-3.5 w-3.5" /></button>
    <button type="button" className={action} onClick={onFocus} aria-label={focusLabel} title={focusLabel}>{focused ? office ? <X className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
    {slot.thread || !manager ? <div ref={root} className="relative" onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }}>
      <button ref={trigger} type="button" className={action} disabled={disabled} aria-label={ar ? 'خيارات المكتب' : 'Desk options'} title={ar ? 'خيارات المكتب' : 'Desk options'} aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal className="h-4 w-4" /></button>
      {open ? <div className="super-desk-menu absolute end-0 top-full z-40 mt-2 w-52 rounded-xl border border-line bg-card p-1.5 shadow-lg">
        {slot.thread ? <button type="button" className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-start text-xs hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40" onClick={() => { setOpen(false); onUnlink() }}><Unlink className="h-3.5 w-3.5" />{ar ? 'إزالة الربط فقط' : 'Unlink conversation'}</button> : null}
        {!manager ? <button type="button" className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-start text-xs text-review-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40" title={ar ? 'مع الاحتفاظ بالمحادثة' : 'Keeps the conversation'} onClick={() => { setOpen(false); onRemove() }}><Trash2 className="h-3.5 w-3.5" />{ar ? 'إزالة المكتب' : 'Remove desk'}</button> : null}
      </div> : null}
    </div> : null}
  </header>
}
