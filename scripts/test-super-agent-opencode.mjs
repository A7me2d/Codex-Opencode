import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { SuperAgentOpenCode } from '../server/super-agent-opencode.mjs'
import { SuperAgentStore, superProvider, superAgentInstructions } from '../server/super-agent.mjs'
import { SuperAgentCoordinator } from '../server/super-agent-coordinator.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-mixed-desks-'))
try {
  const sessions = new Map(), calls = [], charges = [], enabled = []
  const fixture = id => {
    if (!sessions.has(id)) sessions.set(id, { messages: [{ id: 'old-reply', type: 'assistant', text: 'WRONG OLD REPLY' }], inbox: [], forms: [] })
    return sessions.get(id)
  }
  const transport = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body })
    if (endpoint === '/api/session/active') return { data: {} }
    const [, id, action] = endpoint.match(/^\/api\/session\/([^/]+)\/(\w+)$/) || []
    const session = fixture(id)
    if (action === 'message') return { data: session.messages }
    if (action === 'inbox') return { data: session.inbox }
    if (action === 'form') return { data: session.forms }
    if (action === 'interrupt') return null
    if (action === 'prompt') {
      assert.equal(body.delivery, 'queue')
      session.messages = [
        { id: 'new-reply', type: 'assistant', parentID: 'new-user', text: '42' },
        { id: 'new-user', type: 'user', text: body.text }, ...session.messages,
      ]
      return { data: { id: 'receipt-1', sessionID: id, delivery: 'queue' } }
    }
    throw new Error(`Unexpected request: ${method} ${endpoint}`)
  }
  let coordinator
  const adapter = new SuperAgentOpenCode(transport, (id, turn) => coordinator?.complete(id, turn, 'opencode'), { interval: 1, timeout: 200 })
  const store = new SuperAgentStore(root)
  let team = await store.create('Mixed team')
  for (let i = 0; i < 3; i++) team = await store.addSlot(team.id)
  const threads = {
    manager: { id: 'manager', directory: root },
    'worker-1': { id: 'codex-worker', directory: root },
    'worker-2': { id: 'ses_worker2', directory: root, provider: 'opencode' },
    'worker-3': { id: 'ses_unselected', directory: root, provider: 'opencode' },
  }
  for (const [slot, thread] of Object.entries(threads)) team = await store.bind(team.id, slot, async () => thread)
  await assert.rejects(store.bind(team.id, 'manager', async () => threads['worker-2']), /manager must use Codex/)
  assert.equal(superProvider((await new SuperAgentStore(root).get(team.id)).slots[0].thread), 'codex')
  const turn = id => id.startsWith('ses_') ? adapter.turn(id) : { active: id === 'manager', turnId: 'manager-turn' }
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const context = vm.createContext({
    superAgent: store, superProvider, superTurn: turn, superOpenCode: adapter,
    providerActivity: { require: async provider => { enabled.push(provider); if (context.disabled === provider) throw new Error('provider disabled') } },
    requireSuperOpenCodeThread: async thread => thread,
    requireRelayCodexThread: async id => ({ saved: { id, directory: root } }),
    codexBridge: { messageStarts: new Set() },
    ensureRelayCodexThreadLoaded: async () => {},
    consumeLicensedMessage: async input => { charges.push(input.threadId) },
    sendRelayCodexMessage: async id => { calls.push({ provider: 'codex', id }); return { turn: { id: 'codex-turn', status: 'completed' } } },
    superAgentKnowledge: async () => [], superAgentInstructions,
  })
  vm.runInContext(source.slice(source.indexOf('async function sendSuperAgentMessage('), source.indexOf('const superCoordinator =')), context)
  coordinator = new SuperAgentCoordinator(path.join(root, 'jobs'), {
    team: id => store.get(id), enabled: async () => {}, turn,
    send: (grant, target, messageId) => context.sendSuperAgentMessage(grant.teamId, target.slot.id, { threadId: target.slot.thread.id, text: target.text, messageId, attachments: [] }),
    reply: (id, turnId) => id.startsWith('ses_') ? adapter.replies.get(`${id}:${turnId}`) : '14',
  })
  const grant = coordinator.arm('manager', team.id, 'manager', 'mixed-request-001')
  coordinator.bind(grant, 'manager-turn')
  const params = { threadId: 'manager', turnId: 'manager-turn', tool: 'dispatch_tasks', callId: 'batch-1', arguments: { tasks: [{ slotId: 'worker-1', text: '5+9' }, { slotId: 'worker-2', text: '6*7' }] } }
  const results = await coordinator.tool(params)
  assert.deepEqual(results.map(result => result.reply), ['14', '42'])
  assert.ok(results.every(result => result.status === 'completed'))
  assert.equal(calls.filter(call => call.endpoint?.endsWith('/prompt')).length, 1)
  assert.equal(calls.filter(call => call.provider === 'codex').length, 1)
  assert.ok(!calls.some(call => call.endpoint?.includes('ses_unselected')))
  assert.deepEqual(charges.sort(), ['codex-worker', 'ses_worker2'])
  assert.ok(enabled.includes('codex') && enabled.includes('opencode'))
  await coordinator.tool(params)
  assert.equal(charges.length, 2, 'replayed batch must not charge or resend')
  assert.ok(coordinator.jobs.some(job => job.provider === 'opencode' && job.reply === '42'))

  context.disabled = 'opencode'
  await assert.rejects(context.sendSuperAgentMessage(team.id, 'worker-2', { threadId: 'ses_worker2', text: 'again', messageId: 'disabled-001' }), /disabled/)
  assert.equal(charges.length, 2)
  context.disabled = null
  fixture('ses_worker2').forms = [{ id: 'frm_question' }]
  await assert.rejects(adapter.prepare('ses_worker2'), /question/)
  fixture('ses_worker2').forms = []
  fixture('ses_worker2').inbox = [{ id: 'queued' }]
  await assert.rejects(adapter.prepare('ses_worker2'), /current OpenCode/)
  fixture('ses_worker2').inbox = []
  await adapter.stop('ses_worker2')
  assert.ok(calls.some(call => call.method === 'POST' && call.endpoint === '/api/session/ses_worker2/interrupt'))

  const rejected = new SuperAgentOpenCode(async (method, endpoint) => method === 'POST' ? { data: { id: 'bad', sessionID: 'wrong-session', delivery: 'queue' } } : { data: endpoint.endsWith('/active') ? {} : [] }, () => {}, { interval: 1, timeout: 20 })
  await assert.rejects(rejected.send('ses_wrong', 'test', { messages: [] }), /did not confirm/)
  assert.equal(rejected.turn('ses_wrong').active, false)
  const stale = new SuperAgentOpenCode(async () => ({ data: [] }), () => {}, { interval: 1, timeout: 8 })
  stale.read = async () => ({ active: false, inbox: [], forms: [], messages: [{ id: 'old', type: 'assistant', text: 'stale' }] })
  const pending = { id: 'timed', active: true }
  stale.turns.set('ses_stale', pending)
  await stale.monitor('ses_stale', pending, { messages: [{ id: 'old' }] }, 'task')
  assert.equal(stale.turn('ses_stale').status, 'tracking_unknown')
  assert.equal(stale.replies.size, 0, 'old answers must never complete a new task')
  let sessionModel = 'provider/old', modelWrites = 0, modelBusy = false, ignoreChange = false
  const modelContext = vm.createContext({
    superAgent: { sending: new Set() },
    HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
    modelSelectorToPayload: selector => selector.includes('/') ? { providerID: selector.split('/')[0], id: selector.split('/')[1] } : null,
    requireSuperOpenCodeThread: async () => ({ model: sessionModel }),
    superOpenCode: { prepare: async () => { if (modelBusy) throw new Error('desk busy') } },
    listOpenCodeModels: async () => [{ id: 'provider/new', tools: true }, { id: 'provider/no-tools', tools: false }],
    openCodeApi: async (method, endpoint, body) => { assert.equal(method, 'POST'); assert.equal(endpoint, '/api/session/ses_model/model'); modelWrites++; if (!ignoreChange) sessionModel = `${body.model.providerID}/${body.model.id}` },
  })
  vm.runInContext(source.slice(source.indexOf('async function setSuperOpenCodeModel('), source.indexOf('async function sendSuperAgentMessage(')), modelContext)
  assert.equal((await modelContext.setSuperOpenCodeModel({ id: 'ses_model' }, 'provider/new')).model, 'provider/new')
  assert.equal(sessionModel, 'provider/new')
  modelBusy = true
  await assert.rejects(modelContext.setSuperOpenCodeModel({ id: 'ses_model' }, 'provider/new'), /busy/)
  modelBusy = false
  await assert.rejects(modelContext.setSuperOpenCodeModel({ id: 'ses_model' }, 'provider/missing'), /not available/)
  await assert.rejects(modelContext.setSuperOpenCodeModel({ id: 'ses_model' }, 'provider/no-tools'), /supports tools/)
  assert.equal(modelWrites, 1, 'busy or invalid choices must not mutate the model')
  modelContext.superAgent.sending.add('ses_model')
  await assert.rejects(modelContext.setSuperOpenCodeModel({ id: 'ses_model' }, 'provider/new'), /already being sent/)
  modelContext.superAgent.sending.clear()
  sessionModel = 'provider/old'; ignoreChange = true
  await assert.rejects(modelContext.setSuperOpenCodeModel({ id: 'ses_model' }, 'provider/new'), /did not confirm/)
  assert.equal(modelContext.superAgent.sending.size, 0)
  console.log('Passed: actual desk model setter persists and confirms the selected session model; busy, concurrent, unavailable, tool-less and unconfirmed changes are rejected. No providers contacted.')
  console.log('Passed: real mixed-provider manager routing, exact destination, old-reply exclusion, provider/busy/question/license guards, receipts, replay protection, legacy persistence and OpenCode interrupt. Synthetic transports only; no AI calls.')
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
  assert.ok(path.basename(root).startsWith('openzero-mixed-desks-'))
  await rm(root, { recursive: true, force: true })
}
