// Isolated checks for the Super Agent desk status list: honest idle/working/
// waiting/unknown/paused/unassigned separation, stale-binding and terminal-job
// immunity, one shared aggregate build, and exactly one OpenCode global read
// per cache window even with eight desks. No AI, no build, no app data touched.
import assert from 'node:assert/strict'
import { SuperDeskStatus } from '../server/super-agent-status.mjs'
import { SuperAgentOpenCode } from '../server/super-agent-opencode.mjs'

const threadOf = provider => provider ? { id: provider === 'opencode' ? 'ses_1' : provider === 'cline' ? 'cl_1' : 'codex_1', provider } : null
const desk = (id, provider, label = '') => ({ id, label, thread: threadOf(provider) })
const pick = (desks, id) => desks.find(entry => entry.id === id)

function buildSuite({ jobs = [], providerState = {}, deps = {} } = {}) {
  const status = new SuperDeskStatus({
    getTeam: async () => ({ slots: providerState.slots ?? [desk('manager', 'codex'), desk('worker-1', providerState.desk1 ?? 'codex'), desk('worker-2', null)] }),
    jobs: () => jobs.map(job => ({ managerThreadId: 'codex_1', ...job })),
    activity: { snapshot: () => ({ providers: { codex: providerState.codex ?? true, opencode: providerState.opencode ?? true, cline: providerState.cline ?? true } }) },
    openCodeStatus: async id => {
      if (providerState.openCodeThrows) throw new Error('offline')
      const turn = providerState.openCodeTurns?.[id] ?? {}
      return { active: Boolean(turn.externalActive) || Boolean(turn.turnActive), externalActive: Boolean(turn.externalActive), waitingInput: Boolean(turn.waitingInput), status: turn.status ?? null, error: null }
    },
    clineStatus: async id => {
      if (providerState.clineThrows) throw new Error('bridge lost')
      return { active: Boolean(providerState.clineActive?.[id]), waitingPermission: Boolean(providerState.clinePermission?.[id]), error: null }
    },
    codexTurn: id => providerState.codexActive?.[id] ? { active: true, stopping: false } : { active: false },
    ...deps,
  })
  return status
}

// A bound Codex desk with no provider or task evidence is truthfully empty.
assert.equal(pick(await buildSuite().snapshot('team').then(data => data.desks), 'worker-1')?.status, 'idle')

// An unbound desk stays clearly unassigned; the manager row is present and honest.
{
  const desks = await buildSuite().snapshot('team').then(data => data.desks)
  assert.equal(pick(desks, 'worker-2')?.status, 'unassigned')
  assert.equal(pick(desks, 'manager')?.status, 'idle')
  assert.equal(pick(desks, 'manager')?.provider, 'codex')
}

