import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MochiStore, MOCHI_LIMITS, DEFAULT_CONFIG } from '../server/mochi/store.mjs'
import { MochiRuntime } from '../server/mochi/runtime.mjs'

/**
 * Isolated checks for desk 1 (Mochi store + runtime).
 *
 * Everything runs against throwaway temp directories and stubbed dependencies:
 * no real provider/model call, no build, no browser, no application data.
 */

async function tempStore(options) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mochi-store-'))
  const store = new MochiStore(dir, options)
  await store.flush()
  return { dir, store, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function makeDeps() {
  const calls = { listTeams: 0, collect: 0, plan: 0, apply: 0 }
  const control = { teams: [{ id: 't1' }], events: [], proposal: null, applyResult: { ok: true, status: 'applied' } }
  const deps = {
    listTeams: async () => { calls.listTeams++; return control.teams },
    collect: async team => { calls.collect++; return typeof control.events === 'function' ? control.events(team) : control.events },
    plan: async (event, config) => { calls.plan++; return typeof control.proposal === 'function' ? control.proposal(event, config) : control.proposal },
    apply: async (proposal, config) => { calls.apply++; return typeof control.applyResult === 'function' ? control.applyResult(proposal, config) : control.applyResult },
  }
  return { calls, control, deps }
}

const newEvent = (sourceId, kind = 'question') => ({ teamId: 't1', slotId: 'worker-1', threadId: 'th', taskId: 'task', kind, sourceId, context: { field: 'choice', options: ['a', 'b'] } })

const tests = []
const test = (name, run) => tests.push([name, run])

test('defaults are disabled + suggest; fallback validation is conservative and never grants flags', async () => {
  const { dir, store, cleanup } = await tempStore()
  try {
    assert.deepEqual((await store.get('t1')).config, DEFAULT_CONFIG)
    await assert.rejects(() => store.configure('t1', { enabled: true }), /model/i)
    await assert.rejects(() => store.configure('t1', { nope: 1 }), /unknown/i)
    const config = await store.configure('t1', { enabled: true, model: 'opencode/x' })
    assert.equal(config.enabled, true)
    assert.equal(config.mode, 'suggest')
    assert.equal(config.autoAnswer, false)
    assert.equal(config.autoResume, false)
    assert.equal(config.autoApproveTools, false)
    await store.flush()
  } finally { await cleanup() }
})

test('an injected policy validator replaces the fallback', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mochi-store-'))
  try {
    let called = 0
    const store = new MochiStore(dir, { validateConfig: (patch, current) => { called++; return { config: { ...current, ...patch }, errors: [] } } })
    await store.flush()
    const config = await store.configure('t1', { enabled: true, model: 'opencode/x' })
    assert.equal(called, 1)
    assert.equal(config.enabled, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('event identity is durable and de-duplicated across ids', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const event = { teamId: 't1', slotId: 'worker-1', threadId: 'th', taskId: 'task', kind: 'question', sourceId: 'q1', context: { prompt: 'pick one' } }
    const first = await store.putEvent(event)
    const second = await store.putEvent({ ...event, id: 'a-different-id' })
    assert.equal(first.added, true)
    assert.equal(second.added, false)
    assert.equal(second.key, first.key)
    const record = await store.get('t1')
    assert.equal(record.events.length, 1)
    assert.equal(record.events[0].key, first.key)
    assert.equal(record.seen[first.key].status, 'new')
  } finally { await cleanup() }
})

test('records stay bounded (events, proposals, log)', async () => {
  const { store, cleanup } = await tempStore()
  try {
    for (let i = 0; i < MOCHI_LIMITS.events + 50; i++) await store.putEvent({ teamId: 't1', slotId: 'w', threadId: 'th', taskId: 't', kind: 'failed', sourceId: `s${i}` })
    assert.ok((await store.get('t1')).events.length <= MOCHI_LIMITS.events, 'events bounded')
    for (let i = 0; i < MOCHI_LIMITS.proposals + 40; i++) await store.putProposal({ teamId: 't1', eventId: `e${i}`, eventKey: `k${i}`, kind: 'answer_question', reason: 'r' })
    assert.ok((await store.get('t1')).proposals.length <= MOCHI_LIMITS.proposals, 'proposals bounded')
    for (let i = 0; i < MOCHI_LIMITS.log + 30; i++) await store.appendLog('t1', { message: `m${i}` })
    assert.ok((await store.get('t1')).log.length <= MOCHI_LIMITS.log, 'log bounded')
  } finally { await cleanup() }
})

test('persistence is atomic and a crash-interrupted event is restored as failed (no replay)', async () => {
  const { dir, store, cleanup } = await tempStore()
  try {
    await store.configure('t1', { enabled: true, model: 'opencode/x' })
    const put = await store.putEvent(newEvent('q1'))
    await store.markEvent('t1', put.key, { status: 'processing', attempts: 1 })
    await store.flush()

    const reloaded = new MochiStore(dir)
    await reloaded.flush()
    const record = await reloaded.get('t1')
    assert.equal(record.config.enabled, true)
    const restored = record.events.find(item => item.key === put.key)
    assert.equal(restored.status, 'failed')
    assert.equal(restored.lastError, 'interrupted')

    const names = await readdir(dir)
    assert.ok(names.length > 0 && names.every(name => name.endsWith('.json')), 'only atomically renamed profiles remain')
  } finally { await cleanup() }
})

test('disabled / provider / archive gates stop before collect or model', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps, { now: () => 1000 })

    // disabled by default
    assert.equal((await runtime.tick('t1')).runtime.state, 'disabled')
    assert.equal(calls.collect, 0)
    assert.equal(calls.plan, 0)

    // enabled but provider unavailable -> blocked, still no work
    await store.configure('t1', { enabled: true, model: 'opencode/x' })
    const gated = new MochiRuntime(store, { ...deps, providerAvailable: () => false }, { now: () => 1000 })
    const blocked = await gated.tick('t1')
    assert.equal(blocked.runtime.state, 'blocked')
    assert.equal(blocked.runtime.error, 'provider_unavailable')
    assert.equal(calls.collect, 0)

    // archived -> disabled
    control.teams = [{ id: 't1', archived: true }]
    assert.equal((await runtime.tick('t1')).runtime.state, 'disabled')
    assert.equal(calls.collect, 0)
  } finally { await cleanup() }
})

