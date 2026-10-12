import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { codexPlannerInstructions, codexExecutorInstructions, codexToCodexExecutorInstructions } from '../server/workflow.mjs'

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const context = vm.createContext({ safeCodexThreadId: id => Boolean(id), Date })
vm.runInContext(source.slice(source.indexOf('class CodexAppServerBridge {'), source.indexOf('const codexBridge =')), context)
const bridge = vm.runInContext('new CodexAppServerBridge()', context)
bridge.ensureStarted = async () => {}
const calls = []
let failResume = false
bridge.call = async (method, params) => {
  calls.push({ method, params })
  await Promise.resolve()
  if (failResume && method === 'thread/resume') throw new Error('resume failed')
  return { model: 'test-model' }
}
const params = { cwd: 'D:/project', developerInstructions: 'new instructions', excludeTurns: true }
bridge.markThreadActive('existing', 'old instructions')
bridge.runningTurns.set('existing', { turnId: 'running' })
await bridge.resumeThread('existing', params)
assert.equal(calls.length, 0)
assert.equal(bridge.threadInstructions.get('existing'), 'old instructions')
bridge.completeTurn('existing', 'running')
await Promise.all([bridge.resumeThread('existing', params), bridge.resumeThread('existing', params)])
assert.deepEqual(calls.map(call => call.method), ['thread/unsubscribe', 'thread/resume'])
assert.equal(calls[1].params.threadId, 'existing')
assert.equal(calls[1].params.developerInstructions, params.developerInstructions)
for (const call of calls) {
  assert.equal('sandbox' in call.params, false)
  assert.equal('approvalPolicy' in call.params, false)
  assert.equal('history' in call.params, false)
}
await bridge.resumeThread('existing', params)
assert.equal(calls.length, 2)
// Concurrent requests with different instructions must not silently coalesce.
await Promise.all([
  bridge.resumeThread('existing', { ...params, developerInstructions: 'second' }),
  bridge.resumeThread('existing', { ...params, developerInstructions: 'third' }),
])
assert.equal(bridge.threadInstructions.get('existing'), 'third')
failResume = true
await assert.rejects(bridge.resumeThread('existing', params), /resume failed/)
assert.equal(bridge.resumingThreads.size, 0)
assert.equal(bridge.threadInstructions.has('existing'), false)
failResume = false
await bridge.resumeThread('existing', params)
assert.equal(bridge.threadInstructions.get('existing'), params.developerInstructions)
// Fresh threads already have their instructions and need no persisted rollout.
bridge.markThreadActive('fresh', params.developerInstructions)
const before = calls.length
await bridge.resumeThread('fresh', params)
assert.equal(calls.length, before)
for (const instructions of [codexPlannerInstructions, codexExecutorInstructions, codexToCodexExecutorInstructions]) {
  assert.doesNotMatch(instructions, /do not edit implementation files|do not .*begin implementation/i)
  assert.match(instructions, /authorized/)
}
console.log('Passed: instruction refresh, busy deferral, same-history resume, permissions preserved, concurrency, retry, fresh threads, workflow execution instructions.')

// Verify capture at the actual transport boundary, rather than the resume cache.
const transport = vm.runInContext('new CodexAppServerBridge()', context)
context.setTimeout = setTimeout
context.clearTimeout = clearTimeout
transport.child = { stdin: { writable: true } }
const records = []
transport.recordInstructionRequest = record => records.push(record)
let packet
transport.write = message => { packet = message }
const accepted = transport.requestRaw('thread/resume', { threadId: 'existing', ...params }, 1000)
assert.equal(packet.params.developerInstructions, params.developerInstructions)
assert.equal(records[0].status, 'sent')
const waiting = transport.pending.get(String(packet.id))
clearTimeout(waiting.timer)
transport.pending.delete(String(packet.id))
waiting.resolve({ thread: { id: 'existing' } })
await accepted
assert.equal(records.at(-1).status, 'rpc-accepted')
assert.equal(records.at(-1).effectiveInstructions, 'unverified')
assert.equal(records.at(-1).permissionsOverridden, false)
transport.write = () => { throw new Error('broken pipe') }
await assert.rejects(transport.requestRaw('thread/resume', { threadId: 'existing', ...params }, 1000), /broken pipe/)
assert.equal(transport.pending.size, 0)
assert.equal(records.at(-1).status, 'rpc-failed')
console.log('Passed: actual outbound instructions captured; RPC acceptance is not effective-context proof; transport failure clears pending requests.')

Object.assign(context, { codexPlannerInstructions, codexExecutorInstructions, codexToCodexExecutorInstructions, relayCodexInstructions: 'relay instructions' })
vm.runInContext(source.slice(source.indexOf('function threadInstructionSelection('), source.indexOf('function codexSandboxMode(')), context)
assert.equal(context.threadInstructionSelection({}).source, 'relayCodexInstructions')
assert.equal(context.threadInstructionSelection({ workflow: { planner: 'codex', executor: 'codex' } }).text, codexPlannerInstructions)
assert.equal(context.threadInstructionSelection({ workflow: { planner: 'opencode', executor: 'codex' } }).text, codexExecutorInstructions)
assert.equal(context.threadInstructionSelection({ workflowRole: 'executor', workflow: { planner: 'codex', executor: 'codex' } }).text, codexToCodexExecutorInstructions)

// Persist only synthetic instructions in isolated storage, never the real state.
const auditRoot = await mkdtemp(path.join(tmpdir(), 'openzero-instruction-audit-'))
try {
  Object.assign(context, { appendFile, mkdir, path, stateDirectory: auditRoot })
  const diskBridge = vm.runInContext('new CodexAppServerBridge()', context)
  diskBridge.recordInstructionRequest(records[0])
  diskBridge.recordInstructionRequest(records[1])
  await diskBridge.instructionAuditWrites
  assert.equal(diskBridge.instructionAuditError, null)
  const lines = (await readFile(path.join(auditRoot, 'codex-instructions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].developerInstructions, params.developerInstructions)
  assert.equal(lines[1].status, 'rpc-accepted')
  assert.equal(lines[1].effectiveInstructions, 'unverified')
} finally { await rm(auditRoot, { recursive: true, force: true }) }
console.log('Passed: all four saved-role instruction sources and ordered audit persistence in isolated storage.')
