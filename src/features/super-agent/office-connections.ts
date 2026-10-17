import type { SuperAgentSlot, SuperSlotId, SuperTask } from '../../lib/types'

export type ConnectionState = 'unassigned' | 'ready' | 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'interrupted' | 'waiting_input' | 'tracking_unknown' | 'paused' | 'unavailable'
export type OfficeDock = 'left' | 'right' | 'top' | 'bottom'
export type OfficePosition = { left: number; top: number; accent: string; dock: OfficeDock }
export const stationWidth = (width: number) => Math.min(width * .24, 280)
type Point = { x: number; y: number }

/** Rounded orthogonal paths stay in the 110px/52px aisles between station bounds. */
function aislePath(points: Point[]) {
  const distinct = points.filter((point, index) => !index || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > .01)
  const route = distinct.filter((point, index) => {
    if (!index || index === distinct.length - 1) return true
    const before = distinct[index - 1], after = distinct[index + 1]
    const ax = point.x - before.x, ay = point.y - before.y, bx = after.x - point.x, by = after.y - point.y
    return Math.abs(ax * by - ay * bx) > .01 || ax * bx + ay * by < 0
  })
  let path = `M${route[0].x} ${route[0].y}`
  for (let index = 1; index < route.length - 1; index++) {
    const before = route[index - 1], corner = route[index], after = route[index + 1]
    const incoming = Math.hypot(corner.x - before.x, corner.y - before.y), outgoing = Math.hypot(after.x - corner.x, after.y - corner.y)
    const radius = Math.min(12, incoming / 3, outgoing / 3)
    const entry = { x: corner.x + (before.x - corner.x) * radius / incoming, y: corner.y + (before.y - corner.y) * radius / incoming }
    const exit = { x: corner.x + (after.x - corner.x) * radius / outgoing, y: corner.y + (after.y - corner.y) * radius / outgoing }
    path += ` L${entry.x} ${entry.y} Q${corner.x} ${corner.y} ${exit.x} ${exit.y}`
  }
  const end = route[route.length - 1]
  path += ` L${end.x} ${end.y}`
  // Badges belong in a corridor, not on either station's entry stub.
  let longest = -1, label = route[0]
  for (let index = 1; index < points.length - 2; index++) {
    const a = points[index], b = points[index + 1], length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > longest) { longest = length; label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }
  return { path, label }
}

export function officeSceneSize(workerCount: number, width: number, height: number) {
  let rings = 0
  while (4 * rings * (rings + 1) < workerCount) rings++
  return { width: Math.max(width, rings * 780 + 420), height: Math.max(650, height, rings * 700 + 438) }
}

