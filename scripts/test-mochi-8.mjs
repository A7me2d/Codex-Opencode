import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMochiIntegration } from '../server/mochi/integration.mjs'
import { validateMochiSnapshot } from '../src/features/mochi/types.ts'
import { resetActionInterlocks, applyMochiProposal } from '../server/mochi/actions.mjs'

// Actual modules wired together, fake I/O only: never starts the application,
// sends a worker message, contacts a model or reads the operator's state.
const cases = []
const check = (name, run) => cases.push([name, run])
const defaultForm = () => ({ id: 'frm_One', title: 'Choose the output language', fields: [{ key: 'language', title: 'Language', options: [{ value: 'English' }, { value: 'Arabic' }] }] })
async function fixture() {
  resetActionInterlocks()
  const directory = await mkdtemp(path.join(tmpdir(), 'mochi-integration-'))
  const state = { forms: [defaultForm()], permissions: [], enabled: true, licensed: true, busy: false, modelReply: { decision: 'answer_question', answer: { language: 'English' }, reason: 'English was selected for the output.' }, calls: [], consumed: 0, sends: [], jobs: [], team: { id: 'team-one', archived: false, slots: [{ id: 'manager', thread: { id: 'manager-thread', provider: 'codex' } }, { id: 'worker-1', thread: { id: 'desk-one', provider: 'opencode' } }] } }
  const deps = {
    stateDirectory: directory,
    superAgent: { list: async () => [state.team], get: async id => { assert.equal(id, state.team.id); return structuredClone(state.team) } },
    providerActivity: { enabled: provider => state.enabled && state.providerEnabled?.[provider] !== false, require: async provider => { (state.requiredProviders ||= []).push(provider); if (!state.enabled || state.providerEnabled?.[provider] === false) throw new Error('provider disabled') } },
    license: { check: async () => state.licensed, consume: async () => { if (!state.licensed) throw new Error('license disabled'); state.consumed++ } },
    listOpenCodeModels: async () => [{ id: 'test/zero-cost-unconfirmed', tools: false }],
    listClineModels: async provider => [{ id: provider + '/model', name: 'Synthetic Cline model' }, { id: provider + '/second', name: 'Synthetic second model' }],
    clineText: {
      availability: async () => ({ available: state.clineAvailable !== false, toolFree: state.clineAvailable !== false, stateless: true, dedicatedContext: true, reason: state.clineAvailable === false ? 'Synthetic Cline unavailable' : null }),
      generate: async input => {
        (state.clineCalls ||= []).push(input)
        if (state.onClineGenerate) await state.onClineGenerate()
        if (state.clineFails) throw new Error('Synthetic Cline failure')
        return { text: JSON.stringify(state.modelReply) }
      },
    },
    superCoordinator: { jobs: state.jobs },
    guards: { requireSuperOpenCodeThread: async () => { if (state.busy) throw new Error('binding unavailable') } },
    superOpenCode: { prepare: async () => { if (state.busy || state.forms.length || state.permissions.length) throw new Error('desk busy or waiting') } },
    sendMessage: async (...args) => { state.sends.push(args); return { turn: { id: 'continued-turn', status: 'running' } } },
    openCodeApi: async (method, url, body) => {
      state.calls.push({ method, url, body })
      if (url === '/api/experimental/generate') {
        assert.equal(method, 'POST'); assert.deepEqual(Object.keys(body).sort(), ['model', 'prompt'])
        assert.deepEqual(body.model, { providerID: 'test', id: 'zero-cost-unconfirmed' })
        if (state.onGenerate) await state.onGenerate()
        if (state.generationFails) throw new Error('stateless generation unavailable')
        return { data: { text: JSON.stringify(state.modelReply) } }
      }
      if (method === 'POST' && url.endsWith('/reply')) { if (state.replyFails) throw new Error('reply outcome uncertain'); state.forms = []; return undefined } // documented 204
      if (method === 'GET' && url.endsWith('/form')) return { data: structuredClone(state.forms) }
      if (method === 'GET' && url.endsWith('/permission')) return { data: structuredClone(state.permissions) }
      throw new Error(`unexpected network route ${method} ${url}`)
    },
  }
  let mochi = await createMochiIntegration(deps)
  const enable = () => mochi.configure(state.team.id, { enabled: true, model: 'test/zero-cost-unconfirmed' })
  const pending = async () => (await mochi.snapshot(state.team.id)).proposals.find(item => item.status === 'pending')
  const tick = () => mochi.tick(state.team.id)
  const approve = async () => mochi.resolve(state.team.id, (await pending()).id, 'approve')
  const restart = async () => { mochi.stop(); await mochi.flush(); resetActionInterlocks(); mochi = await createMochiIntegration(deps); return mochi }
  const replies = () => state.calls.filter(item => item.method === 'POST' && item.url.endsWith('/reply'))
  return { state, deps, directory, enable, pending, tick, approve, restart, replies, get mochi() { return mochi }, cleanup: async () => { mochi.stop(); await mochi.flush(); await rm(directory, { recursive: true, force: true }) } }
}
const isolated = run => async () => { const f = await fixture(); try { await run(f) } finally { await f.cleanup() } }
check('defaults and GET are read only, disabled tick makes no provider calls', isolated(async f => {
  const first = await f.mochi.snapshot('team-one'); assert(validateMochiSnapshot(first)); assert.equal(first.runtime.state, 'disabled')
  await f.tick(); await f.mochi.snapshot('team-one'); assert.deepEqual(f.state.calls, []); assert.deepEqual(await readdir(f.directory), [])
}))
check('suggestion crosses store/runtime/model/wire; operator answer is exact and once only', isolated(async f => {
  await f.enable(); await f.tick(); const proposal = await f.pending(); assert.equal(proposal.sourceId, 'frm_One'); assert.equal(proposal.kind, 'answer_question')
  assert.equal(f.replies().length, 0); assert(validateMochiSnapshot(await f.mochi.snapshot('team-one')))
  await Promise.all([f.mochi.resolve('team-one', proposal.id, 'approve'), f.mochi.resolve('team-one', proposal.id, 'approve')])
  assert.equal(f.replies().length, 1); assert.deepEqual(f.replies()[0].body, { answer: { language: 'English' } })
  assert.equal((await f.mochi.snapshot('team-one')).proposals[0].status, 'applied')
  const count = f.state.calls.length; await f.tick(); assert.equal(f.state.calls.filter(x => x.url.includes('/generate')).length, 1); assert(f.state.calls.length >= count)
  assert(f.state.calls.every(x => !x.url.endsWith('/prompt') && x.url !== '/api/session'))
}))
check('partial configuration retains model; automatic can always be stopped', isolated(async f => {
  await f.enable(); const next = await f.mochi.configure('team-one', { mode: 'automatic', autoAnswer: true }); assert.equal(next.config.model, 'test/zero-cost-unconfirmed')
  const stopped = await f.mochi.configure('team-one', { enabled: false }); assert.equal(stopped.runtime.state, 'disabled'); assert.equal(stopped.config.mode, 'suggest')
  const count = f.state.calls.length; await f.tick(); assert.equal(f.state.calls.length, count)
}))
check('automatic answer uses guarded action, no model calls on later polling', isolated(async f => {
  await f.enable(); await f.mochi.configure('team-one', { mode: 'automatic', autoAnswer: true }); await f.tick()
  assert.equal(f.replies().length, 1); assert.equal((await f.mochi.snapshot('team-one')).proposals[0].status, 'applied')
  for (let i = 0; i < 3; i++) await f.mochi.snapshot('team-one')
  assert.equal(f.state.calls.filter(x => x.url.includes('/generate')).length, 1)
}))
check('fresh source mismatch or removed form cannot apply', isolated(async f => {
  await f.enable(); await f.tick(); f.state.forms[0].fields[0].options = [{ value: 'French' }]
  const next = await f.approve(); assert.equal(next.proposals[0].status, 'blocked'); assert.equal(f.replies().length, 0)
}))
check('changed desk binding cannot act on another conversation', isolated(async f => {
  await f.enable(); await f.tick(); f.state.team.slots[1].thread.id = 'different-thread'; await f.approve(); assert.equal(f.replies().length, 0)
}))
check('disabled provider blocks inference and approval', isolated(async f => {
  await f.enable(); await f.tick(); f.state.enabled = false; await f.approve(); assert.equal(f.replies().length, 0)
  const count = f.state.calls.length; await f.tick(); assert.equal(f.state.calls.length, count)
}))
check('expired license blocks approvals without charge or reply', isolated(async f => {
  await f.enable(); await f.tick(); f.state.licensed = false; const used = f.state.consumed; await f.approve(); assert.equal(f.state.consumed, used); assert.equal(f.replies().length, 0)
}))
check('disable while the model is pending prevents automatic execution', isolated(async f => {
  await f.enable(); await f.mochi.configure('team-one', { mode: 'automatic', autoAnswer: true })
  f.state.onGenerate = () => f.mochi.configure('team-one', { enabled: false })
  await f.tick(); assert.equal(f.replies().length, 0); assert.equal((await f.mochi.snapshot('team-one')).runtime.state, 'disabled')
}))
check('unsupported text generation escalates honestly with no agent fallback or retries', isolated(async f => {
  await f.enable(); f.state.generationFails = true; await f.tick(); await f.tick()
  const proposal = await f.pending(); assert.equal(proposal.kind, 'escalate'); assert.match(proposal.reason, /unavailable/)
  assert.equal(f.state.calls.filter(x => x.url.includes('/generate')).length, 1)
}))
check('tool permissions remain operator escalations, never model or approval calls', isolated(async f => {
  f.state.forms = []; f.state.permissions = [{ id: 'permission-one', title: 'Run shell' }]; await f.enable(); await f.tick()
  assert.equal((await f.pending()).kind, 'escalate'); assert.equal(f.state.consumed, 0); await f.approve(); assert.equal(f.state.calls.filter(x => x.method === 'POST').length, 0)
}))
check('free text and fallback q0 keys match the Agent question reader', isolated(async f => {
  f.state.forms = [{ id: 'frm_Text', title: 'Output title?', questions: [{ title: 'Title', type: 'string' }] }]
  f.state.modelReply.answer = { q0: 'Summary' }; await f.enable(); await f.tick(); assert.equal((await f.pending()).kind, 'answer_question'); await f.approve(); assert.deepEqual(f.replies()[0].body.answer, { q0: 'Summary' })
}))
check('real failed task continues once with a bounded prompt and a new message ID', isolated(async f => {
  f.state.forms = []; f.state.jobs.push({ id: 'job-one', teamId: 'team-one', slotId: 'worker-1', threadId: 'desk-one', requestId: 'original-request-id', status: 'failed', error: 'provider connection ended', text: 'ORIGINAL MUST NOT REPLAY' })
  await f.enable(); await f.tick(); const proposal = await f.pending(); assert.equal(proposal.kind, 'resume_task')
  await f.approve(); assert.equal(f.state.sends.length, 1); const input = f.state.sends[0][2]
  assert(!input.text.includes('ORIGINAL')); assert.notEqual(input.messageId, 'original-request-id')
  const restored = await f.restart(); await restored.resolve('team-one', proposal.id, 'approve'); await restored.tick('team-one'); assert.equal(f.state.sends.length, 1)
}))
check('still busy failed task is not resumed', isolated(async f => {
  f.state.forms = []; f.state.jobs.push({ id: 'job-one', teamId: 'team-one', slotId: 'worker-1', threadId: 'desk-one', status: 'failed', error: 'disconnected' })
  await f.enable(); await f.tick(); f.state.busy = true; await f.approve(); assert.equal(f.state.sends.length, 0)
}))
check('lost tracking never resumes even after a long wait', isolated(async f => {
  f.state.forms = []; f.state.jobs.push({ id: 'job-one', teamId: 'team-one', slotId: 'worker-1', threadId: 'desk-one', status: 'tracking_unknown', error: 'tracking lost' })
  await f.enable(); await f.tick(); assert.equal((await f.pending()).kind, 'escalate'); await f.approve(); assert.equal(f.state.sends.length, 0)
}))
check('uncertain reply outcome is durably blocked, never replayed after restart', isolated(async f => {
  await f.enable(); await f.tick(); const proposal = await f.pending(); f.state.replyFails = true; await f.approve(); assert.equal(f.replies().length, 1)
  const restored = await f.restart(); await restored.resolve('team-one', proposal.id, 'approve'); await restored.tick('team-one'); assert.equal(f.replies().length, 1)
  assert.equal((await restored.snapshot('team-one')).proposals[0].status, 'blocked')
}))
check('unsupported automatic capabilities cannot be enabled', isolated(async f => {
  await f.enable(); await assert.rejects(f.mochi.configure('team-one', { autoApproveTools: true })); await assert.rejects(f.mochi.configure('team-one', { autoResume: true }))
}))

