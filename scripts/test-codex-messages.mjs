import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const context = vm.createContext({ safeCodexThreadId: (id) => id, publicError: (error) => error.message, ensureRelayCodexThreadLoaded: async () => {} })
vm.runInContext(`class Bridge { constructor() { this.liveMessages = new Map() } completeTurn() {} clearDelegationGrant() {} ${slice('  handleNotification(packet)', '  markThreadActive(')} }; const codexBridge = new Bridge(); globalThis.bridge = codexBridge`, context)
vm.runInContext(slice('async function listRelayCodexMessages(', '\nfunction extractOpenCodeTask('), context)
const bridge = context.bridge
bridge.handleNotification({ method: 'item/started', params: { threadId: 'thread', item: { id: 'reply', type: 'agentMessage', text: '' } } })
bridge.handleNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', itemId: 'reply', delta: 'latest reply' } })
assert.equal(bridge.getLiveMessages('thread')[0].text, 'latest reply')
bridge.handleNotification({ method: 'item/completed', params: { threadId: 'thread', item: { id: 'reply', type: 'agentMessage', text: 'latest reply' } } })
assert.equal(bridge.getLiveMessages('thread')[0].live, false)
const calls = []
bridge.call = async (_method, params) => {
  calls.push(params)
  return params.cursor ? { data: [{ item: { id: 'last-user', type: 'userMessage' } }], nextCursor: null }
    : { data: Array.from({ length: 200 }, (_, index) => ({ item: { id: `old-${index}`, type: 'agentMessage' } })), nextCursor: 'next' }
}
const messages = await context.listRelayCodexMessages('thread')
assert.equal(messages.length, 202)
assert.equal(messages[200].id, 'last-user')
assert.equal(messages[201].text, 'latest reply')
assert.equal(calls[1].cursor, 'next')
bridge.call = async () => ({ data: [{ item: { id: 'reply', type: 'agentMessage', text: 'latest reply' } }] })
assert.equal((await context.listRelayCodexMessages('thread')).length, 1)
assert.equal(bridge.getLiveMessages('thread').length, 0)
console.log('Passed: old chats paginate past 200 items; standard live events render; completed replies survive persistence delay and are deduplicated once saved.')
