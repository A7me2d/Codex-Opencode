import type { SuperAgentSlot, SuperSlotId, SuperTask } from '../../lib/types'

export type ConnectionState = 'unassigned' | 'ready' | 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'interrupted' | 'paused' | 'unavailable'
export type OfficePosition = { left: number; top: number; accent: string }
export const stationWidth = (width: number) => Math.min(width * .24, 280)

export function officePositions(slots: SuperAgentSlot[]) {
  const positions = new Map<SuperSlotId, OfficePosition>([['manager', { left: 50, top: 50, accent: 'var(--color-relay)' }]])
  const workers = slots.filter(slot => slot.id !== 'manager')
  workers.forEach((slot, index) => {
    const sideCount = index % 2 === 0 ? Math.ceil(workers.length / 2) : Math.floor(workers.length / 2)
    positions.set(slot.id, { left: index % 2 === 0 ? 79 : 21, top: (Math.floor(index / 2) + .5) / sideCount * 90 + 5, accent: ['var(--color-ready)', 'var(--color-review)', 'var(--color-relay)'][index % 3] })
  })
  return positions
}

/** The overview must describe recorded manager work, never infer delivery from a click. */
export function officeConnection(slot: SuperAgentSlot, tasks: SuperTask[], managerId: string | undefined, providerEnabled: boolean, unavailable: boolean): { state: ConnectionState; task?: SuperTask } {
  if (!slot.thread) return { state: 'unassigned' }
  if (!managerId) return { state: 'unassigned' }
  if (!providerEnabled) return { state: 'paused' }
  if (unavailable) return { state: 'unavailable' }
  const task = managerId ? tasks.find(task => task.slotId === slot.id && task.threadId === slot.thread!.id && task.managerThreadId === managerId) : undefined
  const state = task && ['queued', 'dispatching', 'running', 'completed', 'failed', 'interrupted'].includes(task.status) ? task.status as ConnectionState : 'ready'
  return { state, task }
}

/** Coordinates match the fixed 48px station label, SVG viewBox, and 20px footer. */
export function officeConnector(position: OfficePosition, width: number, height: number) {
  const scale = stationWidth(width) / 280, total = 48 + 230 * scale + 20
  const right = position.left > 50, direction = right ? 1 : -1
  const start = { x: width / 2 + direction * 104 * scale, y: height / 2 - total / 2 + 48 + 177 * scale }
  const end = { x: width * position.left / 100 - direction * 126 * scale, y: height * position.top / 100 - total / 2 + 48 + 126 * scale }
  const middleX = (start.x + end.x) / 2
  const t = .64, n = 1 - t
  const label = { x: n ** 3 * start.x + 3 * n * n * t * middleX + 3 * n * t * t * middleX + t ** 3 * end.x, y: (n ** 3 + 3 * n * n * t) * start.y + (3 * n * t * t + t ** 3) * end.y }
  return { start, end, label, path: `M${start.x} ${start.y} C${middleX} ${start.y} ${middleX} ${end.y} ${end.x} ${end.y}` }
}

export function connectionLabel(state: ConnectionState, ar: boolean) {
  const labels: Record<ConnectionState, [string, string]> = {
    unassigned: ['غير مرتبط', 'Unassigned'], ready: ['جاهز للاستقبال', 'Ready'], queued: ['بانتظار الإرسال', 'Queued'],
    dispatching: ['جارٍ الإرسال', 'Sending'],
    running: ['قيد التنفيذ', 'Working'], completed: ['وصل الرد', 'Reply received'], failed: ['تعذّر التنفيذ', 'Task failed'],
    interrupted: ['المهمة توقفت', 'Interrupted'], paused: ['المزود موقوف', 'Provider paused'], unavailable: ['الحالة غير متاحة', 'Status unavailable'],
  }
  return labels[state][ar ? 0 : 1]
}
