import assert from 'node:assert/strict'
import { generateCommitMessage } from '../server/commit-message.mjs'

// Synthetic bridge only: no AI messages, license calls or Git mutations.
const context = { root: 'fixture', diff: '--- a/file.ts\n+++ b/file.ts\n+const added = true', stagedVersion: 'snapshot' }
const model = { model: 'fixture-model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }
function bridge({ ephemeral = true, text = JSON.stringify({ message: 'Add an example flag' }), complete = true } = {}) {
  const calls = []
  const instance = {
    calls, notificationListeners: new Set(), child: { stdin: { writable: true } },
    liveMessages: new Map([['existing-chat', 'keep']]), runningTurns: new Map([['existing-chat', 'keep']]),
    activeThreads: new Set(['existing-chat']), threadInstructions: new Map([['existing-chat', 'keep']]),
    completedTurns: new Map([['existing-chat:turn', 1]]), instructionRequests: new Map(),
    async call(method, params) {
      calls.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'generated-thread', ephemeral } }
      if (method === 'turn/start') {
        queueMicrotask(() => {
          const send = packet => instance.notificationListeners.forEach(listener => listener(packet))
          send({ method: 'turn/started', params: { threadId: 'generated-thread', turn: { id: 'generated-turn' } } })
          send({ method: 'turn/completed', params: { threadId: 'existing-chat', turn: { status: 'completed', items: [{ id: 'other', type: 'agentMessage', text: 'Ignore this' }] } } })
          if (complete) {
            send({ method: 'item/completed', params: { threadId: 'generated-thread', item: { id: 'result', type: 'agentMessage', text } } })
            send({ method: 'turn/completed', params: { threadId: 'generated-thread', turn: { id: 'generated-turn', status: 'completed', items: [] } } })
          }
        })
        return { turn: { id: 'generated-turn', status: 'inProgress' } }
      }
      return {}
    },
  }
  return instance
}
let charges = 0
const good = bridge()
assert.deepEqual(await generateCommitMessage(good, context, model, async () => { charges++ }), { message: 'Add an example flag', model: 'fixture-model', stagedVersion: 'snapshot' })
assert.equal(charges, 1)
assert.equal(good.calls[0].params.ephemeral, true)
assert.equal(good.calls[0].params.sandbox, 'read-only')
assert.deepEqual(good.calls[0].params.dynamicTools, [])
assert.equal(good.calls.find(call => call.method === 'turn/start').params.effort, 'low')
assert.equal(good.calls.some(call => call.method === 'thread/resume'), false)
assert.equal(good.notificationListeners.size, 0)
assert.equal(good.liveMessages.get('existing-chat'), 'keep')
assert.equal(good.runningTurns.get('existing-chat'), 'keep')
assert.equal(good.completedTurns.has('existing-chat:turn'), true)
const denied = bridge()
await assert.rejects(generateCommitMessage(denied, context, model, async () => { throw Error('license denied') }), /license denied/)
assert.equal(denied.calls.some(call => call.method === 'turn/start'), false, 'no model turn before licensing succeeds')
const old = bridge({ ephemeral: false })
await assert.rejects(generateCommitMessage(old, context, model, async () => { charges++ }), /private/)
assert.equal(charges, 1, 'unsupported runtime does not consume allowance')
const invalid = bridge({ text: 'not JSON' })
await assert.rejects(generateCommitMessage(invalid, context, model, async () => {}), /invalid/)
assert.equal(invalid.notificationListeners.size, 0)
const slow = bridge({ complete: false })
await assert.rejects(generateCommitMessage(slow, context, model, async () => {}, { timeoutMs: 20 }), /timed out/)
assert.equal(slow.calls.some(call => call.method === 'turn/interrupt' && call.params.threadId === 'generated-thread'), true)
assert.equal(slow.calls.some(call => call.method === 'turn/interrupt' && call.params.threadId === 'existing-chat'), false)
assert.equal(slow.notificationListeners.size, 0)
console.log('Passed: private structured generation, selected model, single authorization, existing chat isolation, invalid output and timeout cleanup. No AI or Git operation ran.')
