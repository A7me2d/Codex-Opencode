// Synthetic long-running task regressions against the production source.
// Run: node scripts/test-super-agent-long-running.mjs

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SuperAgentCoordinator } from '../server/super-agent-coordinator.mjs'
import { SuperAgentOpenCode } from '../server/super-agent-opencode.mjs'

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const waitFor = async (probe, { timeout = 4000, interval = 5 } = {}) => {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await probe()
    if (value) return value
    await delay(interval)
  }
  throw new Error('waitFor timed out')
}

const checks = []
const check = (name, fn) => checks.push({ name, fn })

/* ------------------------------------------------------------------ OpenCode adapter ---- */

/** Synthetic OpenCode HTTP api: only what the adapter really reads and writes. */
const openCodeHarness = ({ failMessages = false } = {}) => {
  const session = { id: 's1', active: false, forms: [], inbox: [], messages: [], prompts: [], interrupts: 0, failMessages }
  const api = async (method, url, body) => {
    if (method === 'GET' && url === '/api/session/active') return { data: { s1: session.active } }
    if (!url.startsWith('/api/session/s1')) throw new Error(`unexpected ${method} ${url}`)
    if (method === 'GET' && url.endsWith('/message')) { if (session.failMessages) throw new Error('ECONNRESET: the session could not be read'); return { data: session.messages } }
    if (method === 'GET' && url.endsWith('/inbox')) return { data: session.inbox }
    if (method === 'GET' && url.endsWith('/form')) return { data: session.forms }
    if (method === 'POST' && url.endsWith('/prompt')) { session.prompts.push(body); return { data: { id: `receipt-${session.prompts.length}`, sessionID: session.id, delivery: 'queue' } } }
    if (method === 'POST' && url.endsWith('/interrupt')) { session.interrupts += 1; return { data: {} } }
    throw new Error(`unexpected ${method} ${url}`)
  }
  const completions = []
  const adapter = new SuperAgentOpenCode(api, (id, turn) => completions.push({ id, turn }), { interval: 1, timeout: 60 })
  return { session, adapter, completions }
}
const emptyBaseline = { messages: [], inbox: [], forms: [], active: false }

check('opencode: a confirmed active desk past the follow window stays running, then completes the same task', async () => {
  const { session, adapter, completions } = openCodeHarness()
  session.active = true
  session.messages = [{ id: 'u1', type: 'user', text: 'long build' }]
  await adapter.send('s1', 'long build', emptyBaseline)
  await delay(300) // five times the 60ms follow window: the ten-minute case
  assert(adapter.turn('s1').active === true, 'the turn must stay active while the provider is active')
  assert(adapter.turn('s1').status === 'running', `status must stay running, got ${adapter.turn('s1').status}`)
  assert(completions.length === 0, 'age alone must never record an outcome')
  session.messages = [...session.messages, { id: 'a1', type: 'assistant', parentID: 'u1', text: 'build finished' }]
  session.active = false
  await waitFor(() => completions.length)
  assert(completions[0].turn.status === 'completed', `expected completed, got ${completions[0].turn.status}`)
  assert(adapter.replies.get(`s1:${completions[0].turn.id}`) === 'build finished', 'the reply must be recorded for this task')
  assert(session.prompts.length === 1, 'the task must never be resent')
})

check('opencode: a question past the follow window stays waiting_input, then the answer completes the same task', async () => {
  const { session, adapter, completions } = openCodeHarness()
  session.active = true
  session.forms = [{ id: 'f1' }]
  session.messages = [{ id: 'u1', type: 'user', text: 'ask the operator' }]
  await adapter.send('s1', 'ask the operator', emptyBaseline)
  await delay(250)
  assert(adapter.turn('s1').active === true, 'a waiting question is not the end of the turn')
  assert(adapter.turn('s1').status === 'waiting_input', `expected waiting_input, got ${adapter.turn('s1').status}`)
  assert(completions.length === 0, 'waiting for an answer must never be recorded as failure')
  session.forms = []
  session.messages = [...session.messages, { id: 'a1', type: 'assistant', parentID: 'u1', text: 'answered' }]
  session.active = false
  await waitFor(() => completions.length)
  assert(completions[0].turn.status === 'completed', `expected completed, got ${completions[0].turn.status}`)
  assert(session.prompts.length === 1, 'the task must never be resent to answer for the operator')
})

