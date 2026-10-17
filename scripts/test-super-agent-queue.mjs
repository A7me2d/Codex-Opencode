import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Independent regression checks for the Super Agent dispatch queue.
 *
 * The single defect under test: a batch the manager already handed to the `dispatch_tasks` tool
 * (every target validated while its turn was current) used to lose the tasks that were still
 * queued behind the concurrency limit of two as soon as the manager turn ended naturally, with
 * "Manager stopped. This queued task was not sent." — even though the user never cancelled it.
 *
 * The checks exercise the real coordinator through its public surface only (arm/bind/complete/
 * current/tool plus its observable bookkeeping: jobs, reserved, active, waiters, results) against
 * a fully synthetic, in-memory environment. There is no network, no provider, no license service,
 * no browser and no AI call, and the checks never re-implement the coordinator or skip a failure.
 *
 * Run the production source (default):
 *   node scripts/test-super-agent-queue.mjs
 *
 * Run the same scenarios against the candidate by importing it explicitly and calling
 * `runQueueChecks` (the one-off command is documented in queue-handoff.md):
 *   node --input-type=module -e "import { runQueueChecks } from './scripts/test-super-agent-queue.mjs'; import { SuperAgentCoordinator as Candidate } from './.relay-state/reviews/opencode-tracking-FS6ENy/revision-2/super-agent-coordinator.mjs'; const r = await runQueueChecks(Candidate, { label: 'candidate' }); process.exit(r.failed ? 1 : 0)"
 */

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitFor(predicate, label, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await delay(4)
  }
}

