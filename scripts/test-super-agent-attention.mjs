import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/features/super-agent/desk-attention.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { deskAttentionItems, conciseAttentionDetail } = context.exports

const slot = { id: 'worker-7', label: '', thread: { id: 'ses7', provider: 'codex' } }
const base = { slotId: 'worker-7', threadId: 'ses7', managerThreadId: 'mgr' }

// waiting_input is one desk, one honest alert, in the requested wording.
const waiting = [{ id: 't7', ...base, status: 'waiting_input', text: 'راجع الإصلاح' }]
const firstQuestion = deskAttentionItems([slot], [{ ...waiting[0], updatedAt: '2026-10-17T10:00:00Z' }], 'mgr', true)[0]
const sameQuestion = deskAttentionItems([slot], [{ ...waiting[0], updatedAt: '2026-10-17T10:00:00Z' }], 'mgr', true)[0]
const nextQuestion = deskAttentionItems([slot], [{ ...waiting[0], updatedAt: '2026-10-17T10:01:00Z' }], 'mgr', true)[0]
assert.equal(firstQuestion.key, sameQuestion.key, 'polling does not repeat a dismissed question')
assert.notEqual(firstQuestion.key, nextQuestion.key, 'a later question in the same task can notify again')
let items = deskAttentionItems([slot], waiting, 'mgr', true)
assert.equal(items.length, 1)
assert.equal(items[0].kind, 'waiting_input')
assert.ok(items[0].message.includes('مكتب رقم 7 ينتظر ردك عشان يكمل'))
items = deskAttentionItems([slot], waiting, 'mgr', false)
assert.ok(items[0].message.includes('Desk 7'), items[0].message)
assert.ok(items[0].message.toLowerCase().includes('waiting'), items[0].message)

// A busy or done task must never pretend a question from the operator.
for (const status of ['ready', 'queued', 'dispatching', 'running', 'completed']) {
  items = deskAttentionItems([slot], [{ id: 't7', ...base, status }], 'mgr', true)
  assert.equal(items.length, 0, `${status} must stay silent`)
}

// failed reports the real error concisely: first line, no stack, capped length.
const failedTask = [{ id: 't7', ...base, status: 'failed', error: 'HttpError 500: the executor could not write the workspace file.\n    at CommandLineTools (file:server.mjs:12)\n' }]
items = deskAttentionItems([slot], failedTask, 'mgr', true)
assert.equal(items.length, 1)
assert.equal(items[0].kind, 'failed')
assert.equal(items[0].detail, 'HttpError 500: the executor could not write the workspace file.')
assert.ok(!items[0].detail.includes('at CommandLineTools'))
assert.ok(items[0].message.includes('تعذّر تنفيذ مهمة') && items[0].message.includes('مكتب رقم 7'))
const long = 'x'.repeat(200)
assert.equal(conciseAttentionDetail(long).length, 158)
assert.equal(conciseAttentionDetail(`line one\n${long}`), 'line one')
assert.ok(items[0].message)
// failed without a recorded error stays honest instead of inventing one.
const failedWithoutError = deskAttentionItems([slot], [{ id: 't7', ...base, status: 'failed' }], 'mgr', false)[0]
assert.equal(failedWithoutError.detail, 'Check the desk conversation for the reason.')

// tracking_unknown speaks for itself and is distinct from failed.
items = deskAttentionItems([slot], [{ id: 't7', ...base, status: 'tracking_unknown' }], 'mgr', true)
assert.equal(items[0].kind, 'tracking_unknown')
assert.ok(items[0].message.includes('تعذّرت متابعة مكتب رقم 7، افتح محادثته'))
items = deskAttentionItems([slot], [{ id: 't7', ...base, status: 'tracking_unknown' }], 'mgr', false)
assert.ok(items[0].message.includes('Lost track of Desk 7'))

// Latest task per desk wins by its own timestamps, whatever the list order.
items = deskAttentionItems([slot], [
  { id: 'old', ...base, status: 'completed' },
  { id: 't7b', ...base, status: 'waiting_input', updatedAt: '2026-02-01T10:00:00Z' },
  { id: 'older', ...base, status: 'failed', updatedAt: '2026-02-01T09:00:00Z' },
], 'mgr', false)
assert.equal(items.length, 1, 'one alert per desk, never a stack per poll')
assert.equal(items[0].task.id, 't7b')
assert.equal(items[0].kind, 'waiting_input')
// The server answers newest-first: with tied or missing timestamps the first entry keeps the seat.
items = deskAttentionItems([slot], [
  { id: 'fresh', ...base, status: 'waiting_input' },
  { id: 'stale', ...base, status: 'failed' },
], 'mgr', true)
assert.equal(items[0].task.id, 'fresh')

// A task bound to an old conversation or an old manager never alerts the current team.
assert.equal(deskAttentionItems([slot], [{ id: 't7', ...base, threadId: 'ses_old', status: 'waiting_input' }], 'mgr', true).length, 0)
assert.equal(deskAttentionItems([slot], [{ id: 't7', ...base, managerThreadId: 'previous', status: 'waiting_input' }], 'mgr', true).length, 0)

// Without the current manager binding there is nothing trustworthy to alert on.
assert.equal(deskAttentionItems([slot], waiting, undefined, true).length, 0)

// Identity is per task + kind, so dismissing one alert never hides a new
// question for the same desk, and repeated polls dedupe onto the same key.
const first = deskAttentionItems([slot], waiting, 'mgr', true)[0]
assert.equal(first.key, deskAttentionItems([slot], [{ ...waiting[0] }], 'mgr', true)[0].key)
assert.notEqual(first.key, deskAttentionItems([slot], [{ id: 't7', ...base, status: 'failed' }], 'mgr', true)[0].key)
assert.notEqual(first.key, deskAttentionItems([slot], [{ id: 't8', ...base, status: 'waiting_input' }], 'mgr', true)[0].key)

// Custom desk labels are honored and desks stay separated.
items = deskAttentionItems([
  { id: 'worker-3', label: 'الفرونت', thread: { id: 'ses3', provider: 'codex' } },
  { id: 'worker-7', label: '', thread: { id: 'ses7', provider: 'codex' } },
], [
  { id: 't3', slotId: 'worker-3', threadId: 'ses3', managerThreadId: 'mgr', status: 'waiting_input' },
  { id: 't7', slotId: 'worker-7', threadId: 'ses7', managerThreadId: 'mgr', status: 'failed', error: 'done failed' },
], 'mgr', true)
assert.equal(items.length, 2)
assert.ok(items.find(item => item.message.includes('الفرونت')))
assert.ok(items.every(item => item.slotId !== 'worker-7' || item.kind === 'failed'))

// Unassigned desks and the manager's slot never leak worker tasks.
assert.equal(deskAttentionItems([{ id: 'worker-9', label: '', thread: null }], waiting, 'mgr', true).length, 0)
assert.equal(deskAttentionItems([{ id: 'manager', label: '', thread: { id: 'mgr-ses', provider: 'codex' } }], waiting, 'mgr-ses', true).length, 0)
assert.equal(deskAttentionItems([], waiting, 'mgr', true).length, 0)

console.log('super-agent attention ok')