check('opencode: a real provider error is still failed, never a success', async () => {
  const { session, adapter, completions } = openCodeHarness()
  session.active = false
  session.messages = [
    { id: 'u1', type: 'user', text: 'do it' },
    { id: 'a1', type: 'assistant', parentID: 'u1', error: { message: 'boom' } },
  ]
  await adapter.send('s1', 'do it', emptyBaseline)
  await waitFor(() => completions.length)
  assert(completions[0].turn.status === 'failed', `expected failed, got ${completions[0].turn.status}`)
  assert(/reported an error/.test(completions[0].turn.error.message), 'the provider error must be kept')
  assert(adapter.replies.size === 0, 'a failed turn records no reply')
})

check('opencode: an explicit stop is interrupted and never failed', async () => {
  const { session, adapter, completions } = openCodeHarness()
  session.active = true
  session.messages = [{ id: 'u1', type: 'user', text: 'stop me' }]
  await adapter.send('s1', 'stop me', emptyBaseline)
  await delay(10)
  await adapter.stop('s1')
  await waitFor(() => completions.length)
  assert(completions[0].turn.status === 'interrupted', `expected interrupted, got ${completions[0].turn.status}`)
  assert(session.interrupts === 1, 'the explicit stop must be the only interrupt')
})

check('opencode: a lost connection ends as tracking_unknown, not as failed, with no interrupt and no resend', async () => {
  const { session, adapter, completions } = openCodeHarness({ failMessages: true })
  session.active = true
  await adapter.send('s1', 'unreachable', emptyBaseline)
  await waitFor(() => completions.length, { timeout: 2000 })
  assert(completions[0].turn.status === 'tracking_unknown', `expected tracking_unknown, got ${completions[0].turn.status}`)
  assert(session.interrupts === 0, 'a lost follow must not interrupt the desk')
  assert(session.prompts.length === 1, 'a lost follow must not resend the task')
})

check('opencode: a queue entry that never ran and never appeared ends as tracking_unknown, not as failed', async () => {
  const { session, adapter, completions } = openCodeHarness()
  await adapter.send('s1', 'never delivered', emptyBaseline)
  await waitFor(() => completions.length, { timeout: 2000 })
  assert(completions[0].turn.status === 'tracking_unknown', `expected tracking_unknown, got ${completions[0].turn.status}`)
  assert(session.prompts.length === 1, 'the unconfirmed task must not be resent')
})

/* --------------------------------------------------------------------- Coordinator ---- */

const WORKER_SLOTS = ['worker-1', 'worker-2', 'worker-3', 'worker-4']
const workerThread = slotId => `w${Number(slotId.split('-')[1])}`

/**
 * Synthetic manager/worker deps for the coordinator. Worker turns are held in a mutable Map so a
 * check can keep a desk "active" for as long as the ten-minute case needs, then complete it.
 */
