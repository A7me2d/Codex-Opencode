import type { SuperAgentSlot, SuperTask } from '../../lib/types'

export type DeskAttentionKind = 'waiting_input' | 'failed' | 'tracking_unknown'

export interface DeskAttentionItem {
  /** Stable identity: desk + conversation + task + kind. Dismissing reads and writes this key. */
  key: string
  kind: DeskAttentionKind
  slotId: SuperAgentSlot['id']
  task: SuperTask
  /** The quiet sentence the operator reads, e.g. «مكتب رقم 7 ينتظر ردك عشان يكمل». */
  message: string
  /** Optional concise evidence line (the recorded failure text). */
  detail?: string
}

/**
 * Recorded task text can carry several lines; the alert shows one honest
 * excerpt, never a wall of stack trace. Stack frames and blank padding go.
 */
export function conciseAttentionDetail(error?: string | null) {
  const line = (error ?? '').split(/\r?\n/).map(part => part.trim()).find(Boolean) ?? ''
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

/**
 * The desk's latest recorded task wins, by its own timestamps; the server
 * answers newest-first, so on missing or tied timestamps the first entry in
 * the list (the server's newest) keeps the seat.
 */
function latest(taskList: SuperTask[]) {
  return taskList.reduce((best, next) => {
    const bestAt = best.updatedAt || best.createdAt || '', nextAt = next.updatedAt || next.createdAt || ''
    if (bestAt && nextAt) return nextAt > bestAt ? next : best
    if (nextAt && !bestAt) return next
    return best
  })
}

function deskName(slot: SuperAgentSlot, ar: boolean) {
  return slot.label || (slot.id === 'manager' ? ar ? 'المدير' : 'Manager' : `${ar ? 'مكتب رقم' : 'Desk'} ${slot.id.slice(7)}`)
}

/**
 * Alerts for desks stuck where the operator must act.
 *
 * One alert per desk at most, built from the desk's latest task under the
 * current conversation and manager bindings. Running or queued tasks are
 * never treated as pending questions: only the recorded
 * waiting_input / failed / tracking_unknown states speak here.
 */
export function deskAttentionItems(slots: SuperAgentSlot[], tasks: SuperTask[], managerThreadId: string | undefined, ar: boolean): DeskAttentionItem[] {
  if (!managerThreadId || !tasks.length) return []
  const items: DeskAttentionItem[] = []
  for (const slot of slots) {
    if (!slot.thread) continue
    const bound = tasks.filter(task => task.slotId === slot.id && task.threadId === slot.thread!.id && task.managerThreadId === managerThreadId)
    if (!bound.length) continue
    const task = latest(bound)
    const name = deskName(slot, ar)
    const base = { slotId: slot.id, task }
    if (task.status === 'waiting_input') {
      items.push({ ...base, key: `${slot.id}|${slot.thread.id}|${task.id}|waiting_input|${task.updatedAt || task.createdAt || ""}`, kind: 'waiting_input', message: ar ? `${name} ينتظر ردك عشان يكمل` : `${name} is waiting for your reply to continue` })
    } else if (task.status === 'failed') {
      const detail = conciseAttentionDetail(task.error) || (ar ? 'راجع محادثة المكتب لمعرفة السبب.' : 'Check the desk conversation for the reason.')
      items.push({ ...base, key: `${slot.id}|${slot.thread.id}|${task.id}|failed`, kind: 'failed', message: ar ? `تعذّر تنفيذ مهمة ${name}` : `${name} could not finish its task`, detail })
    } else if (task.status === 'tracking_unknown') {
      items.push({ ...base, key: `${slot.id}|${slot.thread.id}|${task.id}|tracking_unknown`, kind: 'tracking_unknown', message: ar ? `تعذّرت متابعة ${name}، افتح محادثته` : `Lost track of ${name}. Open its conversation` })
    }
  }
  return items
}
