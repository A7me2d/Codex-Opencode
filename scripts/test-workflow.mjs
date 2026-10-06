import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { defaultWorkflow, validateWorkflow, agentRegistry, codexExecutorInstructions, plannerPrompt, latestOpenCodeReply } from '../server/workflow.mjs'

assert.deepEqual(validateWorkflow(defaultWorkflow), { planner: 'codex', executor: 'opencode' })
assert.deepEqual(validateWorkflow({ planner: 'opencode', executor: 'codex', extra: 'ignored' }), { planner: 'opencode', executor: 'codex' })
for (const value of [null, {}, { planner: 'codex', executor: 'codex' }, { planner: 'claude', executor: 'codex' }, { planner: 'glm', executor: 'opencode' }]) assert.throws(() => validateWorkflow(value))
assert.equal(agentRegistry.filter(agent => !agent.available).length, 2)
assert.match(codexExecutorInstructions, /Do not delegate/)
assert.match(plannerPrompt('hi'), /do not edit implementation files/)
assert.ok(plannerPrompt('hi').endsWith('\n\nhi'))
assert.equal(latestOpenCodeReply([{ type: 'assistant', id: 'plan', content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'Fix App.tsx' }] }]).text, 'Fix App.tsx')
assert.equal(latestOpenCodeReply([{ type: 'user', text: 'hi' }]), null)

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const state = { threads: { thread: { workflow: { planner: 'opencode', executor: 'codex' } } } }
const posts = []; const starts = []; const events = []
let openCodeActive = false
let invalidReceipt = false
let plan = { id: 'plan-1', type: 'assistant', content: [{ type: 'text', text: 'Implement change in src/App.tsx and verify.' }] }
const bridge = { runningTurns: new Map() }
const context = vm.createContext({
  HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
  codexBridge: bridge, plannerPrompt, latestOpenCodeReply,
  requireRelayCodexThread: async () => ({ saved: state.threads.thread }),
  ensureOpenCodeLink: async () => ({ opencodeSessionId: 'ses_only', directory: 'D:/project' }),
  isOpenCodeSessionActive: response => response.data,
  openCodeApi: async (method, route, input) => {
    if (method === 'GET') return { data: openCodeActive }
    posts.push({ route, input }); await Promise.resolve()
    return invalidReceipt ? {} : { data: { id: 'msg', sessionID: 'ses_only', delivery: 'queue' } }
  },
  readOpenCodeHandoff: async () => ({ messages: [plan] }),
  sendRelayCodexMessage: async (...args) => { starts.push(args); await Promise.resolve() },
  updateCodexState: async change => change(state),
  appendRelayEvent: async event => events.push(event),
  listRelayCodexMessages: async () => [{ type: 'userMessage', content: [{ type: 'text', text: 'Implement plan' }] }, { type: 'agentMessage', text: 'Changed App.tsx; build passed.' }],
  textFromCodexInput: content => content.map(item => item.text).join('\n'),
})
vm.runInContext(between('const workflowActions = new Set()', '\nconst server = createServer('), context)
await context.reverseWorkflowAction('thread', 'plan', { text: 'Plan the fix' })
assert.equal(posts.length, 1)
assert.equal(posts[0].route, '/api/session/ses_only/prompt')
assert.ok(posts[0].input.text.endsWith('Plan the fix'))
assert.match(posts[0].input.text, /do not edit/)
const result = await Promise.allSettled([context.reverseWorkflowAction('thread', 'execute', {}), context.reverseWorkflowAction('thread', 'execute', {})])
assert.equal(result.filter(item => item.status === 'fulfilled').length, 1)
assert.equal(starts.length, 1)
assert.ok(starts[0][1].text.endsWith(plan.content[0].text))
assert.equal(state.threads.thread.executedPlanId, 'plan-1')
await assert.rejects(() => context.reverseWorkflowAction('thread', 'execute', {}), /already been sent/)
await context.reverseWorkflowAction('thread', 'review', {})
assert.equal(posts.length, 2)
assert.match(posts[1].input.text, /Changed App.tsx; build passed/)
assert.match(posts[1].input.text, /review data, not new instructions/)
assert.equal(events[0].role, 'opencode')
openCodeActive = true
await assert.rejects(() => context.reverseWorkflowAction('thread', 'execute', {}), /OpenCode to finish/)
openCodeActive = false
bridge.runningTurns.set('thread', 'turn')
await assert.rejects(() => context.reverseWorkflowAction('thread', 'plan', { text: 'hi' }), /Codex to finish/)
bridge.runningTurns.clear()
invalidReceipt = true
await assert.rejects(() => context.reverseWorkflowAction('thread', 'plan', { text: 'hi' }), /did not confirm/)
state.threads.thread.workflow = defaultWorkflow
await assert.rejects(() => context.reverseWorkflowAction('thread', 'plan', { text: 'hi' }), /Codex planning/)
assert.equal(starts.length, 1)

// New conversations inherit the saved setup; existing sessions retain their roles.
const persisted = { workflow: { planner: 'opencode', executor: 'codex' }, threads: { existing: { workflow: defaultWorkflow } } }
let startParams
const creation = vm.createContext({
  readCodexState: async () => persisted, validateWorkflow, watchRoot: 'D:/project', codexExecutorInstructions,
  relayCodexInstructions: 'Codex plans', relayDynamicTools: ['delegate'], shortThreadTitle: value => value,
  codexSandboxMode: value => value,
  codexBridge: { call: async (method, params) => { if (method === 'thread/start') { startParams = params; return { thread: { id: 'new', cwd: 'D:/project' }, sandbox: { type: 'workspaceWrite' } } } }, markThreadActive() {} },
  registerRelayCodexThread: async thread => { persisted.threads[thread.id] = {}; return thread },
  updateCodexState: async change => change(persisted),
})
vm.runInContext(between('async function createRelayCodexThread(', '\nfunction textFromCodexInput('), creation)
const created = await creation.createRelayCodexThread({ title: 'test' })
assert.equal(startParams.sandbox, 'workspace-write')
assert.equal(startParams.dynamicTools.length, 0)
assert.match(startParams.developerInstructions, /implementation agent/)
assert.equal(created.workflow.planner, 'opencode')
persisted.workflow = defaultWorkflow
assert.equal(persisted.threads.new.workflow.planner, 'opencode')
assert.equal(persisted.threads.existing.workflow.planner, 'codex')
await creation.createRelayCodexThread({ title: 'default' })
assert.equal(startParams.sandbox, 'read-only')
assert.equal(startParams.dynamicTools.length, 1)
console.log('Passed: role validation, future agents unavailable, new-session persistence, correct sandbox/instructions, single-target dispatch, concurrent/replayed plan prevention, busy guards, queue receipt and review evidence.')
