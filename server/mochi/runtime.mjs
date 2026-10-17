import {
  PROPOSAL_KINDS,
} from './store.mjs'

/**
 * Mochi v1 runtime (desk 1).
 *
 * Deterministic server work on a 15s timer: ask the injected `collect` for the
 * team's events, persist the new ones through the store, and — only for a brand
 * new actionable event — ask `plan` exactly once. Polling and `snapshot()` never
 * touch a model. Nothing is replayed after a restart, nothing is retried forever,
 * and automatic execution only ever happens through the real policy `apply` path.
 *
 * Deps (injected by the integrator):
 *   - listTeams() -> teams
 *   - collect(team) -> events
 *   - plan(event, config) -> proposal | null      (may call the model, once)
 *   - apply(proposal, config) -> result           (the real, policy-guarded path)
 *   - providerAvailable?(team) -> boolean          (optional provider gate)
 */

const DEFAULT_INTERVAL_MS = 15_000
/** Explicit processing bounds: at most 3 attempts, capped exponential backoff. */
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 30_000
const BACKOFF_FACTOR = 2
const MAX_BACKOFF_MS = 300_000
const DEFAULT_MAX_PER_TICK = 5
const MAX_LOG_MESSAGE = 500

/** Which automatic flag authorizes which proposal kind. `escalate` is never automatic. */
const AUTO_FLAG = { answer_question: 'autoAnswer', resume_task: 'autoResume', approve_tool: 'autoApproveTools' }

const issue = (message, status = 400) => Object.assign(new Error(message), { status })

export class MochiRuntime {
  constructor(store, deps, { intervalMs = DEFAULT_INTERVAL_MS, maxEventsPerTick = DEFAULT_MAX_PER_TICK, now = Date.now } = {}) {
    if (!store || typeof store.get !== 'function') throw issue('MochiRuntime needs a MochiStore.')
    for (const name of ['listTeams', 'collect', 'plan', 'apply']) {
      if (!deps || typeof deps[name] !== 'function') throw issue(`MochiRuntime needs a deps.${name} function.`)
    }
    this.store = store
    this.deps = deps
    this.intervalMs = Math.max(1000, Number(intervalMs) || DEFAULT_INTERVAL_MS)
    this.maxEventsPerTick = Math.max(1, Math.floor(Number(maxEventsPerTick) || DEFAULT_MAX_PER_TICK))
    this.now = now
    this.timer = null
    this.ticking = false
    this.ticks = new Map()
    /** In-memory last state per team; never a model call and never persisted growth. */
    this.states = new Map()
  }

  /** Arm the 15s monitor. No immediate tick: a restart must not resend anything. */
  start() {
    if (this.timer) return this
    this.timer = setInterval(() => { void this.tickAll() }, this.intervalMs)
    this.timer.unref?.()
    return this
  }