test('polling/snapshot never calls a model', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps)
    await store.configure('t1', { enabled: true, model: 'opencode/x' })
    await runtime.snapshot('t1')
    await runtime.snapshot('t1')
    assert.equal(calls.plan, 0)
    assert.equal(calls.collect, 0)
  } finally { await cleanup() }
})

test('suggest mode only creates a pending proposal and never applies', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps)
    await store.configure('t1', { enabled: true, model: 'opencode/x', mode: 'suggest' })
    control.events = [newEvent('q1')]
    control.proposal = { kind: 'answer_question', answer: { field: 'a' }, reason: 'deterministic' }

    const snapshot = await runtime.tick('t1')
    assert.equal(calls.plan, 1, 'model planned exactly once')
    assert.equal(calls.apply, 0, 'suggest never applies')
    assert.equal(snapshot.proposals.length, 1)
    assert.equal(snapshot.proposals[0].status, 'pending')
    assert.equal(snapshot.runtime.state, 'waiting_user')
  } finally { await cleanup() }
})

test('automatic mode applies only with the matching explicit flag', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps)
    await store.configure('t1', { enabled: true, model: 'opencode/x', mode: 'automatic' })
    control.proposal = { kind: 'answer_question', answer: { field: 'a' }, reason: 'ok' }

    control.events = [newEvent('q1')]
    let snapshot = await runtime.tick('t1')
    assert.equal(calls.apply, 0, 'flag off -> still only a proposal')
    assert.equal(snapshot.proposals.find(item => item.eventId)?.status, 'pending')

    await store.configure('t1', { autoAnswer: true })
    control.events = [newEvent('q2')]
    snapshot = await runtime.tick('t1')
    assert.equal(calls.apply, 1, 'flag on -> real apply path once')
    assert.ok(snapshot.proposals.some(item => item.status === 'applied'))
  } finally { await cleanup() }
})