const coordinatorHarness = async ({ execution, responseDeadlineMs = 80, pollIntervalMs = 5, askOnSend = false } = {}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'long-running-r1-'))
  const turns = new Map([['mgr', { active: true, turnId: 'mgr-turn', status: 'running' }]])
  const sends = [], replies = new Map()
  const team = {
    id: 'team-1', archived: false, execution,
    slots: [{ id: 'manager', thread: { id: 'mgr', provider: 'codex' } }, ...WORKER_SLOTS.map(slotId => ({ id: slotId, thread: { id: workerThread(slotId), provider: 'opencode' } }))],
  }
  const deps = {
    team: async () => team,
    memory: { propose: async () => ({ ok: true }) },
    recall: async () => [],
    enabled: async () => {},
    turn: id => turns.get(id) || { active: false, turnId: null, status: null },
    send: async (grant, target) => {
      const turnId = `turn-${target.slot.id}`
      sends.push(target.slot.id)
      turns.set(target.slot.thread.id, { active: true, status: askOnSend ? 'waiting_input' : 'running', waitingInput: askOnSend, turnId })
      return { turn: { id: turnId, status: 'running' } }
    },
    reply: async (threadId, turnId) => replies.get(`${threadId}:${turnId}`) || '',
  }
  const coordinator = new SuperAgentCoordinator(directory, deps, { responseDeadlineMs, pollIntervalMs })
  await coordinator.ready
  const dispatch = async (tasks, { messageId = 'm1', turnId = 'mgr-turn' } = {}) => {
    const grant = coordinator.arm('mgr', 'team-1', 'manager', messageId)
    coordinator.bind(grant, turnId)
    return await coordinator.tool({ threadId: 'mgr', turnId, tool: 'dispatch_tasks', arguments: { tasks }, callId: messageId })
  }
  const completeWorker = async (slotId, status, error) => {
    const threadId = workerThread(slotId), turnId = `turn-${slotId}`
    if (status === 'completed') replies.set(`${threadId}:${turnId}`, `${slotId} reply`)
    coordinator.complete(threadId, { id: turnId, status, ...(error ? { error: { message: error } } : {}) }, 'opencode')
    turns.set(threadId, { active: false, status, turnId })
  }
  const jobOf = (messageId, slotId) => coordinator.jobs.find(item => item.requestId === messageId && item.slotId === slotId)
  const cleanup = () => rm(directory, { recursive: true, force: true })
  return { coordinator, turns, sends, replies, dispatch, completeWorker, jobOf, directory, cleanup }
}

check('coordinator: an active worker past the tool window is returned as running, keeps its reservation, then completes in the background', async () => {
  const harness = await coordinatorHarness()
  const results = await harness.dispatch([{ slotId: 'worker-1', text: 'long work' }])
  assert(results.length === 1 && results[0].status === 'running', `the tool must report running, got ${results[0].status}`)
  assert(/not a failure/.test(results[0].note || ''), 'the interim result must say it is not a failure')
  assert(harness.sends.length === 1, 'exactly one send')
  await delay(250) // many windows past the ten-minute analog, with the desk still active
  assert(harness.jobOf('m1', 'worker-1').status === 'running', `the job must stay running, got ${harness.jobOf('m1', 'worker-1').status}`)
  assert(harness.coordinator.reserved.has('opencode:w1'), 'the reservation must be held while the desk works')
  // A second batch must not open a second reservation or enter the still-active session.
  harness.turns.set('mgr', { active: true, turnId: 'mgr-turn-2', status: 'running' })
  const second = await harness.dispatch([{ slotId: 'worker-1', text: 'again' }], { messageId: 'm2', turnId: 'mgr-turn-2' })
  assert(/already busy/.test(second[0].error || ''), `expected a busy refusal, got ${second[0].status}`)
  assert(harness.sends.length === 1, 'no second send may enter an active session')
  await harness.completeWorker('worker-1', 'completed')
  const finished = await waitFor(() => { const job = harness.jobOf('m1', 'worker-1'); return job.status === 'completed' ? job : null })
  assert(finished.reply === 'worker-1 reply', 'the background follow must save the reply')
  assert(harness.coordinator.reserved.size === 0, 'the reservation must be released once the turn settles')
  await waitFor(() => harness.coordinator.active === 0)
  await harness.cleanup()
})

check('coordinator: a waiting question is waiting_input for as long as it takes, and the same task completes after the answer', async () => {
  const harness = await coordinatorHarness({ askOnSend: true })
  const results = await harness.dispatch([{ slotId: 'worker-1', text: 'needs an answer' }])
  assert(results[0].status === 'waiting_input', `the tool must report waiting_input, got ${results[0].status}`)
  assert(/not a failure/.test(results[0].note || ''), 'a question must never be reported as a failure')
  const waiting = await waitFor(() => { const job = harness.jobOf('m1', 'worker-1'); return job.status === 'waiting_input' ? job : null })
  assert(waiting.slotId === 'worker-1')
  await delay(200) // far past the window: waiting for an answer has no deadline of its own
  assert(harness.jobOf('m1', 'worker-1').status === 'waiting_input', 'a waiting question must not expire into a failure')
  harness.turns.set('w1', { active: true, status: 'running', waitingInput: false, turnId: 'turn-worker-1' })
  await waitFor(() => harness.jobOf('m1', 'worker-1').status === 'running')
  await harness.completeWorker('worker-1', 'completed')
  await waitFor(() => harness.jobOf('m1', 'worker-1').status === 'completed')
  assert(harness.sends.length === 1, 'the answered task is the same task, never resent')
  await harness.cleanup()
})

