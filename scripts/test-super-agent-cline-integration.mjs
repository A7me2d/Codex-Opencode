import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { SuperAgentStore, superProvider, superAgentInstructions } from '../server/super-agent.mjs'
import { SuperAgentCoordinator } from '../server/super-agent-coordinator.mjs'

// Exercise the production send, binding guards, endpoints and coordinator with synthetic transports.
const root = await mkdtemp(path.join(tmpdir(), 'openzero-cline-desks-'))
try {
  const store = new SuperAgentStore(root), team = await store.create('Mixed team')
  await store.addSlot(team.id); await store.addSlot(team.id)
  const session = { id: '01a13020-cfe9-7583-917f-495c5a4d1a71', directory: root, provider: 'cline', title: 'Cline desk', active: false, loading: false, preparing: false, permissions: [], messages: [], archived: false }
  const clineThread = { id: session.id, directory: root, provider: 'cline', clineProvider: 'cline' }
  await store.bind(team.id, 'manager', async () => ({ id: 'manager', directory: root }))
  await store.bind(team.id, 'worker-1', async () => clineThread)
  await store.bind(team.id, 'worker-2', async () => ({ id: 'ses_opencode', directory: root, provider: 'opencode' }))
  await assert.rejects(store.bind(team.id, 'manager', async () => clineThread), /manager must use Codex/)
  assert.equal(superProvider(clineThread), 'cline')
  assert.equal(superProvider({}), 'codex')
  assert.equal((await new SuperAgentStore(root).get(team.id)).slots[1].thread.provider, 'cline')
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  let disabled = false, licenseBlocked = false, parentUsesSession = false, prepares = 0, sends = 0, charges = 0, codexCalls = 0, coordinator, turnStatus = 'completed'
  const managerTurn = { active: true, turnId: 'manager-turn' }, completed = new Map()
  const bridge = { sessions: new Map([[session.id, session]]), get: async id => { assert.equal(id, session.id); return session },
    permission: async () => { session.permissions = [] }, configure: async () => ({ configured: true }), reconnect: async () => ({ connected: true }) }
  const cline = {
    turn: () => ({ active: false }),
    status: async () => ({ active: session.active, waitingPermission: Boolean(session.permissions.length), error: null }),
    read: async () => structuredClone(session),
    prepare: async () => { prepares++; if (session.permissions.length || session.active) throw new Error('Cline busy') },
    send: async (id, text, messageId, displayText) => {
      sends++; assert.equal(id, session.id); assert.match(text, /Approved project\/team memory/); assert.equal(displayText, 'Scoped task')
      const turn = { id: messageId, status: turnStatus }; completed.set(messageId, 'Exact Cline reply')
      coordinator?.complete(id, turn, 'cline')
      return { turn }
    },
    reply: (id, turnId) => completed.get(turnId) || '', stop: async () => {},
  }
  const context = vm.createContext({
    path, superAgent: store, superProvider, superCline: cline, clineBridge: bridge,
    codexBridge: { messageStarts: new Set(), getTurnState: id => { codexCalls++; assert.equal(id, 'manager'); return managerTurn } },
    superOpenCode: { turn: () => ({ active: false }), prepare: async () => {}, send: async () => ({ turn: { id: 'opencode-turn', status: 'completed' } }) },
    HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
    providerActivity: { require: async provider => { if (disabled && provider === 'cline') throw new Error('provider disabled') } },
    readCodexState: async () => ({ threads: parentUsesSession ? { parent: { clineExecutorSessionId: session.id } } : {} }),
    requireRelayCodexThread: async () => { throw new Error('Cline must not route to Codex') },
    ensureRelayCodexThreadLoaded: async () => { throw new Error('Cline must not resume Codex') },
    consumeLicensedMessage: async () => { if (licenseBlocked) throw new Error('license blocked'); charges++ },
    superAgentKnowledge: async () => [{ kind: 'preference', text: 'Approved fact' }], superAgentInstructions,
  })
  vm.runInContext(source.slice(source.indexOf('const superTurn ='), source.indexOf('async function requireSuperOpenCodeThread(')), context)
  vm.runInContext(source.slice(source.indexOf('async function sendSuperAgentMessage('), source.indexOf('const superCoordinator =')), context)
  const send = messageId => context.sendSuperAgentMessage(team.id, 'worker-1', { threadId: session.id, text: 'Scoped task', messageId, attachments: [] })
  disabled = true; await assert.rejects(send('disabled-message'), /disabled/); disabled = false
  licenseBlocked = true; await assert.rejects(send('license-message'), /license blocked/); licenseBlocked = false
  assert.equal(sends, 0); assert.equal(charges, 0)
  await assert.rejects(context.sendSuperAgentMessage(team.id, 'worker-1', { threadId: session.id, text: 'x'.repeat(100000), messageId: 'oversized-context' }), /Shorten/)
  await assert.rejects(context.sendSuperAgentMessage(team.id, 'worker-1', { threadId: session.id, text: 'Scoped task', attachments: 'not-an-array', messageId: 'invalid-attachments' }), /file paths/)
  assert.equal(charges, 0, 'invalid complete prompts are rejected before consuming license credit')
  parentUsesSession = true; await assert.rejects(send('owned-by-workflow'), /main-chat workflow/); parentUsesSession = false
  session.permissions = [{ id: 'permission' }]; await assert.rejects(send('pending-permission'), /busy|active turn/); session.permissions = []
  const beforeCodex = codexCalls
  await send('direct-message-001'); await send('direct-message-001')
  assert.equal(sends, 1); assert.equal(charges, 1); assert.equal(codexCalls, beforeCodex, 'UUID-shaped Cline IDs never query Codex')
  assert.ok(prepares > 0)
  const params = { threadId: 'manager', turnId: 'manager-turn', tool: 'dispatch_tasks', callId: 'one-batch', arguments: { tasks: [{ slotId: 'worker-1', text: 'Scoped task' }] } }
  coordinator = new SuperAgentCoordinator(path.join(root, 'jobs'), {
    team: id => store.get(id), enabled: async () => {}, turn: (id, provider) => vm.runInContext('superTurn', context)(id, provider),
    send: (grant, target, messageId) => context.sendSuperAgentMessage(grant.teamId, target.slot.id, { threadId: target.slot.thread.id, text: target.text, messageId, attachments: [] }),
    reply: (id, turnId, provider) => { assert.equal(provider, 'cline'); return cline.reply(id, turnId) },
  })
  coordinator.bind(coordinator.arm('manager', team.id, 'manager', 'manager-request-001'), 'manager-turn')
  const result = await coordinator.tool(params)
  assert.equal(result[0].status, 'completed'); assert.equal(result[0].reply, 'Exact Cline reply')
  assert.equal(coordinator.jobs[0].provider, 'cline'); assert.equal(sends, 2); assert.equal(charges, 2)
  assert.equal(coordinator.grants.has('manager'), true, 'Cline completions must not revoke the Codex manager grant')
  await coordinator.tool(params); assert.equal(sends, 2)
  for (const status of ['interrupted', 'failed']) {
    turnStatus = status
    coordinator.bind(coordinator.arm('manager', team.id, 'manager', `manager-${status}`), 'manager-turn')
    const outcome = await coordinator.tool({ ...params, callId: `call-${status}` })
    assert.equal(outcome[0].status, status)
    assert.equal(outcome[0].reply, undefined, 'an old reply must not turn a cancelled/failed task into success')
    assert.equal(coordinator.jobs.at(-1).status, status)
  }

  // Execute the exact production Cline desk route without a live server, CLI or license service.
  const route = source.slice(source.indexOf('      const clineDesk ='), source.indexOf("      if (url.pathname === '/api/super-agent/opencode-sessions'"))
  vm.runInContext(`async function testRoute(request, url, input) { const response = {}; const readJson = async () => input; const sendJson = (_, status, body) => { response.status = status; response.body = body }; await (async () => { ${route} })(); return response }`, context)
  const endpoint = action => ({ pathname: `/api/super-agent/teams/${team.id}/slots/worker-1/cline${action ? `/${action}` : ''}` })
  const localPrepares = prepares
  assert.equal((await context.testRoute({ method: 'GET' }, endpoint('status'))).body.data.waitingPermission, false)
  assert.equal((await context.testRoute({ method: 'GET' }, endpoint(''))).body.data.id, session.id)
  assert.equal(prepares, localPrepares, 'reading desk state never starts or reconnects Cline')
  await assert.rejects(context.testRoute({ method: 'POST' }, endpoint('config'), { configId: 'auto_approve', value: true }), /model or mode/)
  assert.equal((await context.testRoute({ method: 'POST' }, endpoint('config'), { configId: 'mode', value: 'plan' })).body.data.configured, true)
  await store.update(team.id, { archived: true })
  await assert.rejects(context.testRoute({ method: 'POST' }, endpoint('connect'), {}), /Restore/)
  await store.update(team.id, { archived: false })
  store.sending.add(session.id)
  await assert.rejects(context.testRoute({ method: 'POST' }, endpoint('permission'), {}), /already being sent/)
  store.sending.clear()
  disabled = true; await assert.rejects(context.testRoute({ method: 'GET' }, endpoint('status')), /disabled/)
  disabled = false
  const bindStart = source.indexOf("          if (provider === 'cline') {")
  const bindBranch = source.slice(bindStart, source.indexOf("          if (provider === 'opencode') {", bindStart))
  Object.assign(context, { realpath, stat, shortThreadTitle: title => title })
  let creations = 0
  bridge.credentials = () => ({ model: 'available-model' })
  bridge.models = async () => [{ id: 'available-model' }]
  bridge.create = async (directory, account, options) => {
    creations++; assert.equal(directory.toLowerCase(), (await realpath(root)).toLowerCase()); assert.equal(account, 'cline')
    assert.equal(options.find(option => option.id === 'model').value, 'available-model')
    assert.equal(options.find(option => option.id === 'mode').value, 'act')
    return session
  }
  bridge.metadata = async () => {}
  vm.runInContext(`async function testBinding(input) { const current = { id: 'new-team', title: 'New team' }; const match = [null, null, 'worker-2']; const provider = 'cline'; ${bindBranch} }`, context)
  await assert.rejects(context.testBinding({ directory: root, model: 'removed-model' }), /not available/)
  await assert.rejects(context.testBinding({ directory: root, clineProvider: 'unknown' }), /supported Cline/)
  await assert.rejects(context.testBinding({ directory: 'relative/folder' }), /absolute/)
  assert.equal(creations, 0, 'invalid models/providers/folders never create a session')
  await assert.rejects(context.testBinding({ directory: root }), /already belongs to another desk/)
  assert.equal(creations, 1)
  await assert.rejects(context.testBinding({ threadId: session.id }), /already belongs to another desk/)
  parentUsesSession = true
  await assert.rejects(context.testBinding({ threadId: session.id }), /main-chat workflow/)
  console.log('Passed: explicit Cline routing for UUID IDs, exact manager replies, provider isolation, persistence, license/dedup guards, workflow ownership, local-only reads and scoped desk endpoint guards. All transports were synthetic.')
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
  assert.ok(path.basename(root).startsWith('openzero-cline-desks-'))
  await rm(root, { recursive: true, force: true })
}
