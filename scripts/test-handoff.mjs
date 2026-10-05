import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Exercise production functions without starting servers or sending messages.
const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const dispatches = []
const bridge = { delegationGrants: new Map() }
const context = vm.createContext({
  codexBridge: bridge,
  publicError: (error) => error.message,
  delegateToOpenCode: async (...args) => {
    dispatches.push(args)
    await Promise.resolve()
    return { opencodeSessionId: 'session' }
  },
})
vm.runInContext(`const methods = { ${between('  consumeDelegationGrant(', '  clearDelegationGrant(')} }; codexBridge.consumeDelegationGrant = methods.consumeDelegationGrant`, context)
vm.runInContext(between('async function handleCodexToolCall(', '\nfunction asOpenCodeRecord('), context)
vm.runInContext(between('function withHandoffContext(', '\nasync function ensureOpenCodeLink('), context)
const call = (task, turnId = 'turn') => context.handleCodexToolCall({
  namespace: 'relay', tool: 'delegate_to_opencode', threadId: 'thread', turnId, arguments: { task },
})
const grant = () => bridge.delegationGrants.set('thread', {
  task: 'Please send hi to the other chat', attachments: [], turnId: 'turn', used: false, expiresAt: Date.now() + 60_000,
})

assert.equal((await call('hi')).success, false, 'No authorization cannot delegate')
grant()
for (const task of [undefined, {}, '', '   ', 'a'.repeat(100_001), 'a\0b']) {
  assert.equal((await call(task)).success, false)
}
assert.equal((await call('hi', 'wrong-turn')).success, false)
const results = await Promise.all([call('hi'), call('hi')])
assert.equal(results.filter((result) => result.success).length, 1)
assert.equal(dispatches.length, 1)
assert.equal(dispatches[0][1], 'hi')
assert.equal(context.withHandoffContext('hi', 'D:/project', []), 'hi')
assert.equal((await call('hi')).success, false, 'Replay cannot enqueue again')
grant()
bridge.delegationGrants.get('thread').attachments = ['src/App.tsx']
const task = 'Fix the composer\nKeep keyboard navigation.'
assert.equal((await call(task)).success, true)
assert.equal(dispatches[1][1], task)
assert.deepEqual(dispatches[1][2], ['src/App.tsx'])
const attached = context.withHandoffContext(task, 'D:/project', ['src/App.tsx'])
assert.ok(attached.includes('D:/project') && attached.includes('src/App.tsx') && attached.endsWith(task))
console.log('Passed: clean intended payload, validation, authorization, concurrent/replayed dispatch prevention, coding tasks and attachment scope.')

// Follow the production dispatcher through to the outgoing API request.
const requests = []
const events = []
const state = { links: { thread: { opencodeSessionId: 'ses_target', directory: 'D:/project' } } }
const deliveryContext = vm.createContext({
  ensureOpenCodeLink: async () => state.links.thread,
  handoffDirectory: async () => 'D:/project',
  openCodeApi: async (method, path, body) => {
    requests.push({ method, path, body })
    return { data: { id: 'message', sessionID: 'ses_target', delivery: 'queue' } }
  },
  updateCodexState: async (update) => update(state),
  appendRelayEvent: async (event) => events.push(event),
})
vm.runInContext(between('function withHandoffContext(', '\nasync function ensureOpenCodeLink('), deliveryContext)
vm.runInContext(between('async function delegateToOpenCode(', '\nasync function handleCodexToolCall('), deliveryContext)
await deliveryContext.delegateToOpenCode('thread', 'hi')
assert.equal(requests.length, 1)
assert.equal(requests[0].method, 'POST')
assert.equal(requests[0].path, '/api/session/ses_target/prompt')
assert.equal(requests[0].body.text, 'hi')
assert.equal(events.length, 1)
assert.equal(events[0].sessionId, 'ses_target')
console.log('Passed: production dispatcher sends one prompt to exactly one linked OpenCode session and records one matching event.')
