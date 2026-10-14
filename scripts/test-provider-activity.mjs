import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ProviderActivity, requestProvider } from '../server/provider-activity.mjs'
import { ClineWorkflow } from '../server/cline-workflow.mjs'
import { ClineBridge } from '../server/cline-bridge.mjs'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const directory = await mkdtemp(path.join(tmpdir(), 'openzero-activity-test-'))
try {
  const activity = new ProviderActivity(directory)
  await activity.ready
  const stopped = []
  await Promise.all(['codex', 'opencode', 'cline'].map(id => activity.set(id, false, { afterDisable: async () => stopped.push(id) })))
  assert.deepEqual(activity.snapshot().providers, { codex: false, opencode: false, cline: false })
  assert.equal(stopped.length, 3, 'serialized changes preserve all provider flags')
  for (const id of stopped) await assert.rejects(activity.require(id), /disabled/)
  const restored = new ProviderActivity(directory)
  await restored.ready
  assert.deepEqual(restored.snapshot(), activity.snapshot(), 'disabled providers remain disabled after restart')
  await activity.set('cline', true)
  await activity.require('cline')
  await assert.rejects(activity.set('cline', false, { beforeDisable: async () => { throw new Error('active task') } }), /active task/)
  assert.equal(activity.enabled('cline'), true, 'rejecting a busy provider does not change its state')
  await assert.rejects(activity.set('unknown', false), /valid provider/)
  for (const [route, id] of [['/api/cline/models', 'cline'], ['/api/codex/threads/thread-test/messages', 'codex'], ['/api/source-control/commit-message', 'codex'], ['/api/models', 'opencode'], ['/api/codex/threads/thread-test/opencode/messages', 'opencode'], ['/api/sessions/ses_test/forms/form_test/reply', 'opencode'], ['/api/codex/weekly-quota', 'codex']]) {
    assert.equal(requestProvider(route), id)
    if (id !== 'cline') await assert.rejects(activity.require(requestProvider(route)), /disabled/, 'disabled requests are rejected before licensing or dispatch')
  }
  for (const route of ['/api/provider-activity', '/api/codex/threads', '/api/workflow', '/api/workflow/threads/workflow-test', '/api/project']) assert.equal(requestProvider(route), null)
  let charged = 0, dispatched = 0
  const thread = { id: 'synthetic', workflow: { planner: 'cline', executor: 'codex' } }
  const workflow = new ClineWorkflow({ cline: {}, getThread: async () => thread, patchThread: async () => {},
    getExternalRole: async () => ({ active: false, messages: [] }), sendExternalRole: async () => { dispatched++ }, requireEnabled: id => activity.require(id) })
  workflow.read = async () => ({ thread, planner: { active: false, messages: [{ id: 'plan', role: 'assistant', text: 'Synthetic plan' }] }, executor: { active: false, messages: [] } })
  await assert.rejects(workflow.action(thread.id, 'execute', { messageId: 'synthetic-request-01' }, async () => { charged++ }), /disabled/)
  assert.equal(charged, 0); assert.equal(dispatched, 0)
  await activity.set('cline', false)
  let contacts = 0
  const cline = new ClineBridge(directory, { requireEnabled: () => activity.require('cline'), resolveExecutable: () => { contacts++; return 'synthetic.exe' }, launch: () => { contacts++; throw new Error('unexpected spawn') } })
  await assert.rejects(cline.create(directory, 'cline'), /disabled/)
  await assert.rejects(cline.models('cline'), /disabled/)
  assert.equal(contacts, 0, 'a disabled Cline never resolves/launches its executable or loads its network catalog')
  const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const context = vm.createContext({ providerActivity: activity, invokeOpenCode: async () => { contacts++; return '{}' },
    resolveCodexExecutable: () => { contacts++; return 'synthetic.exe' }, spawn: () => { contacts++; throw new Error('unexpected spawn') } })
  vm.runInContext(source.slice(source.indexOf('class CodexAppServerBridge {'), source.indexOf('\nconst codexBridge =')), context)
  const codex = vm.runInContext('new CodexAppServerBridge({ requireEnabled: () => providerActivity.require("codex") })', context)
  await assert.rejects(codex.ensureStarted(), /disabled/)
  vm.runInContext(source.slice(source.indexOf('async function openCodeApi('), source.indexOf('\nfunction codexExecutableCandidates(')), context)
  await assert.rejects(context.openCodeApi('GET', '/api/session'), /disabled/)
  assert.equal(contacts, 0, 'disabled Codex/OpenCode stop at the bridge guard without spawning/contacting providers')
  console.log('Passed: persisted provider switches, serialized updates, busy-task protection, disabled route preflight, and disabled workflow actions blocked before charging or dispatch. No providers were contacted.')
} finally {
  if (path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) && path.basename(directory).startsWith('openzero-activity-test-')) await rm(directory, { recursive: true, force: true })
}