check('a pending proposal retains source identity after restart and can be approved once', isolated(async f => {
  await f.enable(); await f.tick(); const proposal = await f.pending()
  const restored = await f.restart()
  const snapshot = await restored.snapshot('team-one')
  assert(validateMochiSnapshot(snapshot)); assert.equal(snapshot.proposals[0].sourceId, proposal.sourceId)
  await restored.resolve('team-one', proposal.id, 'approve'); assert.equal(f.replies().length, 1)
}))
check('sensitive form text is not persisted or sent to the model', isolated(async f => {
  f.state.forms[0].title = 'The password = example-secret-value is required'
  await f.enable(); await f.tick()
  assert.equal(f.state.calls.filter(x => x.url.includes('/generate')).length, 0)
  const [file] = await readdir(path.join(f.directory, 'mochi'))
  const raw = await readFile(path.join(f.directory, 'mochi', file), 'utf8')
  assert(!raw.includes('example-secret-value'))
}))
check('Cline brain answers through its own text transport and catalog only', isolated(async f => {
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineProvider: 'cline', clineModel: 'cline/model' })
  await f.mochi.configure('team-one', { enabled: true }); await f.tick()
  assert.equal(f.state.clineCalls.length, 1); assert.equal(f.state.clineCalls[0].provider, 'cline'); assert.equal(f.state.clineCalls[0].model, 'cline/model')
  assert.equal(f.state.calls.filter(x => x.url.includes('/generate')).length, 0)
  await f.approve(); assert.equal(f.replies().length, 1)
}))
check('Cline can be configured and enabled while OpenCode is disabled', isolated(async f => {
  f.state.providerEnabled = { opencode: false }
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'cline/model' })
  const snapshot = await f.mochi.configure('team-one', { enabled: true })
  assert.equal(snapshot.brain.available, true); assert(!f.state.requiredProviders.includes('opencode'))
  await f.tick(); assert.equal(f.state.calls.length, 0, 'disabled OpenCode desk is skipped')
}))
check('another Cline account uses that account catalog and not the OpenCode selector', isolated(async f => {
  await assert.rejects(f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'test/zero-cost-unconfirmed' }))
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineProvider: 'openrouter', clineModel: 'openrouter/model' })
  await f.mochi.configure('team-one', { enabled: true }); await f.tick()
  assert.equal(f.state.clineCalls[0].provider, 'openrouter')
}))
check('missing Cline capability cannot be enabled and never invokes inference', isolated(async f => {
  f.state.clineAvailable = false
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'cline/model' })
  await assert.rejects(f.mochi.configure('team-one', { enabled: true }), /unavailable/)
  assert.equal((f.state.clineCalls || []).length, 0)
}))
check('changing the Cline model during inference blocks the old answer', isolated(async f => {
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'cline/model' })
  await f.mochi.configure('team-one', { enabled: true, mode: 'automatic', autoAnswer: true })
  f.state.onClineGenerate = () => f.mochi.configure('team-one', { clineModel: 'cline/second' })
  await f.tick(); assert.equal(f.replies().length, 0); assert.equal((await f.pending()).kind, 'escalate')
  await f.tick(); assert.equal(f.state.clineCalls.length, 1, 'same event is not resent to the new model')
}))
check('switching away and back while waiting still invalidates an old Cline decision', isolated(async f => {
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'cline/model' })
  await f.mochi.configure('team-one', { enabled: true, mode: 'automatic', autoAnswer: true })
  f.state.onClineGenerate = async () => {
    await f.mochi.configure('team-one', { enabled: false })
    await f.mochi.configure('team-one', { brainProvider: 'opencode' })
    await f.mochi.configure('team-one', { brainProvider: 'cline' })
    await f.mochi.configure('team-one', { enabled: true, mode: 'automatic' })
  }
  await f.tick(); assert.equal(f.replies().length, 0); assert.equal((await f.pending()).kind, 'escalate')
}))
check('a stored pending Cline answer cannot apply after a later model change', isolated(async f => {
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'cline/model' })
  await f.mochi.configure('team-one', { enabled: true }); await f.tick()
  await f.mochi.configure('team-one', { clineModel: 'cline/second' })
  const restored = await f.restart(); const proposal = await f.pending()
  await restored.resolve('team-one', proposal.id, 'approve'); assert.equal(f.replies().length, 0)
}))
check('Cline failures escalate once without consuming twice or falling back to OpenCode', isolated(async f => {
  await f.mochi.configure('team-one', { brainProvider: 'cline', clineModel: 'cline/model' })
  await f.mochi.configure('team-one', { enabled: true }); f.state.clineFails = true
  await f.tick(); await f.tick(); assert.equal((await f.pending()).kind, 'escalate')
  assert.equal(f.state.consumed, 1); assert.equal(f.state.clineCalls.length, 1)
  assert.equal(f.state.calls.filter(x => x.url.includes('/generate')).length, 0)
}))
check('old persisted teams migrate to OpenCode without enabling or losing their model', isolated(async f => {
  await f.mochi.configure('team-one', { model: 'test/zero-cost-unconfirmed' })
  const directory = path.join(f.directory, 'mochi'); const [file] = await readdir(directory)
  const stored = JSON.parse(await readFile(path.join(directory, file), 'utf8'))
  for (const key of ['brainProvider', 'clineProvider', 'clineModel']) delete stored.config[key]
  delete stored.brainRevision
  await writeFile(path.join(directory, file), JSON.stringify(stored))
  const restored = await f.restart(); const snapshot = await restored.snapshot('team-one')
  assert.equal(snapshot.config.brainProvider, 'opencode'); assert.equal(snapshot.config.clineProvider, 'cline')
  assert.equal(snapshot.config.model, 'test/zero-cost-unconfirmed'); assert.equal(snapshot.config.enabled, false)
  assert.equal(snapshot.config.mode, 'suggest'); assert(validateMochiSnapshot(snapshot))
}))
let passed = 0
for (const [name, run] of cases) { await run(); passed++; console.log(`PASS ${name}`) }
console.log(`Mochi integration: ${passed}/${cases.length} passed; synthetic I/O only, no build or real AI requests.`)
