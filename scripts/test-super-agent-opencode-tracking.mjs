import assert from 'node:assert/strict'
import { SuperAgentOpenCode } from '../server/super-agent-opencode.mjs'

/**
 * Independent regression checks for OpenCode task tracking (turn correlation).
 *
 * - Tests outputs and integrity only; never mirrors implementation internals.
 * - Every scenario uses a synthetic in-memory API: no network, no real OpenCode
 *   provider, no AI calls, no license, no browser, no real files.
 * - Short time bounds on every scenario; each scenario runs on a fresh adapter.
 *
 * Usage:
 *   node scripts/test-super-agent-opencode-tracking.mjs      # production adapter (default)
 *   # one-off review command, not committed:
 *   node -e "import { runTrackingChecks } from './scripts/test-super-agent-opencode-tracking.mjs';
 *            import { SuperAgentOpenCode as Candidate } from '../.relay-state/reviews/opencode-tracking-FS6ENy/super-agent-opencode.mjs';
 *            runTrackingChecks(Candidate)"
 */

const EXPECTED = 'track-this-exact-request'
const SLEEP = ms => new Promise(resolve => setTimeout(resolve, ms))

const withTimeout = (promise, ms) => {
  let timer
  const race = Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`scenario exceeded ${ms}ms`)), ms) }),
  ])
  return race.finally(() => clearTimeout(timer))
}

/**
 * Wait until the session's turn leaves the running state, bounded in time.
 * Turns are keyed by session id in the adapter, so `id` must be the session id.
 */
const awaitTurn = (adapter, sessionId, ms = 3000) => withTimeout(new Promise(resolve => {
  const check = () => {
    const turn = adapter.turn(sessionId)
    if (!turn.active && turn.status) return resolve(turn)
    setTimeout(check, 2)
  }
  check()
}), ms)

/**
 * Synthetic session transport.
 * One snapshot is consumed per read cycle (the `message` endpoint is always the
 * first of the four parallel `read()` calls, so inbox/form/answer see the same
 * snapshot of that cycle). When the queue is exhausted the last snapshot repeats.
 */
function makeSessions({ failMessageIds = new Set() } = {}) {
  const queues = new Map()
  const calls = []
  const interrupts = []
  const failedIds = new Set()
  const pending = new Map() // session id -> snapshot of the current read cycle

  const api = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body })
    if (endpoint === '/api/session/active') return { data: {} }
    const m = endpoint.match(/^\/api\/session\/([^/]+)\/(message|inbox|form|prompt|interrupt)$/)
    if (!m) throw new Error(`unexpected call ${method} ${endpoint}`)
    const [, id, action] = m
    const queue = queues.get(id) || []

    if (action === 'prompt') {
      assert.equal(body.delivery, 'queue')
      return { data: { id: `receipt-${id}`, sessionID: id, delivery: 'queue' } }
    }
    if (action === 'interrupt') { interrupts.push(id); return null }
    if (action === 'message') {
      if (failMessageIds.has(id) && !failedIds.has(id)) {
        failedIds.add(id)
        throw new Error('transient snapshot failure')
      }
      const snap = queue.length ? queue.shift() : (queue[queue.length - 1] || {})
      const shared = {
        messages: snap.messages ?? [],
        inbox: snap.inbox ?? [],
        forms: snap.forms ?? [],
        active: snap.active ?? false,
      }
      pending.set(id, shared)
      return { data: shared.messages }
    }
    const shared = pending.get(id) || { messages: [], inbox: [], forms: [], active: false }
    if (action === 'inbox') return { data: shared.inbox }
    if (action === 'form') return { data: shared.forms }
    throw new Error(`unexpected action ${action}`)
  }

  return { api, queues, calls, interrupts }
}

