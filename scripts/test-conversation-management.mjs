import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { conversationTime, conversationTitle } from '../server/conversation-management.mjs'

assert.equal(conversationTime(1_790_000_000), 1_790_000_000_000)
assert.equal(conversationTime('1790000000'), 1_790_000_000_000)
assert.equal(conversationTime('2026-10-13T00:00:00Z'), Date.parse('2026-10-13T00:00:00Z'))
assert.equal(conversationTime('invalid'), 0)
assert.equal(conversationTitle('  A\n new name  '), 'A new name')
assert.throws(() => conversationTitle(' '), /conversation name/)
assert.throws(() => conversationTitle('x'.repeat(121)), /120/)

const state = { threads: {
  older: { id: 'older', title: 'Old', updatedAt: 1_790_000_000_000, directory: 'project', workflow: { planner: 'codex', executor: 'opencode' } },
  newest: { id: 'newest', title: 'New', lastMessageAt: 1_790_000_010_000, directory: 'project' },
  empty: { id: 'empty', title: 'Empty', updatedAt: 1_790_000_005_000, directory: 'project' },
}, links: { older: { opencodeSessionId: 'ses_preserved' } } }
const calls = []
let failMutation = false
let running = false
let linkedRunning = false
const bridge = {
  activeThreads: new Set(['empty']), threadInstructions: new Map([['older', 'preserved instructions']]),
  getTurnState: () => ({ active: running }),
  call: async (method, params) => {
    calls.push({ method, params })
    if (method === 'thread/list') return { data: [
      { id: 'older', cwd: 'project', updatedAt: 1_790_000_000 },
      { id: 'newest', cwd: 'other-project', updatedAt: 1_790_000_010 },
    ] }
    if (method === 'thread/read') return { thread: { id: params.threadId, cwd: 'project', status: { type: 'idle' } } }
    if (failMutation) throw new Error('provider rejected mutation')
    return {}
  },
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
const context = vm.createContext({
  conversationTime, conversationTitle, codexBridge: bridge, HttpError, Date,
  readCodexState: async () => state, updateCodexState: async change => change(state),
  safeCodexThreadId: id => id, existsSync: () => true, isWorkRoot: root => root === 'project', defaultWorkflow: {},
  adoptedLookupCache: null,
  openCodeApi: async () => ({ active: linkedRunning }), isOpenCodeSessionActive: response => response.active,
})
const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
vm.runInContext(source.slice(source.indexOf('async function listAllCodexThreads('), source.indexOf('async function createRelayCodexThread(')), context)

const listed = await context.listAllCodexThreads()
assert.deepEqual(Array.from(listed, thread => thread.id), ['newest', 'empty', 'older'])
await context.listAllCodexThreads(true)
assert.equal(calls.at(-1).params.archived, true)

await context.manageCodexThread('older', 'rename', { title: '  Renamed  ' })
assert.equal(state.threads.older.title, 'Renamed')
assert.equal(state.threads.older.updatedAt, 1_790_000_000_000)
assert.equal(state.links.older.opencodeSessionId, 'ses_preserved')
assert.equal(calls.at(-1).method, 'thread/name/set')
assert.equal(calls.some(call => call.method === 'thread/resume' || call.method === 'turn/interrupt'), false)

running = true
await assert.rejects(context.manageCodexThread('older', 'archive'), /Wait until/)
running = false; linkedRunning = true
await assert.rejects(context.manageCodexThread('older', 'archive'), /linked OpenCode/)
linkedRunning = false
failMutation = true
await assert.rejects(context.manageCodexThread('older', 'archive'), /provider rejected/)
assert.equal(state.threads.older.archived, undefined)
assert.equal(bridge.threadInstructions.get('older'), 'preserved instructions')
failMutation = false
await context.manageCodexThread('older', 'archive')
assert.equal(state.threads.older.archived, true)
assert.equal(state.links.older.opencodeSessionId, 'ses_preserved')
await context.manageCodexThread('older', 'restore')
assert.equal(state.threads.older.archived, false)
assert.equal(calls.at(-1).method, 'thread/unarchive')
assert.equal(calls.some(call => 'sandbox' in call.params || 'approvalPolicy' in call.params), false)
console.log('Passed: mixed timestamps sort by actual recency; rename validation; archive/restore preserves links; running work and failed provider mutations leave state intact; no resumes, interrupts, or permission overrides.')