  /** Disarm the monitor and drop the timer. In-flight ticks finish on their own. */
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    return this
  }

  /** Tick every known team, one at a time; a failure in one team never blocks the rest. */
  async tickAll() {
    if (this.ticking) return
    this.ticking = true
    try {
      const teams = await this.deps.listTeams()
      for (const team of Array.isArray(teams) ? teams : []) {
        if (!team || typeof team.id !== 'string' || !team.id) continue
        try { await this.tick(team.id) } catch { /* isolated per team */ }
      }
    } finally {
      this.ticking = false
    }
  }

  /** Single-flight per team: concurrent callers share one run. */
  tick(teamId) {
    const existing = this.ticks.get(teamId)
    if (existing) return existing
    const run = this.#tick(teamId).finally(() => { if (this.ticks.get(teamId) === run) this.ticks.delete(teamId) })
    this.ticks.set(teamId, run)
    return run
  }

  /** Read-only snapshot; never triggers collection, planning or actions. */
  async snapshot(teamId) {
    const record = await this.store.get(teamId)
    const memory = this.states.get(teamId)
    const state = !record.config.enabled ? 'disabled' : memory?.state || 'idle'
    return { config: record.config, runtime: { state, error: memory?.error ?? null }, proposals: record.proposals, events: record.events }
  }

  /**
   * Additive: apply an already-approved proposal through the real policy path.
   * The dependency owns authorization/operator checks; this only records the outcome.
   */
  async applyProposal(teamId, proposalId) {
    const record = await this.store.get(teamId)
    const proposal = record.proposals.find(item => item.id === proposalId)
    if (!proposal) throw issue('Proposal was not found.', 404)
    if (proposal.status !== 'pending') return this.snapshot(teamId)
    try {
      const result = await this.deps.apply(proposal, record.config)
      const status = this.#applyStatus(result)
      await this.store.resolveProposal(teamId, proposal.id, status)
      await this.store.appendLog(teamId, { level: status === 'applied' ? 'info' : 'warn', message: `approved_${status}`, eventKey: proposal.eventKey })
    } catch (error) {
      await this.store.resolveProposal(teamId, proposal.id, 'blocked')
      await this.store.appendLog(teamId, { level: 'error', message: error instanceof Error ? error.message : 'apply_failed', eventKey: proposal.eventKey })
    }
    return this.snapshot(teamId)
  }

  #providerAvailable(team, config) {
    if (typeof this.deps.providerAvailable === 'function') {
      try { return this.deps.providerAvailable(team, config) === true } catch { return false }
    }
    for (const key of ['providerAvailable', 'mochiProviderAvailable', 'providerOnline']) {
      if (typeof team[key] === 'boolean') return team[key]
    }
    return true
  }

  #gate(team, config) {
    if (!team) return { state: 'blocked', error: 'team_not_found' }
    if (!config.enabled) return { state: 'disabled', error: null }
    if (team.archived) return { state: 'disabled', error: null }
    if (!this.#providerAvailable(team, config)) return { state: 'blocked', error: 'provider_unavailable' }
    return null
  }

  #applyStatus(result) {
    if (result && result.ok === false) return result.blocked ? 'blocked' : 'rejected'
    if (result && (result.status === 'blocked' || result.status === 'rejected')) return result.status
    return result?.status === 'applied' ? 'applied' : result?.status === 'stale' ? 'stale' : 'blocked'
  }

  async #tick(teamId) {
    const record = await this.store.get(teamId)
    const team = await this.#findTeam(teamId)
    const blocked = this.#gate(team, record.config)
    if (blocked) { this.#setState(teamId, blocked.state, blocked.error); return this.snapshot(teamId) }

    this.#setState(teamId, 'working', null)
    let events = []
    try { events = await this.deps.collect(team) } catch { events = [] }
    for (const event of Array.isArray(events) ? events : []) {
      try { await this.store.putEvent(event && event.teamId ? event : { ...event, teamId }) } catch { /* skip a malformed event, never loop on it */ }
    }

    const current = await this.store.get(teamId)
    const candidates = current.events
      .filter(event => event.status === 'new' && (event.notBefore || 0) <= this.now() && (event.attempts || 0) < MAX_ATTEMPTS)
      .slice(0, this.maxEventsPerTick)

    let lastError = null
    for (const event of candidates) {
      const outcome = await this.#process(teamId, event, record.config)
      if (outcome && outcome.error) lastError = outcome.error
    }

    const final = await this.store.get(teamId)
    const pending = final.proposals.some(item => item.status === 'pending')
    const blockedProposal = final.proposals.some(item => item.status === 'blocked')
    const state = pending ? 'waiting_user' : lastError || blockedProposal ? 'blocked' : 'idle'
    this.#setState(teamId, state, lastError)
    return this.snapshot(teamId)
  }

  async #findTeam(teamId) {
    try {
      const teams = await this.deps.listTeams()
      return (Array.isArray(teams) ? teams : []).find(team => team && team.id === teamId) || null
    } catch { return null }
  }

  #shouldAutoApply(config, kind) {
    if (config.mode !== 'automatic') return false
    const flag = AUTO_FLAG[kind]
    return Boolean(flag) && config[flag] === true
  }

  async #storeProposal(teamId, event, proposal) {
    const kind = PROPOSAL_KINDS.includes(proposal?.kind) ? proposal.kind : 'escalate'
    const entry = {
      id: typeof proposal?.id === 'string' && proposal.id ? proposal.id : undefined,
      eventId: event.id,
      eventKey: event.key,
      teamId,
      slotId: event.slotId,
      threadId: event.threadId,
      taskId: event.taskId,
      sourceId: event.sourceId,
      kind,
      status: 'pending',
      answer: proposal?.answer,
      reason: typeof proposal?.reason === 'string' ? proposal.reason : '',
      // Carry the brain that produced a model decision (question events only);
      // the policy path refuses to apply it after a provider/model switch.
      ...(proposal?.brain && typeof proposal.brain === 'object' ? { brain: proposal.brain } : {}),
    }
    const result = await this.store.putProposal(entry)
    return result.proposal
  }

  async #process(teamId, event, config) {
    await this.store.markEvent(teamId, event.key, { status: 'processing', attempts: (event.attempts || 0) + 1, lastError: null })
    try {
      const proposal = await this.deps.plan(event, config)
      if (!proposal) {
        await this.store.markEvent(teamId, event.key, { status: 'done' })
        await this.store.appendLog(teamId, { level: 'info', message: 'no_proposal', eventKey: event.key })
        return null
      }
      const stored = await this.#storeProposal(teamId, event, proposal)
      if (this.#shouldAutoApply((await this.store.get(teamId)).config, stored.kind)) {
        const result = await this.deps.apply(stored, config)
        const status = this.#applyStatus(result)
        await this.store.resolveProposal(teamId, stored.id, status)
        await this.store.markEvent(teamId, event.key, { status: 'done', proposalId: stored.id })
        await this.store.appendLog(teamId, { level: status === 'applied' ? 'info' : 'warn', message: `auto_${status}`, eventKey: event.key })
        return status === 'applied' ? null : { error: result?.reason || status }
      }
      await this.store.markEvent(teamId, event.key, { status: 'done', proposalId: stored.id })
      await this.store.appendLog(teamId, { level: 'info', message: config.mode === 'automatic' ? 'proposed' : 'suggested', eventKey: event.key })
      return null
    } catch (error) {
      const attempts = (event.attempts || 0) + 1
      const message = error instanceof Error ? error.message : 'plan_failed'
      if (attempts >= MAX_ATTEMPTS) {
        await this.store.markEvent(teamId, event.key, { status: 'failed', attempts, lastError: message, notBefore: 0 })
        await this.store.appendLog(teamId, { level: 'error', message: message.slice(0, MAX_LOG_MESSAGE), eventKey: event.key })
        return { error: message }
      }
      const delay = Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attempts - 1), MAX_BACKOFF_MS)
      await this.store.markEvent(teamId, event.key, { status: 'new', attempts, lastError: message, notBefore: this.now() + delay })
      await this.store.appendLog(teamId, { level: 'warn', message: message.slice(0, MAX_LOG_MESSAGE), eventKey: event.key })
      return null
    }
  }

  #setState(teamId, state, error) {
    this.states.set(teamId, { state, error: error || null, at: this.now() })
  }
}