export async function runTrackingChecks(Adapter = SuperAgentOpenCode) {
  const failures = []
  const runs = []

  const scenario = (name, fn) => runs.push({ name, fn })

  /* ---------- scenarios ---------- */

  scenario('happy path: confirmed request then a linked reply completes the turn', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-happy'
    queues.set(session, [
      { messages: [{ id: 'u-h', type: 'user', text: EXPECTED }], active: false },
      { messages: [{ id: 'u-h', type: 'user', text: EXPECTED }, { id: 'r-h', type: 'assistant', parentID: 'u-h', text: 'hello world' }], active: false },
      { messages: [{ id: 'u-h', type: 'user', text: EXPECTED }, { id: 'r-h', type: 'assistant', parentID: 'u-h', text: 'hello world' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'hello world')
  })

  scenario('queue before the correct user appears: late text is registered, no early fail', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-late'
    const other = { id: 'u-other', type: 'user', text: 'something else' }
    queues.set(session, [
      { messages: [other], active: false },
      { messages: [other, { id: 'u1', type: 'user', text: EXPECTED }], active: false },
      { messages: [other, { id: 'u1', type: 'user', text: EXPECTED }, { id: 'r1', type: 'assistant', parentID: 'u1', text: 'registered late' }], active: false },
      { messages: [other, { id: 'u1', type: 'user', text: EXPECTED }, { id: 'r1', type: 'assistant', parentID: 'u1', text: 'registered late' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'registered late')
  })

  scenario('transient snapshot mismatch while natively active must not fail the turn', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-noise'
    const noise = { id: 'uX', type: 'user', text: 'native noise while working' }
    queues.set(session, [
      { messages: [noise], active: true },
      { messages: [noise, { id: 'u2', type: 'user', text: EXPECTED }], active: false },
      { messages: [noise, { id: 'u2', type: 'user', text: EXPECTED }, { id: 'r2', type: 'assistant', parentID: 'u2', text: 'after noise' }], active: false },
      { messages: [noise, { id: 'u2', type: 'user', text: EXPECTED }, { id: 'r2', type: 'assistant', parentID: 'u2', text: 'after noise' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'after noise')
  })

  scenario('pinned user leaves the 50-message window and the linked reply arrives late', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 3, timeout: 5000 })
    const session = 's-slide'
    const baseline = { messages: Array.from({ length: 48 }, (_, i) => ({ id: `old-${i + 1}`, type: 'assistant', text: `old ${i + 1}` })) }
    queues.set(session, [
      { messages: [...baseline.messages, { id: 'u3', type: 'user', text: EXPECTED }], active: false },
      { messages: baseline.messages, active: false },   // u3 slid out of the visible window
      { messages: baseline.messages, active: false },
      { messages: baseline.messages, active: false },
      { messages: baseline.messages, active: false },
      { messages: [...baseline.messages, { id: 'r3', type: 'assistant', parentID: 'u3', text: 'late after slide' }], active: false },
      { messages: [...baseline.messages, { id: 'r3', type: 'assistant', parentID: 'u3', text: 'late after slide' }], active: false },
    ])
    await adapter.send(session, EXPECTED, baseline)
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'late after slide')
  })

  scenario('same assistant id: empty text, then partial, then final', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-settle'
    const base = [{ id: 'u4', type: 'user', text: EXPECTED }]
    queues.set(session, [
      { messages: base, active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u4', text: '' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u4', text: 'part' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u4', text: 'part final' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u4', text: 'part final' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'part final')
  })

  scenario('reply/error or info.error must not record success even when there is text', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 3000 })
    const base = [{ id: 'u5', type: 'user', text: EXPECTED }]
    queues.set('s-error', [
      { messages: base, active: false },
      { messages: [...base, { id: 'r5', type: 'assistant', parentID: 'u5', text: 'looks like a reply', error: true }], active: false },
      { messages: [...base, { id: 'r5', type: 'assistant', parentID: 'u5', text: 'looks like a reply', error: true }], active: false },
      { messages: [...base, { id: 'r5', type: 'assistant', parentID: 'u5', text: 'looks like a reply', error: true }], active: false },
    ])
    queues.set('s-info-error', [
      { messages: base, active: false },
      { messages: [...base, { id: 'r5b', type: 'assistant', parentID: 'u5', text: 'x', info: { error: 'boom' } }], active: false },
      { messages: [...base, { id: 'r5b', type: 'assistant', parentID: 'u5', text: 'x', info: { error: 'boom' } }], active: false },
    ])
    for (const session of ['s-error', 's-info-error']) {
      await adapter.send(session, EXPECTED, { messages: [] })
      const turn = await awaitTurn(adapter, session, 2500)
      assert.notEqual(turn.status, 'completed', `${session}: an assistant message carrying error must not complete the turn`)
    }
    assert.equal(results.filter(r => r.status === 'completed').length, 0, 'no reply must be stored for an errored response')
  })

  scenario('several identical-text requests are not merged into one task', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const first = [{ id: 'ua', type: 'user', text: EXPECTED }]
    const second = [{ id: 'ub', type: 'user', text: EXPECTED }]
    queues.set('s-a', [
      { messages: first, active: false },
      { messages: [...first, { id: 'ra', type: 'assistant', parentID: 'ua', text: 'reply A' }], active: false },
      { messages: [...first, { id: 'ra', type: 'assistant', parentID: 'ua', text: 'reply A' }], active: false },
    ])
    queues.set('s-b', [
      { messages: second, active: false },
      { messages: [...second, { id: 'rb', type: 'assistant', parentID: 'ub', text: 'reply B' }], active: false },
      { messages: [...second, { id: 'rb', type: 'assistant', parentID: 'ub', text: 'reply B' }], active: false },
    ])
    await adapter.send('s-a', EXPECTED, { messages: [] })
    await adapter.send('s-b', EXPECTED, { messages: [] })
    await awaitTurn(adapter, 's-a')
    await awaitTurn(adapter, 's-b')
    const turnA = results.find(r => r.sessionId === 's-a')
    const turnB = results.find(r => r.sessionId === 's-b')
    assert.equal(turnA.status, 'completed')
    assert.equal(turnB.status, 'completed')
    assert.equal(adapter.replies.get(`s-a:${turnA.turnId}`), 'reply A')
    assert.equal(adapter.replies.get(`s-b:${turnB.turnId}`), 'reply B')
    assert.notEqual(adapter.replies.get(`s-a:${turnA.turnId}`), adapter.replies.get(`s-b:${turnB.turnId}`))
  })

  scenario('parent chain and newestFirst order do not reverse reply order (newest first)', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-newest'
    const u7 = { id: 'u7', type: 'user', text: EXPECTED }
    const newestFirst = [
      u7,
      { id: 'a3', type: 'assistant', parentID: 'a2', text: 't3' },
      { id: 'a2', type: 'assistant', parentID: 'a1', text: 't2' },
      { id: 'a1', type: 'assistant', parentID: 'u7', text: 't1' },
    ]
    queues.set(session, [
      { messages: newestFirst, active: false },
      { messages: newestFirst, active: false },
      { messages: newestFirst, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 't1\n\nt2\n\nt3')
  })

  scenario('parent chain and newestFirst order do not reverse reply order (oldest first)', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-oldest'
    const u7 = { id: 'u7', type: 'user', text: EXPECTED }
    const oldestFirst = [
      u7,
      { id: 'a1', type: 'assistant', parentID: 'u7', text: 't1' },
      { id: 'a2', type: 'assistant', parentID: 'a1', text: 't2' },
      { id: 'a3', type: 'assistant', parentID: 'a2', text: 't3' },
    ]
    queues.set(session, [
      { messages: oldestFirst, active: false },
      { messages: oldestFirst, active: false },
      { messages: oldestFirst, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 't1\n\nt2\n\nt3')
  })

  scenario('a genuine other request is not confused with ours', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-foreign'
    const foreign = { id: 'uF', type: 'user', text: 'foreign request' }
    queues.set(session, [
      { messages: [foreign], active: false },
      { messages: [foreign, { id: 'u8', type: 'user', text: EXPECTED }], active: false },
      { messages: [foreign, { id: 'u8', type: 'user', text: EXPECTED }, { id: 'fake', type: 'assistant', text: 'fake reply' }], active: false },
      { messages: [foreign, { id: 'u8', type: 'user', text: EXPECTED }, { id: 'real', type: 'assistant', parentID: 'u8', text: 'real reply' }], active: false },
      { messages: [foreign, { id: 'u8', type: 'user', text: EXPECTED }, { id: 'real', type: 'assistant', parentID: 'u8', text: 'real reply' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'real reply')
  })

  scenario('baseline old response is excluded', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-baseline'
    const baseline = {
      messages: [
        { id: 'old-u', type: 'user', text: 'OLD REQUEST' },
        { id: 'old-r', type: 'assistant', text: 'OLD ANSWER' },
      ],
    }
    queues.set(session, [
      { messages: [...baseline.messages, { id: 'u9', type: 'user', text: EXPECTED }], active: false },
      { messages: [...baseline.messages, { id: 'u9', type: 'user', text: EXPECTED }, { id: 'r9', type: 'assistant', parentID: 'u9', text: 'REAL ANSWER' }], active: false },
      { messages: [...baseline.messages, { id: 'u9', type: 'user', text: EXPECTED }, { id: 'r9', type: 'assistant', parentID: 'u9', text: 'REAL ANSWER' }], active: false },
    ])
    await adapter.send(session, EXPECTED, baseline)
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'REAL ANSWER')
  })

  scenario('transient snapshot failure recovers only after a confirmed reply, without resend', async () => {
    const { api, queues, calls } = makeSessions({ failMessageIds: new Set(['s10']) })
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's10'
    queues.set(session, [
      { messages: [{ id: 'u10', type: 'user', text: EXPECTED }], active: false },
      { messages: [{ id: 'u10', type: 'user', text: EXPECTED }, { id: 'r10', type: 'assistant', parentID: 'u10', text: 'after failure' }], active: false },
      { messages: [{ id: 'u10', type: 'user', text: EXPECTED }, { id: 'r10', type: 'assistant', parentID: 'u10', text: 'after failure' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.id}`), 'after failure')
    assert.ok(calls.filter(call => call.endpoint?.endsWith('/message')).length >= 3, 'completion requires successful reads after the failed read')
    assert.equal(results.filter(r => r.status === 'completed').length, 1)
    assert.equal(calls.filter(call => call.endpoint?.endsWith('/prompt')).length, 1, 'no resend after a transient failure')
  })

  scenario('text / content / parts message shapes are all read', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    queues.set('s-a', [
      { messages: [{ id: 'ua', type: 'user', content: [{ type: 'text', text: EXPECTED }] }], active: false },
      { messages: [
        { id: 'ua', type: 'user', content: [{ type: 'text', text: EXPECTED }] },
        { id: 'ra', type: 'assistant', parentID: 'ua', content: [{ type: 'text', text: 'rA' }] },
      ], active: false },
      { messages: [
        { id: 'ua', type: 'user', content: [{ type: 'text', text: EXPECTED }] },
        { id: 'ra', type: 'assistant', parentID: 'ua', content: [{ type: 'text', text: 'rA' }] },
      ], active: false },
    ])
    queues.set('s-b', [
      { messages: [{ id: 'ub', type: 'user', parts: [{ type: 'text', text: EXPECTED }] }], active: false },
      { messages: [
        { id: 'ub', type: 'user', parts: [{ type: 'text', text: EXPECTED }] },
        { id: 'rb', type: 'assistant', parentID: 'ub', text: 'rB' },
      ], active: false },
      { messages: [
        { id: 'ub', type: 'user', parts: [{ type: 'text', text: EXPECTED }] },
        { id: 'rb', type: 'assistant', parentID: 'ub', text: 'rB' },
      ], active: false },
    ])
    await adapter.send('s-a', EXPECTED, { messages: [] })
    await adapter.send('s-b', EXPECTED, { messages: [] })
    await awaitTurn(adapter, 's-a')
    await awaitTurn(adapter, 's-b')
    const turnA = results.find(r => r.sessionId === 's-a')
    const turnB = results.find(r => r.sessionId === 's-b')
    assert.equal(turnA.status, 'completed')
    assert.equal(turnB.status, 'completed')
    assert.equal(adapter.replies.get(`s-a:${turnA.turnId}`), 'rA')
    assert.equal(adapter.replies.get(`s-b:${turnB.turnId}`), 'rB')
  })

  scenario('stop (cancel) interrupts once, does not resend, and does not stop another turn', async () => {
    const { api, queues, calls, interrupts } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const baseA = [{ id: 'uA', type: 'user', text: EXPECTED }]
    const baseB = [{ id: 'uB', type: 'user', text: EXPECTED }]
    queues.set('s-ca', [
      { messages: baseA, active: false },
      { messages: [...baseA, { id: 'rA', type: 'assistant', parentID: 'uA', text: 'must never arrive' }], active: false },
      { messages: [...baseA, { id: 'rA', type: 'assistant', parentID: 'uA', text: 'must never arrive' }], active: false },
    ])
    queues.set('s-cb', [
      { messages: baseB, active: false },
      { messages: [...baseB, { id: 'rB', type: 'assistant', parentID: 'uB', text: 'B arrives' }], active: false },
      { messages: [...baseB, { id: 'rB', type: 'assistant', parentID: 'uB', text: 'B arrives' }], active: false },
    ])
    await adapter.send('s-ca', EXPECTED, { messages: [] })
    await adapter.send('s-cb', EXPECTED, { messages: [] })
    await adapter.stop('s-ca')
    await awaitTurn(adapter, 's-ca')
    await awaitTurn(adapter, 's-cb')
    const turnA = results.find(r => r.sessionId === 's-ca')
    const turnB = results.find(r => r.sessionId === 's-cb')
    assert.equal(turnA.status, 'interrupted')
    assert.equal(turnB.status, 'completed')
    assert.equal(adapter.replies.get(`s-cb:${turnB.turnId}`), 'B arrives')
    assert.deepEqual(interrupts, ['s-ca'], 'exactly one interrupt, for the stopped session only')
    assert.equal(calls.filter(call => call.endpoint?.endsWith('/prompt')).length, 2, 'no resend')
  })

  scenario('timeout does not resend and leaves no reply', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 5, timeout: 50 })
    const session = 's-t'
    queues.set(session, [
      { messages: [{ id: 'uT', type: 'user', text: 'wrong text that never matches' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session, 3000)
    assert.notEqual(turn.status, 'completed')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(calls.filter(call => call.endpoint?.endsWith('/prompt')).length, 1, 'no resend at timeout')
  })

  scenario('same session, identical twin user after our pinned request: our own linked reply completes, never merged', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-twinA'
    const ours = { id: 'u-ours', type: 'user', text: EXPECTED }
    const twin = { id: 'u-twin', type: 'user', text: EXPECTED }
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: [twin, ours, { id: 'rr', type: 'assistant', parentID: 'u-ours', text: 'real reply' }], active: false },
      { messages: [twin, ours, { id: 'rr', type: 'assistant', parentID: 'u-ours', text: 'real reply' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'real reply')
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('same session, two identical-text requests and no identity evidence: never merged, honest failure, no resend', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 90 })
    const session = 's-twinB'
    queues.set(session, [
      { messages: [{ id: 'u-ours', type: 'user', text: EXPECTED }, { id: 'u-twin', type: 'user', text: EXPECTED }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1, 'no resend on ambiguity')
  })

  scenario('same session, two identical-text candidates and one reply: no success without receipt-provable identity', async () => {
    // Our single queued receipt cannot bind two look-alike user ids. A reply whose parent
    // is one of them may belong to the other task, so completing would attribute a reply
    // we can not prove is ours. The turn must not complete on that evidence alone.
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-twinC'
    const ours = { id: 'u-ours', type: 'user', text: EXPECTED }
    const twin = { id: 'u-twin', type: 'user', text: EXPECTED }
    queues.set(session, [
      { messages: [ours, twin], active: false },
      { messages: [ours, twin, { id: 'r-twin', type: 'assistant', parentID: 'u-twin', text: 'twin reply' }], active: false },
      { messages: [ours, twin, { id: 'r-twin', type: 'assistant', parentID: 'u-twin', text: 'twin reply' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'a reply that cannot be receipt-bound to our request must not record success')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
  })

  scenario('same session, two identical-text candidates and replies to both in one poll: explicit mixing failure', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-twinD'
    const ours = { id: 'u-ours', type: 'user', text: EXPECTED }
    const twin = { id: 'u-twin', type: 'user', text: EXPECTED }
    queues.set(session, [
      { messages: [
        ours, twin,
        { id: 'r-ours', type: 'assistant', parentID: 'u-ours', text: 'r1' },
        { id: 'r-twin', type: 'assistant', parentID: 'u-twin', text: 'r2' },
      ], active: false },
      { messages: [
        ours, twin,
        { id: 'r-ours', type: 'assistant', parentID: 'u-ours', text: 'r1' },
        { id: 'r-twin', type: 'assistant', parentID: 'u-twin', text: 'r2' },
      ], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'two replies binding two identical candidates is mixing, never a merged success')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(adapter.replies.size, 0)
  })

  scenario('same session, a different-text foreign user after our pin stays a honest failure', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-twinE'
    const ours = { id: 'u-ours', type: 'user', text: EXPECTED }
    const foreign = { id: 'u-foreign', type: 'user', text: 'a different genuine request' }
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: [ours, foreign, { id: 'rr', type: 'assistant', parentID: 'u-ours', text: 'real reply' }], active: false },
      { messages: [ours, foreign, { id: 'rr', type: 'assistant', parentID: 'u-ours', text: 'real reply' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'a foreign request next to ours is mixing, never success')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('a late error on the same assistant id after a partial text is rejected, never success', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-late-error'
    const base = [{ id: 'u5', type: 'user', text: EXPECTED }]
    queues.set(session, [
      { messages: base, active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: 'part' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: 'part final', error: true }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: 'part final', error: true }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'a late error must cancel the partial success')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(adapter.replies.size, 0)
  })

  scenario('a sticky error whose field is later dropped still ends failed, never success', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-sticky'
    const base = [{ id: 'u5', type: 'user', text: EXPECTED }]
    queues.set(session, [
      { messages: base, active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: '', error: true }], active: true },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: 'now clean' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: 'now clean' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', parentID: 'u5', text: 'now clean' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'dropping the error field later must not resurrect the turn as success')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(adapter.replies.size, 0)
  })

  scenario('the parent link on the same assistant id updates across snapshots', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-parent'
    const base = [{ id: 'u4', type: 'user', text: EXPECTED }]
    queues.set(session, [
      { messages: base, active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', text: '' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', text: '', parentID: 'u4' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', text: 'settled reply', parentID: 'u4' }], active: false },
      { messages: [...base, { id: 'a1', type: 'assistant', text: 'settled reply', parentID: 'u4' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'settled reply')
  })

  scenario('reply chain arriving out of order across polls keeps text order', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-chain-spread'
    const ours = { id: 'u7', type: 'user', text: EXPECTED }
    const a1 = { id: 'a1', type: 'assistant', parentID: 'u7', text: 't1' }
    const a3 = { id: 'a3', type: 'assistant', parentID: 'a2', text: 't3' }
    const a2 = { id: 'a2', type: 'assistant', parentID: 'a1', text: 't2' }
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: [ours, a1], active: false },
      { messages: [ours, a1, a3], active: false },
      { messages: [ours, a1, a3, a2], active: false },
      { messages: [ours, a1, a3, a2], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 't1\n\nt2\n\nt3')
  })

  scenario('a 50-message window with our request and linked reply is fully read', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-window50'
    const baseline = { messages: Array.from({ length: 48 }, (_, i) => ({ id: `old-${i + 1}`, type: 'assistant', text: `old ${i + 1}` })) }
    queues.set(session, [
      { messages: [...baseline.messages, { id: 'u9', type: 'user', text: EXPECTED }], active: false },                                 // 49
      { messages: [...baseline.messages, { id: 'u9', type: 'user', text: EXPECTED }, { id: 'r9', type: 'assistant', parentID: 'u9', text: 'REAL ANSWER' }], active: false }, // 50
      { messages: [...baseline.messages, { id: 'u9', type: 'user', text: EXPECTED }, { id: 'r9', type: 'assistant', parentID: 'u9', text: 'REAL ANSWER' }], active: false },
    ])
    await adapter.send(session, EXPECTED, baseline)
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed')
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'REAL ANSWER')
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('parentless assistant text right after our request never completes without linkage evidence', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 's-parentless'
    const base = [{ id: 'u5', type: 'user', text: EXPECTED }]
    queues.set(session, [
      { messages: base, active: false },
      { messages: [...base, { id: 'r5', type: 'assistant', text: 'unlinked text' }], active: false },
      { messages: [...base, { id: 'r5', type: 'assistant', text: 'unlinked text' }], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'a parentless assistant text beside our request does not prove ownership')
    assert.equal(results.filter(r => r.status === 'completed').length, 0)
    assert.equal(adapter.replies.size, 0)
  })

  scenario('memory bounds: a bounded flood keeps tracking, an overflowing bound never records a wrong or foreign success', async () => {
    // Below the bound: 1000 fresh filler assistants (parented to an unknown id so no
    // implementation may mistake them for replies) must not break our own linkage.
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const fillers = count => Array.from({ length: count }, (_, i) => ({ id: `flood-${i}`, type: 'assistant', parentID: 'no-such-parent', text: 'noise' }))
    const base = [{ id: 'u10', type: 'user', text: EXPECTED }]
    queues.set('s-bounded', [
      { messages: base, active: true },
      { messages: [...base, ...fillers(1000)], active: false },
      { messages: [...base, ...fillers(1000), { id: 'r10', type: 'assistant', parentID: 'u10', text: 'late reply' }], active: false },
      { messages: [...base, ...fillers(1000), { id: 'r10', type: 'assistant', parentID: 'u10', text: 'late reply' }], active: false },
    ])
    await adapter.send('s-bounded', EXPECTED, { messages: [] })
    await awaitTurn(adapter, 's-bounded')
    const bounded = results.find(r => r.sessionId === 's-bounded')
    assert.equal(bounded.status, 'completed', 'a flood below the bound must not break the link to our own reply')
    assert.equal(adapter.replies.get(`s-bounded:${bounded.turnId}`), 'late reply')

    // Over the bound: once the turn-local buffer is full, a late reply may be unverifiable,
    // but that must stay an honest failure — never success with wrong or merged text.
    const overflow = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const overflowBase = [{ id: 'u-of', type: 'user', text: EXPECTED }, ...fillers2(4000)]
    function fillers2(count) { return Array.from({ length: count }, (_, i) => ({ id: `pre-${i}`, type: 'assistant', parentID: 'no-such-parent', text: 'noise' })) }
    queues.set('s-overflow', [
      { messages: overflowBase, active: true },
      { messages: [...overflowBase, ...fillers2(4000)], active: false },
      { messages: [...overflowBase, ...fillers2(4000), { id: 'r-of', type: 'assistant', parentID: 'u-of', text: 'late reply' }], active: false },
      { messages: [...overflowBase, ...fillers2(4000), { id: 'r-of', type: 'assistant', parentID: 'u-of', text: 'late reply' }], active: false },
    ])
    await overflow.send('s-overflow', EXPECTED, { messages: [] })
    const turn = await awaitTurn(overflow, 's-overflow')
    const replyText = overflow.replies.get(`s-overflow:${results.find(r => r.sessionId === 's-overflow')?.turnId}`)
    if (turn.status === 'completed') assert.equal(replyText, 'late reply')
    else assert.notEqual(turn.status, 'completed')
    assert.ok(turn.status !== 'completed' || replyText === 'late reply', 'overflow must fail honestly or complete with exactly our own reply')
    assert.equal((calls.filter(c => c.endpoint?.endsWith('/prompt'))).length, 2, 'no resend in either bound case')
  })

  scenario('the stored-replies bound stays capped and never breaks concurrent tracking', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 8000 })
    const TOTAL = 320
    for (let i = 0; i < TOTAL; i++) {
      const session = `s-cap-${i}`
      queues.set(session, [
        { messages: [{ id: `u${i}`, type: 'user', text: EXPECTED }], active: false },
        { messages: [{ id: `u${i}`, type: 'user', text: EXPECTED }, { id: `r${i}`, type: 'assistant', parentID: `u${i}`, text: `reply ${i}` }], active: false },
        { messages: [{ id: `u${i}`, type: 'user', text: EXPECTED }, { id: `r${i}`, type: 'assistant', parentID: `u${i}`, text: `reply ${i}` }], active: false },
      ])
    }
    await Promise.all(Array.from({ length: TOTAL }, (_, i) => adapter.send(`s-cap-${i}`, EXPECTED, { messages: [] })))
    await Promise.all(Array.from({ length: TOTAL }, (_, i) => awaitTurn(adapter, `s-cap-${i}`, 15000)))
    for (let i = 0; i < TOTAL; i++) {
      const r = results.find(x => x.sessionId === `s-cap-${i}`)
      assert.ok(r, `turn ${i} finished`)
      assert.equal(r.status, 'completed', `turn ${i} must complete under eviction pressure`)
    }
    assert.ok(adapter.replies.size <= 300, `replies bound respected (got ${adapter.replies.size})`)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, TOTAL, 'no resend under eviction pressure')
  })

  /* ---------- real provider shape (flat lifecycle, no parent ids) ---------- */

  // The observed install answers /message with flat messages and no `info` at all:
  //   user      { id:'msg_...', type:'user', text, time:{ created } }
  //   assistant { id:'msg_...', type:'assistant', content:[{type:'text',text}], finish:'stop',
  //               time:{ created, streamed, completed } }
  //   idle      { id:'msg_...', type:'idle', outcome:'succeeded', time:{ created } }
  // Ids and timestamps below are real-shaped (msg_<hex>, epoch ms) but content is synthetic.
  const U1 = 1792232004439, A1 = 1792232018802, A1C = 1792232033268, I1 = 1792232033271
  const U2 = 1792232100000, A2 = 1792232105000, A2C = 1792232115000, I2 = 1792232115100
  const OLD_U = 1792231000000, OLD_A = 1792231005000, OLD_I = 1792231010000
  const realUser = (id, text, created) => ({ id, type: 'user', text, time: { created } })
  const realAssistant = (id, text, created, completed = created + 600) => ({ id, type: 'assistant', content: text ? [{ type: 'text', text }] : [], finish: 'stop', time: { created, streamed: completed, completed } })
  const realIdle = (id, outcome, created) => ({ id, type: 'idle', outcome, time: { created } })
  const REAL_BASE = { messages: [realIdle('msg_oidle', 'succeeded', OLD_I), realAssistant('msg_oasst', 'old answer', OLD_A, OLD_A + 600), realUser('msg_ouser', 'an old request', OLD_U)] }

  scenario('real shape (no parentID), newest-first: our user + assistant + succeeded idle completes', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-newest'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const done = [realIdle('msg_i1', 'succeeded', I1), realAssistant('msg_a1', 'real reply', A1, A1C), ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: done, active: false },
      { messages: done, active: false },
    ])
    await adapter.send(session, EXPECTED, REAL_BASE)
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'real reply')
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('real shape, oldest-first order completes the same turn', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-oldest'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const done = [ours, realAssistant('msg_a1', 'order-free reply', A1, A1C), realIdle('msg_i1', 'succeeded', I1)]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: done, active: false },
      { messages: done, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'order-free reply')
  })

  scenario('real shape: our request leaves the 50-message window, the reply and idle arrive later', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-slide'
    const baseline = { messages: Array.from({ length: 48 }, (_, i) => realAssistant(`msg_old${i + 1}`, `old ${i + 1}`, OLD_A - (i + 1) * 10)) }
    const ours = realUser('msg_u1', EXPECTED, U1)
    const done = [realAssistant('msg_a1', 'late shape reply', A1, A1C), realIdle('msg_i1', 'succeeded', I1)]
    queues.set(session, [
      { messages: [...baseline.messages, ours], active: false },
      { messages: baseline.messages, active: false },          // our request slid out of the visible window
      { messages: baseline.messages, active: false },
      { messages: [...baseline.messages, ...done], active: false },
      { messages: [...baseline.messages, ...done], active: false },
    ])
    await adapter.send(session, EXPECTED, baseline)
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'late shape reply')
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('real shape: a later turn in the same poll is never attributed and is not treated as mixing', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-nextturn'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const later = [realIdle('msg_i2', 'succeeded', I2), realAssistant('msg_a2', 'next turn reply', A2, A2C), realUser('msg_u2', 'a genuinely different later request', U2)]
    const done = [...later, realIdle('msg_i1', 'succeeded', I1), realAssistant('msg_a1', 'our reply', A1, A1C), ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: done, active: false },
      { messages: done, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'our reply', 'the next turn must never be attributed to our task')
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('real shape: a parentless assistant with no closing idle is never accepted on adjacency', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-noidle'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const half = [realAssistant('msg_a1', 'text without a closed turn', A1, A1C), ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: half, active: false },
      { messages: half, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'a reply is not ours until the turn is proven closed')
    assert.equal(adapter.replies.size, 0)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('real shape: an idle that closes our turn as failed is an honest failure, no resend, no interrupt', async () => {
    const { api, queues, calls, interrupts } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-failed'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const failed = [realIdle('msg_i1', 'failed', I1), realAssistant('msg_a1', 'leftover text', A1, A1C), ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: failed, active: false },
      { messages: failed, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed')
    assert.equal(adapter.replies.size, 0)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
    assert.equal(interrupts.length, 0)
  })

  scenario('real shape: an interrupted idle never records success and never auto-interrupts', async () => {
    const { api, queues, calls, interrupts } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-interrupted'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const stopped = [realIdle('msg_i1', 'interrupted', I1), realAssistant('msg_a1', 'partial text', A1, A1C), ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: stopped, active: false },
      { messages: stopped, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed')
    assert.equal(adapter.replies.size, 0)
    assert.equal(interrupts.length, 0)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('real shape: system and tool messages between ours and the reply are ignored for text', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-tool'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const done = [
      realIdle('msg_i1', 'succeeded', I1),
      realAssistant('msg_a1', 'the answer', A1, A1C),
      { id: 'msg_tool1', type: 'tool', time: { created: A1 - 50 } },
      { id: 'msg_sys1', type: 'system', time: { created: U1 + 10 } },
      ours,
    ]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: done, active: false },
      { messages: done, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'the answer')
  })

  scenario('real shape: streaming the same assistant id settles on the final text after the idle closes', async () => {
    const { api, queues } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-stream'
    const ours = realUser('msg_u1', EXPECTED, U1)
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: [realAssistant('msg_a1', 'part', A1, A1C), ours], active: false },
      { messages: [realAssistant('msg_a1', 'part final', A1, A1C), ours], active: false },
      { messages: [realIdle('msg_i1', 'succeeded', I1), realAssistant('msg_a1', 'part final', A1, A1C), ours], active: false },
      { messages: [realIdle('msg_i1', 'succeeded', I1), realAssistant('msg_a1', 'part final', A1, A1C), ours], active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'part final', 'never the partial text')
  })

  scenario('real shape: two identical-text requests are never merged and fail honestly without resend', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-twins'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const twin = realUser('msg_u2', EXPECTED, U1 + 1)
    const done = [realIdle('msg_i1', 'succeeded', I1), realAssistant('msg_a1', 'one of two', A1, A1C), twin, ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: [twin, ours], active: false },
      { messages: done, active: false },
      { messages: done, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    const turn = await awaitTurn(adapter, session)
    assert.notEqual(turn.status, 'completed', 'two identical requests must never be merged')
    assert.equal(adapter.replies.size, 0)
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  scenario('real shape: a pending inbox item blocks completion until it clears', async () => {
    const { api, queues, calls } = makeSessions()
    const results = []
    const adapter = new Adapter(api, (sessionId, turn) => results.push({ sessionId, status: turn.status, error: turn.error && turn.error.message, turnId: turn.id }), { interval: 2, timeout: 5000 })
    const session = 'rs-inbox'
    const ours = realUser('msg_u1', EXPECTED, U1)
    const done = [realIdle('msg_i1', 'succeeded', I1), realAssistant('msg_a1', 'after inbox cleared', A1, A1C), ours]
    queues.set(session, [
      { messages: [ours], active: false },
      { messages: done, inbox: [{ id: 'waiting' }], active: false },
      { messages: done, active: false },
      { messages: done, active: false },
    ])
    await adapter.send(session, EXPECTED, { messages: [] })
    await awaitTurn(adapter, session)
    const turn = results.find(r => r.sessionId === session)
    assert.equal(turn.status, 'completed', turn.error)
    assert.equal(adapter.replies.get(`${session}:${turn.turnId}`), 'after inbox cleared')
    assert.equal(calls.filter(c => c.endpoint?.endsWith('/prompt')).length, 1)
  })

  /* ---------- run ---------- */

  for (const { name, fn } of runs) {
    try {
      await fn()
      console.log(`  ok   ${name}`)
    } catch (error) {
      console.log(`  FAIL ${name}: ${error.message}`)
      failures.push({ name, error: error.message })
    }
  }

  console.log(`\nrunTrackingChecks: ${runs.length - failures.length}/${runs.length} passed${failures.length ? ` — ${failures.length} failed` : ''}`)
  if (failures.length) {
    const list = failures.map(f => `  - ${f.name}: ${f.error}`).join('\n')
    throw new Error(`runTrackingChecks failed:\n${list}`)
  }
}

if (import.meta.main) {
  await runTrackingChecks().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