// Live provider/turn evidence concentrates the truth.
assert.equal(pick(await buildSuite({ providerState: { codexActive: { codex_1: true } } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'working')
assert.equal(pick(await buildSuite({ providerState: { desk1: 'opencode', openCodeTurns: { ses_1: { externalActive: true } } } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'working')
assert.equal(pick(await buildSuite({ providerState: { desk1: 'cline', clineActive: { cl_1: true } } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'working')

// A queued/running job under the desk's exact current binding counts as work.
assert.equal(pick(await buildSuite({ jobs: [{ teamId: 'team', slotId: 'worker-1', threadId: 'codex_1', status: 'queued' }] }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'working')

// Stale binding: a job left under a different conversation never makes this desk busy.
assert.equal(pick(await buildSuite({ jobs: [{ teamId: 'team', slotId: 'worker-1', threadId: 'old_thread', status: 'running' }] }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'idle')

// Terminal jobs never dominate; an old completed task keeps the desk empty.
assert.equal(pick(await buildSuite({ jobs: [{ teamId: 'team', slotId: 'worker-1', threadId: 'codex_1', status: 'completed' }] }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'idle')

// Waiting evidence: OpenCode question, coordinator waiting_input, and a Cline permission.
assert.equal(pick(await buildSuite({ providerState: { desk1: 'opencode', openCodeTurns: { ses_1: { waitingInput: true, status: 'waiting_input' } } } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'waiting')
assert.equal(pick(await buildSuite({ jobs: [{ teamId: 'team', slotId: 'worker-1', threadId: 'ses_1', status: 'waiting_input' }], providerState: { desk1: 'opencode' } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'waiting')
assert.equal(pick(await buildSuite({ jobs: [{ teamId: 'team', slotId: 'worker-1', threadId: 'old_binding', status: 'waiting_input' }], providerState: { desk1: 'opencode' } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'idle')
assert.equal(pick(await buildSuite({ providerState: { desk1: 'cline', clinePermission: { cl_1: true } } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'waiting')

// A failed provider read is unknown, never a quiet empty.
assert.equal(pick(await buildSuite({ providerState: { desk1: 'opencode', openCodeThrows: true } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'unknown')
assert.equal(pick(await buildSuite({ providerState: { desk1: 'opencode', openCodeTurns: { ses_1: { status: 'tracking_unknown' } } } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'unknown')
assert.equal(pick(await buildSuite({ jobs: [{ teamId: 'team', managerThreadId: 'old_manager', slotId: 'worker-1', threadId: 'ses_1', status: 'waiting_input' }], providerState: { desk1: 'opencode' } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'idle', 'old manager jobs never create a pending question')
assert.equal(pick(await buildSuite({ providerState: { desk1: 'cline', clineThrows: true } }).snapshot('team').then(data => data.desks), 'worker-1')?.status, 'unknown')

// A disabled connector is paused, and the provider read was never attempted.
{
  const suite = buildSuite({ providerState: { desk1: 'opencode', opencode: false } })
  assert.equal(pick(await suite.snapshot('team').then(data => data.desks), 'worker-1')?.status, 'paused')
}

// Concurrent snapshots share one build: getTeam, jobs and reads run once.
{
  let builds = 0
  const suite = buildSuite({ deps: { getTeam: async () => { builds += 1; return { slots: [desk('manager', 'codex'), desk('worker-1', null)] } } } })
  const [first, second] = await Promise.all([suite.snapshot('team'), suite.snapshot('team')])
  assert.equal(builds, 1)
  assert.deepEqual(first.desks, second.desks)
}

// One OpenCode global active read per cache window for a whole team of eight desks.
{
  let activeCalls = 0
  const api = async (method, url) => {
    if (method === 'GET' && url === '/api/session/active') { activeCalls += 1; return { data: { ses_1: true } } }
    throw new Error(`unexpected call ${method} ${url}`)
  }
  const opencode = new SuperAgentOpenCode(api, () => {})
  let builds = 0
  const suite = buildSuite({
    deps: {
      getTeam: async () => {
        builds += 1
        return { slots: [desk('manager', 'codex'), ...Array.from({ length: 8 }, (_, index) => desk(`worker-${index + 1}`, 'opencode')), desk('worker-9', null)] }
      },
      openCodeStatus: id => opencode.status(id),
    },
  })
  const first = await suite.snapshot('team')
  assert.equal(builds, 1)
  assert.equal(first.desks.filter(entry => entry.status === 'working').length, 8)
  await suite.snapshot('team')
  await suite.snapshot('team')
  assert.equal(activeCalls, 1, 'OpenCode global active read stays at one per aggregate window')
}

// A failed build clears the cache, so the next poll retries at once.
{
  let attempts = 0
  const suite = buildSuite({
    deps: { getTeam: async () => { attempts += 1; if (attempts < 2) throw new Error('transient'); return { slots: [desk('manager', null)] } } },
  })
  await assert.rejects(() => suite.snapshot('team'), /transient/)
  const retry = await suite.snapshot('team').then(data => data.desks)
  assert.equal(retry.at(0).status, 'unassigned')
  assert.equal(attempts, 2)
}

console.log('Passed: honest desk statuses (idle/working/waiting/unknown/paused/unassigned), stale-binding and terminal-job immunity, one shared aggregate build, and one OpenCode global read per window for eight desks. No AI, no build, no application data touched.')
