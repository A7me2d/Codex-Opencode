import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/features/super-agent/office-connections.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { officeConnection, officePositions, officeConnector, stationWidth, connectionLabel } = context.exports
const desk = { id: 'worker-4', thread: { id: 'ses_exact', provider: 'opencode' } }
const task = { id: 'job-1', slotId: 'worker-4', threadId: 'ses_exact', managerThreadId: 'manager', status: 'running' }
for (const status of ['queued', 'dispatching', 'running', 'completed', 'failed', 'interrupted']) assert.equal(officeConnection(desk, [{ ...task, status }], 'manager', true, false).state, status)
assert.equal(officeConnection(desk, [], 'manager', true, false).state, 'ready', 'opening a bound chat must not invent a running task')
assert.equal(officeConnection(desk, [task], 'different-manager', true, false).state, 'ready')
assert.equal(officeConnection({ ...desk, thread: { id: 'replacement' } }, [task], 'manager', true, false).state, 'ready', 'rebound desks must not inherit an old task link')
assert.equal(officeConnection(desk, [task], 'manager', false, false).state, 'paused')
assert.equal(officeConnection(desk, [task], 'manager', true, true).state, 'unavailable', 'failed polling must not advertise stale activity')
assert.equal(officeConnection(desk, [task], undefined, true, false).state, 'unassigned')
assert.equal(officeConnection({ id: 'worker-9', thread: null }, [task], 'manager', true, false).state, 'unassigned')
assert.equal(officeConnection(desk, [{ ...task, status: 'queued' }, { ...task, id: 'old', status: 'completed' }], 'manager', true, false).state, 'queued', 'the newest task overrides earlier successes')
for (const count of [1, 2, 3, 4, 8, 11]) {
  const slots = [{ id: 'manager' }, ...Array.from({ length: count }, (_, index) => ({ id: `worker-${index * 2 + 1}` }))]
  const positions = officePositions(slots)
  assert.equal(positions.size, slots.length)
  for (const width of [850, 1200, 1440]) {
    const height = Math.max(650, Math.ceil(count / 2) * 330 + 40)
    for (const slot of slots.slice(1)) {
      const position = positions.get(slot.id), line = officeConnector(position, width, height)
      const scale = stationWidth(width) / 280, nodeTop = height * position.top / 100 - (48 + 230 * scale + 20) / 2
      assert.ok(Number.isFinite(line.label.x) && Number.isFinite(line.label.y))
      assert.ok(!line.path.includes('NaN'))
      assert.ok(Math.abs(line.end.y - (nodeTop + 48 + 126 * scale)) < .001, 'line must end on the actual room dock')
      assert.ok(Math.abs(line.start.y - (height / 2 - (48 + 230 * scale + 20) / 2 + 48 + 177 * scale)) < .001, 'line must start on the brain base dock')
      assert.ok(position.left > 50 ? line.end.x > line.start.x : line.end.x < line.start.x)
    }
  }
}
for (const state of ['ready', 'queued', 'running', 'completed', 'failed', 'paused', 'unavailable']) {
  assert.ok(connectionLabel(state, true))
  assert.ok(connectionLabel(state, false))
}
console.log('Passed: exact task/session/manager binding, truthful queue/run/reply/error/paused states, no click-as-delivery, and aligned room/brain ports at multiple scene widths and 1–11 dynamic desks. No AI or application data touched.')