/** Square perimeter rings: cardinal desks first, then corners and outer rings. */
export function officePositions(slots: SuperAgentSlot[], width = 1440, height = 1138) {
  const positions = new Map<SuperSlotId, OfficePosition>([['manager', { left: 50, top: 50, accent: 'var(--color-relay)', dock: 'left' }]])
  const workers = slots.filter(slot => slot.id !== 'manager')
  const points: Array<[number, number]> = []
  for (let ring = 1; points.length < workers.length; ring++) {
    points.push([ring, 0], [0, -ring], [-ring, 0], [0, ring], [ring, -ring], [-ring, -ring], [-ring, ring], [ring, ring])
    for (let offset = 1; offset < ring; offset++) points.push([ring, -offset], [-offset, -ring], [-ring, offset], [offset, ring], [ring, offset], [offset, -ring], [-ring, -offset], [-offset, ring])
  }
  workers.forEach((slot, index) => {
    const [x, y] = points[index]
    const dock: OfficeDock = Math.abs(y) > Math.abs(x) ? y > 0 ? 'top' : 'bottom' : x > 0 ? 'left' : 'right'
    positions.set(slot.id, { left: 50 + x * 390 / width * 100, top: 50 + y * 350 / height * 100, dock, accent: ['var(--color-ready)', 'var(--color-review)', 'var(--color-relay)'][index % 3] })
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
  const state = task && ['queued', 'dispatching', 'running', 'completed', 'failed', 'interrupted', 'waiting_input', 'tracking_unknown'].includes(task.status) ? task.status as ConnectionState : 'ready'
  return { state, task }
}

/** Coordinates match the fixed 48px station label, SVG viewBox, and 20px footer. */
export function officeConnector(position: OfficePosition, width: number, height: number) {
  const scale = stationWidth(width) / 280, total = 48 + 230 * scale + 20
  const docks = {
    left: { brain: [244, 177], room: [14, 126], vector: [1, 0] },
    right: { brain: [36, 177], room: [266, 126], vector: [-1, 0] },
    bottom: { brain: [140, 147], room: [140, 202], vector: [0, -1] },
    top: { brain: [140, 207], room: [140, 58], vector: [0, 1] },
  }[position.dock]
  const start = { x: width / 2 + (docks.brain[0] - 140) * scale, y: height / 2 - total / 2 + 48 + docks.brain[1] * scale }
  const end = { x: width * position.left / 100 + (docks.room[0] - 140) * scale, y: height * position.top / 100 - total / 2 + 48 + docks.room[1] * scale }
  const gridX = Math.round((position.left - 50) * width / 100 / 390)
  const gridY = Math.round((position.top - 50) * height / 100 / 350)
  if (Math.max(Math.abs(gridX), Math.abs(gridY)) > 1 || (gridX !== 0 && gridY !== 0)) {
    const centerX = width / 2, centerY = height / 2
    const horizontal = docks.vector[0] !== 0
    const sourceExit = horizontal ? { x: centerX + docks.vector[0] * 195, y: start.y } : { x: start.x, y: centerY + docks.vector[1] * 175 }
    const targetExit = horizontal ? { x: centerX + gridX * 390 - docks.vector[0] * 195, y: end.y } : { x: end.x, y: centerY + gridY * 350 - docks.vector[1] * 175 }
    const sourceGrid = horizontal ? { x: sourceExit.x, y: centerY + (gridY < 0 ? -175 : 175) } : { x: centerX + (gridX < 0 ? -195 : 195), y: sourceExit.y }
    const targetGrid = horizontal ? { x: targetExit.x, y: centerY + gridY * 350 + (gridY > 0 ? -175 : 175) } : { x: centerX + gridX * 390 + (gridX > 0 ? -195 : 195), y: targetExit.y }
    const elbow = horizontal ? { x: targetGrid.x, y: sourceGrid.y } : { x: sourceGrid.x, y: targetGrid.y }
    return { start, end, ...aislePath([start, sourceExit, sourceGrid, elbow, targetGrid, targetExit, end]) }
  }
  const distance = Math.max(32, Math.min(180, Math.hypot(end.x - start.x, end.y - start.y) * .45))
  const first = { x: start.x + docks.vector[0] * distance, y: start.y + docks.vector[1] * distance }
  const second = { x: end.x - docks.vector[0] * distance, y: end.y - docks.vector[1] * distance }
  // Keep vertical badges in the aisle, clear of the manager/worker headers.
  const t = position.dock === 'bottom' ? .78 : position.dock === 'top' ? .32 : .64, n = 1 - t
  const label = { x: n ** 3 * start.x + 3 * n * n * t * first.x + 3 * n * t * t * second.x + t ** 3 * end.x, y: n ** 3 * start.y + 3 * n * n * t * first.y + 3 * n * t * t * second.y + t ** 3 * end.y }
  return { start, end, label, path: `M${start.x} ${start.y} C${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}` }
}

export function connectionLabel(state: ConnectionState, ar: boolean) {
  const labels: Record<ConnectionState, [string, string]> = {
    unassigned: ['غير مرتبط', 'Unassigned'], ready: ['جاهز للاستقبال', 'Ready'], queued: ['بانتظار الإرسال', 'Queued'],
    dispatching: ['جارٍ الإرسال', 'Sending'],
    tracking_unknown: ['تعذّرت متابعة المهمة', 'Tracking unavailable'],
    running: ['قيد التنفيذ', 'Working'], completed: ['وصل الرد', 'Reply received'], failed: ['تعذّر التنفيذ', 'Task failed'],
    interrupted: ['المهمة توقفت', 'Interrupted'], waiting_input: ['بانتظار إجابة', 'Waiting for answer'], paused: ['المزود موقوف', 'Provider paused'], unavailable: ['الحالة غير متاحة', 'Status unavailable'],
  }
  return labels[state][ar ? 0 : 1]
}
