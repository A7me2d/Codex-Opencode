import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SuperAgentStore, superExecution, defaultTeamExecution } from '../server/super-agent.mjs'
import { SuperAgentCoordinator } from '../server/super-agent-coordinator.mjs'
import { SuperAgentOpenCode } from '../server/super-agent-opencode.mjs'

/**
 * Independent checks for the Super Agent execution economy round.
 *
 * Covered here, against the real store, coordinator and OpenCode tracker through their public
 * surface only (synthetic transports, no network, no provider, no license, no AI call):
 *   - the persisted `execution` policy (values, partial update, legacy default, restart);
 *   - per-batch concurrency pinned from that policy, with a global ceiling of eight;
 *   - background dispatch returning a fast acknowledgement and persisting results the server
 *     keeps for its lifetime, readable through get_dispatch_reports by a fresh manager request;
 *   - an explicit stop still leaving the queued tasks unsent;
 *   - a desk question keeping the turn alive as `waiting_input` (never failed by the timeout,
 *     never resent) and returning to running then completed once the operator answers;
 *   - uncertain waiting_input jobs interrupted honestly on restart.
 */

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async (check, { timeout = 5000, interval = 5 } = {}) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (check()) return; await delay(interval) }
  throw new Error('the expected state did not appear before the deadline')
}

/**
 * A fully synthetic coordinator environment. Every desk "completes" after `holdMs` and the
 * in-flight sends are counted so the real concurrency gate can be observed.
 */
