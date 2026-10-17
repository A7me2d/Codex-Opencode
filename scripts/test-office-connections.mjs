import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/features/super-agent/office-connections.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { officeConnection, officePositions, officeSceneSize, officeConnector, stationWidth, connectionLabel } = context.exports
const desk = { id: 'worker-4', thread: { id: 'ses_exact', provider: 'opencode' } }
const task = { id: 'job-1', slotId: 'worker-4', threadId: 'ses_exact', managerThreadId: 'manager', status: 'running' }
function samplePath(path) {
  const tokens = path.match(/[MLQC]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi), samples = []
  let index = 0, current
  const point = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) })
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === 'M') { current = point(); samples.push(current); continue }
    const controls = Array.from({ length: command === 'C' ? 3 : command === 'Q' ? 2 : 1 }, point)
    const start = current, end = controls.at(-1)
    for (let step = 1; step <= 100; step++) {
      const t = step / 100, n = 1 - t
      samples.push(Object.fromEntries(['x', 'y'].map(axis => [axis, command === 'L' ? n * start[axis] + t * end[axis] : command === 'Q' ? n ** 2 * start[axis] + 2 * n * t * controls[0][axis] + t ** 2 * end[axis] : n ** 3 * start[axis] + 3 * n ** 2 * t * controls[0][axis] + 3 * n * t ** 2 * controls[1][axis] + t ** 3 * end[axis]])))
    }
    current = end
  }
  return samples
}
for (const status of ['queued', 'dispatching', 'running', 'completed', 'failed', 'interrupted']) assert.equal(officeConnection(desk, [{ ...task, status }], 'manager', true, false).state, status)
assert.equal(officeConnection(desk, [], 'manager', true, false).state, 'ready', 'opening a bound chat must not invent a running task')
assert.equal(officeConnection(desk, [task], 'different-manager', true, false).state, 'ready')
assert.equal(officeConnection({ ...desk, thread: { id: 'replacement' } }, [task], 'manager', true, false).state, 'ready', 'rebound desks must not inherit an old task link')
assert.equal(officeConnection(desk, [task], 'manager', false, false).state, 'paused')
assert.equal(officeConnection(desk, [task], 'manager', true, true).state, 'unavailable', 'failed polling must not advertise stale activity')
assert.equal(officeConnection(desk, [task], undefined, true, false).state, 'unassigned')
assert.equal(officeConnection({ id: 'worker-9', thread: null }, [task], 'manager', true, false).state, 'unassigned')
assert.equal(officeConnection(desk, [{ ...task, status: 'tracking_unknown' }], 'manager', true, false).state, 'tracking_unknown', 'lost tracking is neither a failed task nor a ready desk')
assert.notEqual(connectionLabel('tracking_unknown', true), connectionLabel('failed', true))
assert.equal(officeConnection(desk, [{ ...task, status: 'queued' }, { ...task, id: 'old', status: 'completed' }], 'manager', true, false).state, 'queued', 'the newest task overrides earlier successes')
for (const count of [1, 2, 3, 4, 8, 11, 24, 25, 48]) {
  const slots = [{ id: 'manager' }, ...Array.from({ length: count }, (_, index) => ({ id: `worker-${index * 2 + 1}` }))]
  for (const viewportWidth of [850, 1200, 1440]) {
    const { width, height } = officeSceneSize(count, viewportWidth, 650)
    const positions = officePositions(slots, width, height)
    assert.equal(positions.size, slots.length)
    const seen = new Set()
    for (const slot of slots.slice(1)) {
      const position = positions.get(slot.id), line = officeConnector(position, width, height)
      const scale = stationWidth(width) / 280, nodeTop = height * position.top / 100 - (48 + 230 * scale + 20) / 2
      const roomPorts = { left: [14, 126], right: [266, 126], top: [140, 58], bottom: [140, 202] }
      const brainPorts = { left: [244, 177], right: [36, 177], top: [140, 207], bottom: [140, 147] }
      const room = roomPorts[position.dock], brain = brainPorts[position.dock]
      assert.ok(Number.isFinite(line.label.x) && Number.isFinite(line.label.y))
      assert.ok(!line.path.includes('NaN'))
      const samples = samplePath(line.path)
      for (const other of slots.slice(1).filter(other => other.id !== slot.id)) {
        const obstacle = positions.get(other.id), cx = width * obstacle.left / 100, cy = height * obstacle.top / 100
        const halfWidth = stationWidth(width) / 2 + 4, halfHeight = (48 + 230 * scale + 20) / 2 + 4
        assert.ok(samples.every(point => Math.abs(point.x - cx) >= halfWidth || Math.abs(point.y - cy) >= halfHeight), `${slot.id} connection crosses ${other.id} with ${count} desks`)
      }
      assert.ok(Math.abs(line.end.y - (nodeTop + 48 + room[1] * scale)) < .001, 'line must end on the actual room dock')
      assert.ok(Math.abs(line.end.x - (width * position.left / 100 + (room[0] - 140) * scale)) < .001)
      assert.ok(Math.abs(line.start.y - (height / 2 - (48 + 230 * scale + 20) / 2 + 48 + brain[1] * scale)) < .001, 'line must start on the matching brain dock')
      assert.ok(position.left > 0 && position.left < 100 && position.top > 0 && position.top < 100)
      const key = `${position.left}:${position.top}`
      assert.ok(!seen.has(key), 'each desk needs its own place'); seen.add(key)
    }
    const nodes = [...positions.values()]
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) assert.ok(Math.abs(nodes[a].left - nodes[b].left) * width / 100 >= 279 || Math.abs(nodes[a].top - nodes[b].top) * height / 100 >= 297, 'desks and manager must never overlap')
    if (count >= 4) for (const dock of ['left', 'right', 'top', 'bottom']) assert.ok(nodes.some(node => node.dock === dock), 'all four directions are used')
  }
}
for (const state of ['ready', 'queued', 'running', 'completed', 'failed', 'paused', 'unavailable']) {
  assert.ok(connectionLabel(state, true))
  assert.ok(connectionLabel(state, false))
}
console.log('Passed: truthful task links and expanding square rings with 1–48 desks, clear connection aisles, no overlaps, and aligned four-way docks. No AI or application data touched.')
