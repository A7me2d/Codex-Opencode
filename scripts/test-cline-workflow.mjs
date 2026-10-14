import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { ClineWorkflow, workflowRolePrompt } from '../server/cline-workflow.mjs'
import { validateWorkflow, defaultWorkflow } from '../server/workflow.mjs'

function fixture(planner, executor) {
  const thread = { id: 'workflow-synthetic', directory: 'D:/synthetic-project', workflow: validateWorkflow({ planner, executor, plannerModel: 'model-a', executorModel: 'model-b' }) }
  const sessions = new Map(), creations = [], sends = []
  const external = { planner: { agent: planner, active: false, messages: [] }, executor: { agent: executor, active: false, messages: [] } }
  const cline = {
    create: async (directory, provider, options) => {
      await Promise.resolve()
      const session = { id: `synthetic-${sessions.size}`, directory, provider, savedOptions: options, active: false, messages: [] }
      sessions.set(session.id, session); creations.push(session); return session
    },
    get: async id => { const session = sessions.get(id); assert.ok(session); return session },
    connect: async () => {}, snapshot: session => ({ ...session }),
    prompt: async (id, text, messageId, charge, displayText) => {
      await charge(); sends.push({ id, text, messageId })
      sessions.get(id).messages.push({ id: messageId, role: 'user', text: displayText })
    },
  }
  const workflow = new ClineWorkflow({ cline, getThread: async () => thread, patchThread: async (_, patch) => Object.assign(thread, patch),
    getExternalRole: async (_, role) => external[role], sendExternalRole: async (_, role, text) => { sends.push({ role, agent: thread.workflow[role], text }); external[role].messages.push({ id: randomUUID(), role: 'user', text }) } })
  const reply = async (role, id, text) => {
    const view = await workflow.role(thread.id, role)
    view.messages.push({ id, role: 'assistant', text })
  }
  return { workflow, thread, creations, sends, sessions, external, reply }
}

for (const [planner, executor] of [['codex', 'cline'], ['cline', 'codex'], ['cline', 'opencode'], ['opencode', 'cline'], ['cline', 'cline']]) {
  const f = fixture(planner, executor)
  let charged = 0
  const charge = async () => { charged++ }
  await f.workflow.action(f.thread.id, 'plan', { messageId: 'plan-request-0001', text: 'Plan this authorized change' }, charge)
  assert.equal(f.sends.length, 1); assert.equal(charged, 1)
  assert.match(f.sends[0].text, /planner\/reviewer/)
  await f.reply('planner', 'plan-reply-001', 'Update the project file and report evidence.')
  await f.workflow.action(f.thread.id, 'execute', { messageId: 'execute-request-0001' }, charge)
  assert.equal(f.sends.length, 2); assert.equal(charged, 2)
  assert.match(f.sends[1].text, /executor/); assert.match(f.sends[1].text, /Update the project file/)
  await f.workflow.action(f.thread.id, 'execute', { messageId: 'execute-request-0001' }, charge)
  assert.equal(f.sends.length, 2); assert.equal(charged, 2, 'retry is neither dispatched nor charged twice')
  await assert.rejects(f.workflow.action(f.thread.id, 'execute', { messageId: 'execute-request-0002' }, charge), /already been sent/)
  await f.reply('executor', 'executor-reply-001', 'Changed the requested file; build passed.')
  await f.workflow.action(f.thread.id, 'review', { messageId: 'review-request-0001' }, charge)
  assert.equal(f.sends.length, 3); assert.equal(charged, 3)
  assert.match(f.sends[2].text, /Changed the requested file/); assert.match(f.sends[2].text, /conversation data/)
  await assert.rejects(f.workflow.action(f.thread.id, 'review', { messageId: 'review-request-0002' }, charge), /already been sent/)
  assert.equal(charged, 3)
  for (const role of ['planner', 'executor']) if (f.thread.workflow[role] === 'cline') {
    const session = f.sessions.get(f.thread[role === 'planner' ? 'clinePlannerSessionId' : 'clineExecutorSessionId'])
    assert.equal(session.provider, 'cline')
    assert.equal(session.savedOptions.find(option => option.id === 'model').value, role === 'planner' ? 'model-a' : 'model-b')
    assert.equal(session.savedOptions.find(option => option.id === 'mode').value, role === 'planner' ? 'plan' : 'act')
    assert.equal(session.messages[0].text.startsWith('[Open Zero role]'), false, 'role instructions stay out of the displayed user message')
  }
  if (planner === executor) assert.notEqual(f.thread.clinePlannerSessionId, f.thread.clineExecutorSessionId, 'two roles have distinct underlying conversations')
  const active = (await f.workflow.role(f.thread.id, 'planner')).session || f.external.planner
  if (active.id) f.sessions.get(active.id).active = true
  else active.active = true
  await assert.rejects(f.workflow.action(f.thread.id, 'plan', { messageId: 'blocked-request-0001', text: 'Another task' }, charge), /active agent/)
  assert.equal(charged, 3)
}