async function makeEnv(Coordinator, { teams, holdMs = 40 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'openzero-execution-'))
  const teamMap = new Map(), workerTurns = new Map(), managerTurns = new Map()
  const sends = [], replies = new Map()
  let running = 0, peak = 0
  for (const spec of teams) {
    const workers = Array.from({ length: spec.workers }, (unused, index) => ({
      id: `worker-${index + 1}`,
      thread: { id: `${spec.id}-worker-${index + 1}`, directory: root, provider: index % 2 === 0 ? 'cline' : 'opencode' },
    }))
    const manager = { id: 'manager', thread: { id: `${spec.id}-manager`, directory: root, provider: 'codex' } }
    teamMap.set(spec.id, { id: spec.id, archived: false, ...(spec.execution ? { execution: spec.execution } : {}), slots: [manager, ...workers] })
    managerTurns.set(`${spec.id}-manager`, { active: true, turnId: spec.turnId || 'manager-turn-1' })
  }
  const deps = {
    team: async id => structuredClone(teamMap.get(id)),
    memory: { propose: async () => ({ proposed: true }) },
    recall: () => [],
    enabled: async () => {},
    turn: threadId => managerTurns.get(threadId) || workerTurns.get(threadId) || { active: false },
    send: async (grant, target) => {
      const threadId = target.slot.thread.id, turnId = `${threadId}:${grant.messageId}`
      const provider = target.slot.thread.provider || 'codex'
      const record = { active: true, turnId, status: 'running' }
      workerTurns.set(threadId, record)
      sends.push({ slotId: target.slot.id, threadId })
      running += 1; peak = Math.max(peak, running)
      // The turn ends asynchronously, exactly like a real provider finishing a turn.
      void (async () => {
        await delay(holdMs)
        running -= 1
        record.active = false; record.status = 'completed'
        replies.set(`${threadId}:${turnId}`, `reply from ${target.slot.id}`)
        coordinator.complete(threadId, { id: turnId, status: 'completed' }, provider)
      })()
      return { turn: { id: turnId, status: 'running' } }
    },
    reply: async (threadId, turnId) => replies.get(`${threadId}:${turnId}`) || '',
  }
  const coordinator = new Coordinator(root, deps)
  await coordinator.ready
  const manager = teamId => teamMap.get(teamId).slots[0].thread.id
  const arm = (teamId, messageId) => {
    const threadId = manager(teamId)
    const grant = coordinator.arm(threadId, teamId, 'manager', messageId)
    coordinator.bind(grant, managerTurns.get(threadId).turnId)
    return grant
  }
  const batch = (teamId, slotIds, { callId = 'call-1' } = {}) => ({
    tool: 'dispatch_tasks', threadId: manager(teamId), turnId: managerTurns.get(manager(teamId)).turnId, callId,
    arguments: { tasks: slotIds.map((slotId, index) => ({ slotId, text: `task ${index + 1} for ${slotId}` })) },
  })
  const finishManager = (teamId, status) => {
    const threadId = manager(teamId), turnId = managerTurns.get(threadId).turnId
    managerTurns.set(threadId, { active: false, turnId })
    coordinator.complete(threadId, { id: turnId, status })
  }
  const newManagerTurn = (teamId, turnId) => managerTurns.set(manager(teamId), { active: true, turnId })
  return { root, teamMap, coordinator, workerTurns, managerTurns, sends, peak: () => peak, manager, arm, batch, finishManager, newManagerTurn, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function checkPolicy() {
  const root = await mkdtemp(path.join(tmpdir(), 'openzero-execution-policy-'))
  try {
    const store = new SuperAgentStore(root)
    // The legacy default is never weakened and is used for every team saved before the setting.
    assert.deepEqual(superExecution({}), { maxParallel: 2, dispatchMode: 'wait' })
    assert.deepEqual(superExecution({ execution: { maxParallel: 9, dispatchMode: 'bogus' } }), { maxParallel: 2, dispatchMode: 'wait' })
    const legacy = await store.create('Legacy')
    assert.equal('execution' in legacy, false, 'a legacy team is never rewritten')
    assert.deepEqual(superExecution(legacy), { maxParallel: 2, dispatchMode: 'wait' })
    // A new team can be created with (and persist) an explicit policy.
    const team = await store.create('Configured', { maxParallel: 5, dispatchMode: 'background' })
    assert.deepEqual(team.execution, { maxParallel: 5, dispatchMode: 'background' })
    assert.deepEqual(superExecution(await store.get(team.id)), { maxParallel: 5, dispatchMode: 'background' })
    // Partial updates merge with the current policy.
    await store.update(team.id, { execution: { maxParallel: 8 } })
    assert.deepEqual((await store.get(team.id)).execution, { maxParallel: 8, dispatchMode: 'background' })
    await store.update(team.id, { execution: { dispatchMode: 'wait' } })
    assert.deepEqual((await store.get(team.id)).execution, { maxParallel: 8, dispatchMode: 'wait' })
    // Invalid values are rejected and leave the stored policy untouched.
    for (const bad of [{ maxParallel: 0 }, { maxParallel: 9 }, { maxParallel: 2.5 }, { maxParallel: '4' }, { dispatchMode: 'parallel' }, { maxParallel: 4, dispatchMode: 'wait', extra: true }, null, 'x', []]) {
      await assert.rejects(store.update(team.id, { execution: bad }), /concurrency between 1 and 8|supported dispatch mode|Invalid execution settings|Unknown execution setting/)
    }
    assert.deepEqual((await store.get(team.id)).execution, { maxParallel: 8, dispatchMode: 'wait' })
    const reopened = new SuperAgentStore(root)
    assert.deepEqual((await reopened.get(team.id)).execution, { maxParallel: 8, dispatchMode: 'wait' })
    assert.deepEqual(defaultTeamExecution, { maxParallel: 8, dispatchMode: 'background' })
    console.log('ok   execution policy validates, merges, persists and keeps the legacy default')
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function checkConcurrency() {
  const wide = await makeEnv(SuperAgentCoordinator, { teams: [{ id: 'wide', workers: 8, execution: { maxParallel: 8, dispatchMode: 'wait' } }], holdMs: 60 })
  try {
    wide.arm('wide', 'msg-wide')
    const results = await wide.coordinator.tool(wide.batch('wide', ['worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5', 'worker-6', 'worker-7', 'worker-8'], { callId: 'wide' }))
    assert.equal(results.length, 8)
    assert.ok(results.every(result => result.status === 'completed'))
    assert.equal(wide.peak(), 8, 'eight desks run together at maxParallel 8')
    assert.equal(wide.coordinator.active, 0)
    console.log('ok   maxParallel 8 runs eight desks concurrently')
  } finally { await wide.cleanup() }

  const narrow = await makeEnv(SuperAgentCoordinator, { teams: [{ id: 'narrow', workers: 5, execution: { maxParallel: 2, dispatchMode: 'wait' } }], holdMs: 40 })
  try {
    narrow.arm('narrow', 'msg-narrow')
    const results = await narrow.coordinator.tool(narrow.batch('narrow', ['worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5'], { callId: 'narrow' }))
    assert.equal(results.length, 5)
    assert.ok(results.every(result => result.status === 'completed'))
    assert.equal(narrow.peak(), 2, 'maxParallel 2 never exceeds 2')
    console.log('ok   maxParallel 2 never exceeds two desks')
  } finally { await narrow.cleanup() }

  const legacy = await makeEnv(SuperAgentCoordinator, { teams: [{ id: 'legacy', workers: 4 }], holdMs: 40 })
  try {
    legacy.arm('legacy', 'msg-legacy')
    await legacy.coordinator.tool(legacy.batch('legacy', ['worker-1', 'worker-2', 'worker-3', 'worker-4'], { callId: 'legacy' }))
    assert.equal(legacy.peak(), 2, 'a team without an execution setting keeps the legacy two')
    console.log('ok   a team without an execution setting keeps the legacy concurrency of two')
  } finally { await legacy.cleanup() }

  const both = await makeEnv(SuperAgentCoordinator, { teams: [
    { id: 'a', workers: 8, execution: { maxParallel: 8, dispatchMode: 'wait' } },
    { id: 'b', workers: 8, execution: { maxParallel: 8, dispatchMode: 'wait' } },
  ], holdMs: 60 })
  try {
    both.arm('a', 'msg-a'); both.arm('b', 'msg-b')
    const [first, second] = await Promise.all([
      both.coordinator.tool(both.batch('a', ['worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5', 'worker-6', 'worker-7', 'worker-8'], { callId: 'a' })),
      both.coordinator.tool(both.batch('b', ['worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5', 'worker-6', 'worker-7', 'worker-8'], { callId: 'b' })),
    ])
    assert.equal(first.length + second.length, 16)
    assert.equal(both.peak(), 8, 'two batches share the global ceiling of eight')
    console.log('ok   two concurrent batches never exceed the global ceiling of eight')
  } finally { await both.cleanup() }
}

async function checkBackground() {
  const env = await makeEnv(SuperAgentCoordinator, { teams: [{ id: 'bg', workers: 3, execution: { maxParallel: 8, dispatchMode: 'background' } }], holdMs: 80 })
  try {
    env.arm('bg', 'msg-bg')
    const params = env.batch('bg', ['worker-1', 'worker-2', 'worker-3'], { callId: 'bg-1' })
    const receipt = await env.coordinator.tool(params)
    // A fast, structured acknowledgement — never a worker reply.
    assert.equal(receipt.status, 'accepted')
    assert.equal(receipt.dispatchMode, 'background')
    assert.equal(typeof receipt.batchId, 'string')
    assert.equal(receipt.jobs.length, 3)
    assert.ok(receipt.jobs.every(job => job.status === 'queued' && job.jobId && !('reply' in job)))
    assert.match(receipt.note, /not worker replies/)
    // Replaying the same tool call returns the same acknowledgement.
    assert.equal(await env.coordinator.tool(params), receipt)
    // The accepted batch keeps running in the background; each desk is dispatched exactly once.
    await waitFor(() => env.sends.length === 3)
    assert.equal(await env.coordinator.tool(params), receipt)
    assert.equal(env.sends.length, 3, 'a replay never resends')
    // The manager turn ends naturally; the accepted batch still finishes on the server.
    env.finishManager('bg', 'completed')
    await waitFor(() => env.coordinator.jobs.filter(job => job.batchId === receipt.batchId).every(job => job.status === 'completed'))
    assert.equal(env.sends.length, 3)
    // A fresh manager request reads the saved reports without contacting any desk.
    env.newManagerTurn('bg', 'manager-turn-2')
    env.arm('bg', 'msg-bg-2')
    const reports = await env.coordinator.tool({ tool: 'get_dispatch_reports', threadId: env.manager('bg'), turnId: 'manager-turn-2', arguments: { batchId: receipt.batchId } })
    assert.equal(reports.status, 'completed')
    assert.equal(reports.jobs.length, 3)
    assert.ok(reports.jobs.every(job => job.status === 'completed' && job.reply))
    const latest = await env.coordinator.tool({ tool: 'get_dispatch_reports', threadId: env.manager('bg'), turnId: 'manager-turn-2', arguments: {} })
    assert.equal(latest.batchId, receipt.batchId)
    assert.equal(env.sends.length, 3, 'reading reports sends nothing')
    // A worker role and a stale turn can never read them.
    const workerThread = env.teamMap.get('bg').slots[1].thread.id
    env.workerTurns.set(workerThread, { active: true, turnId: 'worker-turn-1' })
    env.coordinator.bind(env.coordinator.arm(workerThread, 'bg', 'worker-1', 'w-msg'), 'worker-turn-1')
    await assert.rejects(env.coordinator.tool({ tool: 'get_dispatch_reports', threadId: workerThread, turnId: 'worker-turn-1', arguments: {} }), /Only the current manager/)
    await assert.rejects(env.coordinator.tool({ tool: 'get_dispatch_reports', threadId: env.manager('bg'), turnId: 'stale-turn', arguments: {} }), /current Super Agent request/)
    console.log('ok   background dispatch acknowledges fast, persists reports and blocks workers/stale turns')
  } finally { await env.cleanup() }
}

async function checkCancel() {
  const env = await makeEnv(SuperAgentCoordinator, { teams: [{ id: 'cancel', workers: 4, execution: { maxParallel: 2, dispatchMode: 'background' } }], holdMs: 120 })
  try {
    env.arm('cancel', 'msg-cancel')
    const receipt = await env.coordinator.tool(env.batch('cancel', ['worker-1', 'worker-2', 'worker-3', 'worker-4'], { callId: 'cancel-1' }))
    assert.equal(receipt.status, 'accepted')
    await waitFor(() => env.sends.length === 2)
    env.finishManager('cancel', 'interrupted')
    await waitFor(() => env.coordinator.jobs.every(job => ['completed', 'failed', 'interrupted'].includes(job.status)))
    assert.equal(env.sends.length, 2, 'an explicit stop leaves the queued tasks unsent')
    const failed = env.coordinator.jobs.filter(job => job.batchId === receipt.batchId && job.status === 'failed')
    assert.equal(failed.length, 2)
    assert.ok(failed.every(job => /Manager stopped/.test(job.error)))
    console.log('ok   an explicit stop leaves a background batch queued tasks unsent')
  } finally { await env.cleanup() }
}

async function checkRestart() {
  const root = await mkdtemp(path.join(tmpdir(), 'openzero-execution-restart-'))
  try {
    await writeFile(path.join(root, 'super-agent-tasks.json'), JSON.stringify({ jobs: [
      { id: 'j1', batchId: 'b', teamId: 't', slotId: 'worker-1', threadId: 'th', provider: 'opencode', status: 'waiting_input' },
      { id: 'j2', batchId: 'b', teamId: 't', slotId: 'worker-2', threadId: 'th2', provider: 'codex', status: 'completed' },
    ] }), 'utf8')
    const coordinator = new SuperAgentCoordinator(root, { team: async () => { throw new Error('unused') }, memory: {}, recall: () => [], enabled: async () => {}, turn: () => ({ active: false }), send: async () => ({}), reply: async () => '' })
    await coordinator.ready
    assert.equal(coordinator.jobs[0].status, 'interrupted')
    assert.match(coordinator.jobs[0].error, /restarted/i)
    assert.equal(coordinator.jobs[1].status, 'completed')
    console.log('ok   an uncertain waiting_input job is interrupted honestly on restart')
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function checkWaitingInput() {
  const root = await mkdtemp(path.join(tmpdir(), 'openzero-execution-question-'))
  const sessionRoot = await mkdtemp(path.join(tmpdir(), 'openzero-execution-session-'))
  try {
    const session = { id: 'ses-q', messages: [], inbox: [], forms: [] }
    const calls = []
    const transport = async (method, endpoint, body) => {
      calls.push({ method, endpoint })
      if (endpoint === '/api/session/active') return { data: {} }
      const [, id, action] = endpoint.match(/^\/api\/session\/([^/]+)\/(\w+)$/) || []
      if (action === 'message') return { data: session.messages }
      if (action === 'inbox') return { data: session.inbox }
      if (action === 'form') return { data: session.forms }
      if (action === 'interrupt') return { data: { interrupted: true } }
      if (action === 'prompt') {
        session.messages = [{ id: 'msg-q-user', type: 'user', text: body.text, time: { created: 1000 } }]
        session.forms = [{ id: 'frm-1', title: 'Choose a path', options: ['a', 'b'] }]
        return { data: { id: 'receipt-1', sessionID: id, delivery: 'queue' } }
      }
      throw new Error(`unexpected OpenCode action ${action}`)
    }
    const finished = []
    let coordinator
    // Work timeout of 60ms: a question held open longer than that must not become a failure.
    const adapter = new SuperAgentOpenCode(transport, (id, turn) => { finished.push({ id, status: turn.status }); coordinator.complete(id, turn, 'opencode') }, { interval: 5, timeout: 60 })
    const team = { id: 'ask', archived: false, slots: [
      { id: 'manager', label: '', thread: { id: 'ask-manager', directory: sessionRoot, provider: 'codex' } },
      { id: 'worker-1', label: '', thread: { id: 'ses-q', directory: sessionRoot, provider: 'opencode' } },
    ] }
    const managerTurn = { active: true, turnId: 'manager-turn-1' }
    const deps = {
      team: async () => structuredClone(team),
      memory: { propose: async () => ({}) },
      recall: () => [],
      enabled: async () => {},
      turn: threadId => (threadId === 'ask-manager' ? managerTurn : adapter.turn(threadId)),
      send: async (grant, target) => adapter.send(target.slot.thread.id, target.text, { messages: [] }),
      reply: async (threadId, turnId) => adapter.replies.get(`${threadId}:${turnId}`) || '',
    }
    coordinator = new SuperAgentCoordinator(root, deps)
    await coordinator.ready
    coordinator.bind(coordinator.arm('ask-manager', 'ask', 'manager', 'msg-ask'), 'manager-turn-1')
    const pending = coordinator.tool({ tool: 'dispatch_tasks', threadId: 'ask-manager', turnId: 'manager-turn-1', callId: 'ask-1', arguments: { tasks: [{ slotId: 'worker-1', text: 'Implement the feature' }] } })

    // The desk asks a question: the turn stays active as waiting_input, never failed.
    await waitFor(() => adapter.turn('ses-q').status === 'waiting_input')
    await waitFor(() => coordinator.jobs[0]?.status === 'waiting_input')
    assert.ok(adapter.turn('ses-q').active, 'a pending question keeps the turn active')
    // Hold the question open far longer than the desk work timeout.
    await delay(200)
    assert.equal(adapter.turn('ses-q').status, 'waiting_input')
    assert.equal(finished.length, 0, 'an unanswered question is never turned into a failure by the timeout')
    assert.equal(calls.filter(call => call.endpoint.endsWith('/prompt')).length, 1, 'the task is never resent while waiting')

    // The operator answers through the desk and the worker replies.
    session.forms = []
    session.messages = [
      { id: 'msg-idle', type: 'idle', outcome: 'succeeded', time: { created: 3000 } },
      { id: 'msg-a', type: 'assistant', text: 'Implemented the feature.', time: { created: 2000 } },
      { id: 'msg-q-user', type: 'user', text: 'Implement the feature', time: { created: 1000 } },
    ]
    const results = await pending
    assert.equal(results[0].status, 'completed')
    assert.match(results[0].reply, /Implemented the feature/)
    assert.equal(coordinator.jobs[0].status, 'completed')
    assert.equal(calls.filter(call => call.endpoint.endsWith('/prompt')).length, 1, 'the answer never triggers a resend')
    assert.ok(!adapter.turn('ses-q').active)
    console.log('ok   a desk question waits as waiting_input and completes after the answer without a resend')
  } finally { await rm(root, { recursive: true, force: true }); await rm(sessionRoot, { recursive: true, force: true }) }
}

await checkPolicy()
await checkConcurrency()
await checkBackground()
await checkCancel()
await checkRestart()
await checkWaitingInput()
console.log('production source: all execution economy checks passed (synthetic transports, no AI calls)')