check('coordinator: a real provider failure keeps failed and its own error', async () => {
  const harness = await coordinatorHarness()
  const pending = harness.dispatch([{ slotId: 'worker-1', text: 'explode' }])
  await waitFor(() => harness.sends.length === 1)
  await harness.completeWorker('worker-1', 'failed', 'the provider exploded')
  const results = await pending
  assert(results[0].status === 'failed', `expected failed, got ${results[0].status}`)
  assert(results[0].error === 'the provider exploded', 'the real provider error must not be masked')
  await harness.cleanup()
})

check('coordinator: an explicit stop keeps interrupted', async () => {
  const harness = await coordinatorHarness()
  const pending = harness.dispatch([{ slotId: 'worker-1', text: 'stop' }])
  await waitFor(() => harness.sends.length === 1)
  await harness.completeWorker('worker-1', 'interrupted', 'OpenCode was stopped by the operator.')
  const results = await pending
  assert(results[0].status === 'interrupted', `expected interrupted, got ${results[0].status}`)
  await harness.cleanup()
})

check('coordinator: a lost follow keeps tracking_unknown and is never fabricated into failed', async () => {
  const harness = await coordinatorHarness()
  const pending = harness.dispatch([{ slotId: 'worker-1', text: 'silent' }])
  await waitFor(() => harness.sends.length === 1)
  await harness.completeWorker('worker-1', 'tracking_unknown', 'The follow was lost inside the window.')
  const results = await pending
  assert(results[0].status === 'tracking_unknown', `expected tracking_unknown, got ${results[0].status}`)
  const job = await waitFor(() => { const value = harness.jobOf('m1', 'worker-1'); return value.status === 'tracking_unknown' ? value : null })
  assert(/lost/.test(job.error), 'the follow loss must be recorded honestly')
  await harness.cleanup()
})

check('coordinator: the tool call ending does not cancel the work, and a restart never resends it', async () => {
  const harness = await coordinatorHarness({ responseDeadlineMs: 40 })
  const results = await harness.dispatch([{ slotId: 'worker-1', text: 'still working' }])
  assert(results[0].status === 'running', `the tool must return inside its own window, got ${results[0].status}`)
  assert(harness.sends.length === 1)
  // Restart while the desk is still busy: the uncertain job is marked interrupted and not resent.
  const restarted = new SuperAgentCoordinator(harness.directory, {}, { responseDeadlineMs: 40, pollIntervalMs: 5 })
  await restarted.ready
  const recovered = restarted.jobs.find(item => item.slotId === 'worker-1')
  assert(recovered.status === 'interrupted', `a job recovered on restart must be interrupted, got ${recovered.status}`)
  assert(/Not resent/.test(recovered.error), 'the recovery must state that nothing was resent')
  assert(harness.sends.length === 1, 'a restart must never resend')
  // Let the (still followed) desk settle so the suite exits on its own.
  await harness.completeWorker('worker-1', 'completed')
  await waitFor(() => harness.coordinator.active === 0)
  await harness.cleanup()
})

check('coordinator: the concurrency and background dispatch settings are preserved', async () => {
  const harness = await coordinatorHarness({ execution: { maxParallel: 4, dispatchMode: 'background' }, responseDeadlineMs: 60 })
  const receipt = await harness.dispatch(WORKER_SLOTS.map(slotId => ({ slotId, text: `task for ${slotId}` })))
  assert(receipt.status === 'accepted' && receipt.dispatchMode === 'background', 'background dispatch must stay an acknowledgement')
  assert(receipt.jobs.length === 4 && receipt.jobs.every(job => job.status === 'queued'), 'the receipt carries queued jobs, not replies')
  await waitFor(() => harness.sends.length === 4)
  for (const slotId of WORKER_SLOTS) await harness.completeWorker(slotId, 'completed')
  const report = await waitFor(() => { const value = harness.coordinator.report('team-1', receipt.batchId); return value.status === 'completed' ? value : null })
  assert(report.jobs.length === 4 && report.jobs.every(job => job.reply), 'the saved reports must hold every reply')
  await harness.cleanup()
})