/** One isolated coordinator with a synthetic team; every dispatch limit lives in one place. */
async function makeEnv(Coordinator, { slots = 4, holdMs = 120, onSend } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'openzero-queue-'))
  const team = {
    id: 'team-queue', archived: false,
    slots: [
      { id: 'manager', thread: { id: 'manager-thread', directory: root, provider: 'codex' } },
      ...Array.from({ length: slots }, (_, index) => ({ id: `worker-${index + 1}`, thread: { id: `worker-${index + 1}-thread`, directory: root, provider: index % 2 ? 'opencode' : 'cline' } })),
    ],
  }
  let managerTurn = { active: true, turnId: 'manager-turn-1' }
  const workerTurns = new Map()
  const sends = []
  const replies = new Map()
  let enabledBlocked = false
  let enabledCalls = 0
  let enabledFailAfter = Infinity
  let enabledWait = async () => {}
  let coordinator

  const deps = {
    team: async () => structuredClone(team),
    enabled: async () => { enabledCalls += 1; await enabledWait(); if (enabledBlocked || enabledCalls > enabledFailAfter) throw new Error('The provider is disabled or unlicensed.') },
    memory: { propose: async () => ({ proposed: true }) },
    recall: () => [],
    turn: (id, _provider = 'codex') => id === 'manager-thread' ? managerTurn : (workerTurns.get(id) || { active: false }),
    send: async (grant, target, messageId) => {
      if (onSend) await onSend({ grant, target, messageId })
      const thread = target.slot.thread
      const turnId = `${thread.id}:${messageId}`
      const record = { active: true, turnId }
      workerTurns.set(thread.id, record)
      sends.push({ slotId: target.slot.id, threadId: thread.id, provider: thread.provider || 'codex', messageId })
      await delay(holdMs)
      record.active = false
      replies.set(`${thread.id}:${turnId}`, `reply from ${target.slot.id}`)
      return { turn: { id: turnId, status: 'completed' } }
    },
    reply: async (threadId, turnId) => replies.get(`${threadId}:${turnId}`) || '',
  }

  coordinator = new Coordinator(root, deps)
  await coordinator.ready

  return {
    root, team, deps, coordinator, workerTurns, sends,
    setManagerTurn: next => { managerTurn = next },
    completeManager: status => coordinator.complete('manager-thread', { id: 'manager-turn-1', status }),
    setEnabledBlocked: value => { enabledBlocked = value },
    setEnabledFailAfter: value => { enabledFailAfter = value },
    setEnabledWait: fn => { enabledWait = fn },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

const threadIdOf = slotId => slotId === 'manager' ? 'manager-thread' : `${slotId}-thread`

function armManager(env, messageId = 'user-message-1', turnId = 'manager-turn-1') {
  const grant = env.coordinator.arm('manager-thread', env.team.id, 'manager', messageId)
  env.coordinator.bind(grant, turnId)
  return grant
}

function batchParams(slotIds, { callId = 'call-1', turnId = 'manager-turn-1' } = {}) {
  return {
    tool: 'dispatch_tasks', threadId: 'manager-thread', turnId, callId,
    arguments: { tasks: slotIds.map((slotId, index) => ({ slotId, text: `task ${index + 1}` })) },
  }
}

export async function runQueueChecks(Coordinator, { label = 'coordinator', log = console.log } = {}) {
  const checks = []
  const check = async (name, run) => {
    try { await run(); checks.push({ name, ok: true }) }
    catch (error) { checks.push({ name, ok: false, error: error.message }) }
  }

  // A naturally completed manager turn releases the tasks that were still queued behind the
  // concurrency cap of two, and only those tasks; the batch finishes in full.
  await check('natural manager completion releases the queued tasks while two run at a time', async () => {
    const env = await makeEnv(Coordinator)
    try {
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3', 'worker-4']))
      await waitFor(() => env.sends.length === 2, 'two in-flight sends')
      assert.equal(env.coordinator.active, 2, 'concurrency is capped at two')
      assert.equal(env.coordinator.jobs.filter(job => ['dispatching', 'running'].includes(job.status)).length, 2, 'two tasks are running')
      assert.equal(env.coordinator.jobs.filter(job => job.status === 'queued').length, 2, 'two tasks are queued')
      env.setManagerTurn({ active: false })
      env.completeManager('completed')
      const results = await pending
      assert.equal(env.sends.length, 4, 'the queued tasks were sent after the natural completion')
      assert.deepEqual(results.map(result => result.status), ['completed', 'completed', 'completed', 'completed'])
      assert.ok(env.coordinator.jobs.every(job => job.status === 'completed'), 'every queued task finished')
    } finally { await env.cleanup() }
  })

  // An explicit stop is not a completion: nothing that was not already sent may be sent.
  for (const status of ['interrupted', 'failed']) {
    await check(`a manager turn that ended as ${status} keeps the queued tasks unsent`, async () => {
      const env = await makeEnv(Coordinator)
      try {
        armManager(env)
        const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3']))
        await waitFor(() => env.sends.length === 2, 'two in-flight sends')
        env.setManagerTurn({ active: false })
        env.completeManager(status)
        const results = await pending
        assert.equal(env.sends.length, 2, 'the queued task must not be sent')
        assert.equal(results.filter(result => result.status === 'completed').length, 2)
        const cancelled = results.find(result => result.status !== 'completed')
        assert.match(cancelled.error, /Manager stopped/)
        assert.equal(env.coordinator.active, 0, 'no worker slot is left acquired')
        assert.equal(env.coordinator.waiters.length, 0, 'no waiter is left dangling')
        assert.equal(env.coordinator.reserved.size, 0, 'no reservation is left behind')
      } finally { await env.cleanup() }
    })
  }

  // An end with no completion callback at all is unconfirmed and must not authorize anything.
  await check('an unconfirmed manager end keeps the queued tasks unsent', async () => {
    const env = await makeEnv(Coordinator)
    try {
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3']))
      await waitFor(() => env.sends.length === 2, 'two in-flight sends')
      env.setManagerTurn({ active: false })
      const results = await pending
      assert.equal(env.sends.length, 2)
      assert.equal(results.filter(result => result.status === 'completed').length, 2)
      assert.match(results.find(result => result.status !== 'completed').error, /Manager stopped/)
    } finally { await env.cleanup() }
  })

  // A new manager turn on the same conversation must not inherit the old batch's authorization.
  await check('a new manager turn does not revive the previous batch', async () => {
    const env = await makeEnv(Coordinator)
    try {
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3']))
      await waitFor(() => env.sends.length === 2, 'two in-flight sends')
      env.setManagerTurn({ active: false })
      env.completeManager('completed')
      env.setManagerTurn({ active: true, turnId: 'manager-turn-2' })
      const results = await pending
      assert.equal(env.sends.length, 2, 'the old batch must not run under a fresh turn')
      assert.match(results.find(result => result.status !== 'completed').error, /Manager stopped/)
    } finally { await env.cleanup() }
  })

  // A completion callback for a different/older turn must not authorize this batch.
  await check('a completion callback for a different turn does not authorize the batch', async () => {
    const env = await makeEnv(Coordinator)
    try {
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3']))
      await waitFor(() => env.sends.length === 2, 'two in-flight sends')
      env.setManagerTurn({ active: false })
      env.coordinator.complete('manager-thread', { id: 'some-other-turn', status: 'completed' })
      const results = await pending
      assert.equal(env.sends.length, 2, 'a stale callback must not authorize the queued task')
      assert.match(results.find(result => result.status !== 'completed').error, /Manager stopped/)
    } finally { await env.cleanup() }
  })

  // Natural completion releases existing queued work but must not unlock new MCP commands.
  await check('the ended turn cannot start a new batch through the tool', async () => {
    const env = await makeEnv(Coordinator)
    try {
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3']))
      await waitFor(() => env.sends.length === 2, 'two in-flight sends')
      env.setManagerTurn({ active: false })
      env.completeManager('completed')
      await assert.rejects(env.coordinator.tool({ ...batchParams(['worker-1'], { callId: 'call-2' }) }), /current Super Agent/)
      await pending
    } finally { await env.cleanup() }
  })

  // Exactly once per user message: a replay is cached, a second batch needs a new request.
  await check('one batch per user message; a replay never resends', async () => {
    const env = await makeEnv(Coordinator, { slots: 2, holdMs: 30 })
    try {
      armManager(env)
      const params = batchParams(['worker-1', 'worker-2'], { callId: 'call-1' })
      const first = await env.coordinator.tool(params)
      const replayed = await env.coordinator.tool(params)
      assert.equal(env.sends.length, 2, 'a replayed tool call must not resend')
      assert.deepEqual(replayed, first)
      await assert.rejects(env.coordinator.tool({ ...params, callId: 'call-2' }), /already dispatched/)
      assert.equal(env.sends.length, 2)
    } finally { await env.cleanup() }
  })

  // Only the current manager may dispatch.
  await check('a non-manager desk cannot dispatch', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      const grant = env.coordinator.arm('worker-1-thread', env.team.id, 'worker-1', 'worker-request')
      env.workerTurns.set('worker-1-thread', { active: true, turnId: 'worker-turn' })
      env.coordinator.bind(grant, 'worker-turn')
      await assert.rejects(env.coordinator.tool({ tool: 'dispatch_tasks', threadId: 'worker-1-thread', turnId: 'worker-turn', callId: 'w', arguments: { tasks: [{ slotId: 'worker-1', text: 'x' }] } }), /Only the current manager/)
      assert.equal(env.sends.length, 0)
    } finally { await env.cleanup() }
  })

  // Archived team and a disabled provider reject the whole batch before any job is created.
  await check('an archived team cannot dispatch', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      armManager(env)
      env.team.archived = true
      await assert.rejects(env.coordinator.tool(batchParams(['worker-1'])), /binding changed/)
      assert.equal(env.sends.length, 0)
      assert.equal(env.coordinator.jobs.length, 0)
    } finally { await env.cleanup() }
  })

  await check('a provider disabled at request time rejects the whole batch', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      armManager(env)
      env.setEnabledBlocked(true)
      await assert.rejects(env.coordinator.tool(batchParams(['worker-1'])), /disabled or unlicensed/)
      assert.equal(env.sends.length, 0)
      assert.equal(env.coordinator.jobs.length, 0, 'no job is recorded for a rejected batch')
    } finally { await env.cleanup() }
  })

  // Re-checked before sending: a desk whose id or provider changed since acceptance is cancelled.
  for (const [name, mutate] of [
    ['id', thread => { thread.id = 'renamed-thread' }],
    ['provider', thread => { thread.provider = 'codex' }],
  ]) {
    await check(`a worker ${name} change cancels that task before sending`, async () => {
      const env = await makeEnv(Coordinator)
      try {
        armManager(env)
        const pending = env.coordinator.tool(batchParams(['worker-1', 'worker-2', 'worker-3']))
        await waitFor(() => env.sends.length === 2, 'two in-flight sends')
        mutate(env.team.slots.find(slot => slot.id === 'worker-3').thread)
        const results = await pending
        assert.equal(env.sends.length, 2, 'the changed desk must not be sent')
        assert.match(results.find(result => result.slotId === 'worker-3').error, /bindings changed/)
      } finally { await env.cleanup() }
    })
  }

  // A busy worker is never sent to, and the failed task leaves no reservation or slot behind.
  await check('a busy worker is not sent and leaks no reservation', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      armManager(env)
      env.workerTurns.set('worker-1-thread', { active: true, turnId: 'busy-turn' })
      const results = await env.coordinator.tool(batchParams(['worker-1']))
      assert.equal(env.sends.length, 0)
      assert.match(results[0].error, /busy/)
      assert.equal(env.coordinator.reserved.size, 0)
      assert.equal(env.coordinator.active, 0)
      assert.equal(env.coordinator.waiters.length, 0)
    } finally { await env.cleanup() }
  })

  // Provider/license disabled between acceptance and sending stops the task before the send.
  await check('a provider disabled just before sending cancels the task and cleans up', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      armManager(env)
      env.setEnabledFailAfter(1) // the request-time check passes; the pre-send check fails
      const results = await env.coordinator.tool(batchParams(['worker-1']))
      assert.equal(env.sends.length, 0)
      assert.equal(results[0].status, 'failed')
      assert.match(results[0].error, /disabled or unlicensed/)
      assert.equal(env.coordinator.reserved.size, 0, 'no reservation is leaked')
      assert.equal(env.coordinator.active, 0, 'the concurrency slot is released')
      assert.equal(env.coordinator.waiters.length, 0, 'no waiter is left dangling')
    } finally { await env.cleanup() }
  })

  // Isolated stop race: the pre-send provider/license check (the second enabled call in run) is
  // parked on a gate, the manager is interrupted while it is pending, and the gate is released.
  // The send boundary must re-check the batch so nothing is sent and all state is released.
  await check('an operator stop while the pre-send provider check is pending sends nothing', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      let release = null, gateCalls = 0
      env.setEnabledWait(async () => {
        gateCalls += 1
        if (gateCalls !== 2) return // the request-time check passes; only the pre-send one parks
        await new Promise(resolve => { release = resolve })
      })
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1']))
      await waitFor(() => release, 'the parked pre-send provider check')
      env.setManagerTurn({ active: false })
      env.completeManager('interrupted')
      release()
      const results = await pending
      assert.equal(env.sends.length, 0, 'the stop must abort the task at the send boundary')
      assert.equal(results[0].status, 'failed')
      assert.match(results[0].error, /Manager stopped/)
      assert.equal(env.coordinator.reserved.size, 0, 'no reservation is leaked')
      assert.equal(env.coordinator.active, 0, 'the concurrency slot is released')
      assert.equal(env.coordinator.waiters.length, 0, 'no waiter is left dangling')
    } finally { await env.cleanup() }
  })

  // A send that fails (for example a blocked license charge) records failure and releases state.
  await check('a send failure cancels the task and releases its reservation', async () => {
    const env = await makeEnv(Coordinator, { slots: 1, onSend: async () => { throw new Error('license blocked') } })
    try {
      armManager(env)
      const results = await env.coordinator.tool(batchParams(['worker-1']))
      assert.equal(env.sends.length, 0, 'a rejected send must not count as a send')
      assert.equal(results[0].status, 'failed')
      assert.match(results[0].error, /license blocked/)
      assert.equal(env.coordinator.jobs[0].status, 'failed')
      assert.equal(env.coordinator.reserved.size, 0)
      assert.equal(env.coordinator.active, 0)
    } finally { await env.cleanup() }
  })

  // A worker completion or an unrelated manager turn must never revoke the manager grant.
  await check('a worker completion or unmatched turn never revokes the manager grant', async () => {
    const env = await makeEnv(Coordinator, { slots: 2 })
    try {
      const grant = armManager(env)
      env.coordinator.complete('worker-1-thread', { id: 'worker-turn', status: 'completed' }, 'cline')
      assert.equal(env.coordinator.grants.get('manager-thread'), grant, 'a worker completion keeps the manager grant')
      env.coordinator.complete('manager-thread', { id: 'manager-turn-99', status: 'completed' })
      assert.equal(env.coordinator.grants.get('manager-thread'), grant, 'an unmatched turn keeps the manager grant')
      assert.ok(!grant.accepted, 'no batch is accepted before a dispatch')
    } finally { await env.cleanup() }
  })

  // Round-r4 stop race: the persisted dispatching record itself is parked on a gate (the record
  // is called first, then it waits), the manager is interrupted while that write is pending, and
  // then the gate is released. The final check right before the send call — with no await between
  // them — must abort, so nothing is sent and the reservation/slot/waiters are released.
  await check('a stop during the persisted dispatching write sends nothing', async () => {
    const env = await makeEnv(Coordinator, { slots: 1 })
    try {
      const originalRecord = env.coordinator.record.bind(env.coordinator)
      let release = null
      env.coordinator.record = async (job, patch) => {
        await originalRecord(job, patch) // the original record runs first
        if (patch.status === 'dispatching') await new Promise(resolve => { release = resolve })
      }
      armManager(env)
      const pending = env.coordinator.tool(batchParams(['worker-1']))
      await waitFor(() => release, 'the parked dispatching record')
      env.setManagerTurn({ active: false })
      env.completeManager('interrupted')
      release()
      const results = await pending
      assert.equal(env.sends.length, 0, 'the stop must abort the task at the final send boundary')
      assert.equal(results[0].status, 'failed')
      assert.match(results[0].error, /Manager stopped/)
      assert.equal(env.coordinator.reserved.size, 0, 'no reservation is leaked')
      assert.equal(env.coordinator.active, 0, 'the concurrency slot is released')
      assert.equal(env.coordinator.waiters.length, 0, 'no waiter is left dangling')
    } finally { await env.cleanup() }
  })

  // A restart marks every uncertain job interrupted and never automatically replays a dispatch.
  await check('a restart marks uncertain jobs interrupted and never resends', async () => {
    const env = await makeEnv(Coordinator, { slots: 2, holdMs: 20 })
    try {
      armManager(env)
      await env.coordinator.tool(batchParams(['worker-1', 'worker-2']))
      const file = path.join(env.root, 'super-agent-tasks.json')
      const saved = JSON.parse(await readFile(file, 'utf8'))
      saved.jobs = saved.jobs.map((job, index) => ({ ...job, status: ['queued', 'dispatching', 'running'][index % 3] }))
      await writeFile(file, JSON.stringify(saved))
      const before = env.sends.length
      const restored = new Coordinator(env.root, env.deps)
      await restored.ready
      assert.ok(restored.jobs.every(job => job.status === 'interrupted'))
      assert.equal(env.sends.length, before, 'a restart must not automatically replay a dispatch')
    } finally { await env.cleanup() }
  })

  const failures = checks.filter(item => !item.ok)
  for (const item of checks) log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.ok ? '' : `\n      -> ${item.error}`}`)
  log(`\n${label}: ${checks.length - failures.length}/${checks.length} checks passed`)
  return { label, checks, passed: checks.length - failures.length, failed: failures.length, failures }
}

async function main() {
  const { SuperAgentCoordinator } = await import(new URL('../server/super-agent-coordinator.mjs', import.meta.url))
  const result = await runQueueChecks(SuperAgentCoordinator, { label: 'production source' })
  process.exitCode = result.failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