const f = fixture('cline', 'codex')
const bound = await Promise.all(Array.from({ length: 5 }, () => f.workflow.ensure(f.thread.id, 'planner')))
assert.equal(f.creations.length, 1, 'concurrent preparation creates only one role session')
assert.ok(bound.every(session => session.id === bound[0].id))
await f.workflow.ensure(f.thread.id, 'planner'); assert.equal(f.creations.length, 1)
await assert.rejects(f.workflow.ensure(f.thread.id, 'executor'), /not assigned to Cline/)
await assert.rejects(f.workflow.action(f.thread.id, 'plan', { messageId: 'license-rejection-01', text: 'Synthetic task' }, async () => { throw new Error('license denied') }), /license denied/)
assert.equal(f.sends.length, 0, 'a failed license never dispatches the task')
f.thread.archived = true
await assert.rejects(f.workflow.action(f.thread.id, 'plan', { messageId: 'archived-message-01', text: 'Synthetic task' }, async () => {}), /Restore/)
assert.equal(f.sends.length, 0)
assert.throws(() => validateWorkflow({ planner: 'cline', executor: 'codex' }), /Choose a Cline model/)
assert.throws(() => validateWorkflow({ planner: 'opencode', executor: 'opencode' }))
assert.deepEqual(validateWorkflow(defaultWorkflow), defaultWorkflow)

// Exercise the real local parent creation/list/archive code with fake providers.
const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const persisted = { threads: {}, workflow: validateWorkflow({ planner: 'cline', plannerModel: 'model-a', executor: 'codex' }) }
const calls = []
const bridge = { activeThreads: new Set(), getTurnState: () => ({ active: false }), call: async method => { calls.push(method); throw new Error('Codex unavailable') } }
const context = vm.createContext({ validateWorkflow, workflowRolePrompt, randomUUID, watchRoot: 'D:/synthetic-project',
  shortThreadTitle: value => value, readCodexState: async () => persisted, updateCodexState: async change => change(persisted),
  codexBridge: bridge, safeCodexThreadId: id => id, existsSync: () => true, isWorkRoot: () => true, defaultWorkflow,
  conversationTime: value => value || 0, conversationTitle: value => value, adoptedLookupCache: null,
  HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
  clineWorkflow: { read: async () => ({ planner: { active: false }, executor: { active: false } }) },
})
vm.runInContext(between('async function createRelayCodexThread(', '\nfunction textFromCodexInput('), context)
const created = await context.createRelayCodexThread({ title: 'Cline workflow' })
assert.equal(created.localWorkflow, true); assert.equal(calls.length, 0, 'a Cline planner does not create a Codex planner session')
vm.runInContext(between('async function listAllCodexThreads(', '\nasync function createRelayCodexThread('), context)
assert.equal((await context.listAllCodexThreads())[0].id, created.id, 'local conversations remain visible while Codex is unavailable')
const mutationsBefore = calls.length
await context.manageCodexThread(created.id, 'rename', { title: 'Renamed workflow' })
await context.manageCodexThread(created.id, 'archive', {})
assert.equal(persisted.threads[created.id].archived, true)
assert.equal((await context.listAllCodexThreads(true))[0].title, 'Renamed workflow')
await context.manageCodexThread(created.id, 'restore', {})
assert.equal(persisted.threads[created.id].archived, false)
assert.equal(calls.filter(method => method !== 'thread/list').length, 0, 'local metadata never mutates a fake Codex thread')
assert.ok(calls.length >= mutationsBefore)
console.log('Passed: all Cline role combinations, correct target/model/mode, separate persisted role bindings, preparation deduplication, plan/review/message replay guards, single license charge, busy/archive/license rejection, local conversation lifecycle without Codex. All agents and messages were synthetic.')
