import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