test('escalation is never applied automatically even with all flags on', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps)
    await store.configure('t1', { enabled: true, model: 'opencode/x', mode: 'automatic', autoAnswer: true, autoResume: true, autoApproveTools: true })
    control.events = [newEvent('q1', 'failed')]
    control.proposal = { kind: 'escalate', reason: 'unsafe to decide' }
    const snapshot = await runtime.tick('t1')
    assert.equal(calls.apply, 0)
    assert.equal(snapshot.proposals[0].kind, 'escalate')
    assert.equal(snapshot.proposals[0].status, 'pending')
  } finally { await cleanup() }
})

test('tick is single-flight and an event is planned at most once', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps)
    await store.configure('t1', { enabled: true, model: 'opencode/x' })
    control.events = [newEvent('q1')]
    control.proposal = { kind: 'answer_question', reason: 'r' }

    const first = runtime.tick('t1')
    const second = runtime.tick('t1')
    assert.equal(first, second, 'concurrent callers share one run')
    await first
    assert.equal(calls.plan, 1)

    await runtime.tick('t1')
    assert.equal(calls.plan, 1, 'a processed event is never re-planned')
  } finally { await cleanup() }
})

test('plan failures back off with explicit bounds and stop after max attempts', async () => {
  const { store, cleanup } = await tempStore()
  try {
    let clock = 10_000
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps, { now: () => clock })
    await store.configure('t1', { enabled: true, model: 'opencode/x' })
    control.events = [newEvent('f1', 'failed')]
    control.proposal = () => { throw new Error('boom') }

    await runtime.tick('t1')
    let event = (await store.get('t1')).events[0]
    assert.equal(event.status, 'new')
    assert.equal(event.attempts, 1)
    assert.ok(event.notBefore > clock, 'first failure schedules a backoff')

    const plansAfterFirst = calls.plan
    await runtime.tick('t1')
    assert.equal(calls.plan, plansAfterFirst, 'notBefore gates an immediate retry')

    clock = event.notBefore + 1
    await runtime.tick('t1')
    event = (await store.get('t1')).events[0]
    assert.equal(event.attempts, 2)

    clock = event.notBefore + 1
    await runtime.tick('t1')
    event = (await store.get('t1')).events[0]
    assert.equal(event.status, 'failed', 'third attempt gives up')
    const plansAtFail = calls.plan

    clock += 10 * 60 * 1000
    await runtime.tick('t1')
    assert.equal(calls.plan, plansAtFail, 'a failed event is never retried')
  } finally { await cleanup() }
})

test('start arms the timer without an immediate tick; stop is clean and idempotent', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const { calls, control, deps } = makeDeps()
    const runtime = new MochiRuntime(store, deps, { intervalMs: 15_000 })
    await store.configure('t1', { enabled: true, model: 'opencode/x' })
    control.events = [newEvent('q1')]
    control.proposal = { kind: 'answer_question', reason: 'r' }

    runtime.start()
    assert.ok(runtime.timer, 'timer armed')
    assert.equal(calls.collect, 0, 'startup does not collect/replay')

    runtime.start()
    assert.ok(runtime.timer)

    runtime.stop()
    assert.equal(runtime.timer, null)
    runtime.stop()
    assert.equal(runtime.timer, null)
  } finally { await cleanup() }
})

let passed = 0
try {
  for (const [name, run] of tests) {
    await run()
    passed++
    console.log(`  ok - ${name}`)
  }
  console.log(`Passed: Mochi desk-1 store/runtime (${passed} scenarios): defaults, dedup, bounds, atomic+restart, disable/provider/archive gates, no model on poll, no apply in suggest, automatic flag gating, escalate safety, single-flight/once-per-event, bounded backoff, clean start/stop. No real provider, no build, no application data touched.`)
} catch (error) {
  console.error('Failed:', error && error.stack ? error.stack : error)
  process.exitCode = 1
}