check('coordinator: tasks queued past the tool window are released by the manager turn natural completion, never lost', async () => {
  const harness = await coordinatorHarness({ execution: { maxParallel: 2, dispatchMode: 'wait' }, responseDeadlineMs: 60 })
  const results = await harness.dispatch(WORKER_SLOTS.map(slotId => ({ slotId, text: `batch task for ${slotId}` })))
  assert(results.length === 4, 'every task of the batch must answer')
  assert(harness.sends.length === 2, `only the concurrency limit may be sent, got ${harness.sends.length}`)
  assert(results.filter(item => item.status === 'queued').length === 2, 'the extra tasks must be reported as queued, not failed')
  // The manager turn ends naturally: the already accepted batch still releases its queued tasks.
  harness.turns.set('mgr', { active: false, status: 'completed', turnId: 'mgr-turn' })
  harness.coordinator.complete('mgr', { id: 'mgr-turn', status: 'completed' })
  await harness.completeWorker('worker-1', 'completed')
  await harness.completeWorker('worker-2', 'completed')
  await waitFor(() => harness.sends.length === 4, { timeout: 6000 })
  await harness.completeWorker('worker-3', 'completed')
  await harness.completeWorker('worker-4', 'completed')
  const report = await waitFor(() => { const value = harness.coordinator.report('team-1'); return value.status === 'completed' ? value : null }, { timeout: 6000 })
  assert(report.jobs.length === 4 && report.jobs.every(job => job.status === 'completed'), 'no task of the batch may be lost')
  assert(harness.coordinator.reserved.size === 0 && harness.coordinator.active === 0, 'every slot and reservation must be released')
  await harness.cleanup()
})

check('coordinator: an expired tool response never overwrites a simultaneous final completion', async () => {
  const harness = await coordinatorHarness()
  let windows = 0
  harness.coordinator.withinWindow = async promise => {
    await promise
    return ++windows === 1 // model the follow finishing as its response deadline expires
  }
  const pending = harness.dispatch([{ slotId: 'worker-1', text: 'work' }])
  await waitFor(() => harness.sends.length === 1)
  await harness.completeWorker('worker-1', 'completed')
  await pending
  assert(harness.jobOf('m1', 'worker-1').status === 'completed', 'interim response cannot revert saved completion')
  assert(harness.coordinator.report('team-1').status === 'completed', 'the final report remains complete')
  await harness.cleanup()
})

check('coordinator: a reply transport error is tracking loss, not a provider execution failure', async () => {
  const harness = await coordinatorHarness()
  harness.coordinator.deps.reply = async () => { throw new Error('ECONNRESET reading reply') }
  const pending = harness.dispatch([{ slotId: 'worker-1', text: 'work' }])
  await waitFor(() => harness.sends.length === 1)
  await harness.completeWorker('worker-1', 'completed')
  const results = await pending
  assert(results[0].status === 'tracking_unknown', 'a failed read cannot establish failed execution')
  assert(harness.sends.length === 1, 'a failed read must not resend the task')
  await waitFor(() => harness.coordinator.active === 0)
  await harness.cleanup()
})

/* ----------------------------------------------------------------------------- runner ---- */

export async function runLongRunningChecks({ log = console.log } = {}) {
  const failures = []
  for (const item of checks) {
    try { await item.fn(); log(`  ok  ${item.name}`) }
    catch (error) { failures.push({ name: item.name, error }); log(`FAIL  ${item.name}: ${error.message}`) }
  }
  return { total: checks.length, failed: failures.length, failures }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invoked) {
  const result = await runLongRunningChecks()
  console.log(`${result.total - result.failed}/${result.total} checks passed`)
  if (result.failed) process.exitCode = 1
}
