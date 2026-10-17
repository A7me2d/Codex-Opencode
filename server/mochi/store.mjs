import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { retryFileOperation } from '../publish-extension.mjs'
import { redactSecrets } from './opencode-model.mjs'

/**
 * Mochi v1 durable store (desk 1).
 *
 * One bounded JSON profile per team, written atomically (temporary file + rename)
 * through a serialized promise queue, so a crash can never leave a half-written
 * record. Everything here is local state: no provider/model/action calls, no
 * network, no external database.
 *
 * The store is deliberately dumb about policy. Config validation goes through the
 * injected policy validator when it is available (`validateConfig(patch,current)`,
 * desk 5) and only then falls back to a conservative type check that never grants
 * a permission the operator did not explicitly send. Event/proposal identity is
 * durable and de-duplicated, and a record that crash-interrupted mid-processing is
 * restored as `failed` so nothing is ever replayed at startup.
 */

/** The only persisted config fields. Defaults are always disabled + suggest. */
export const DEFAULT_CONFIG = Object.freeze({ enabled: false, mode: 'suggest', model: '', autoAnswer: false, autoResume: false, autoApproveTools: false })
export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG))
export const EVENT_KINDS = Object.freeze(['question', 'permission', 'failed', 'tracking_unknown'])
export const EVENT_STATUSES = Object.freeze(['new', 'processing', 'done', 'failed'])
export const PROPOSAL_KINDS = Object.freeze(['answer_question', 'resume_task', 'approve_tool', 'escalate'])
export const PROPOSAL_STATUSES = Object.freeze(['pending', 'applied', 'rejected', 'stale', 'blocked'])

/** Explicit bounds so a store can never grow without limit. */
export const MOCHI_LIMITS = Object.freeze({
  events: 200,
  proposals: 200,
  log: 200,
  seen: 1000,
  text: 4000,
  reason: 1000,
  contextKeys: 40,
  contextString: 1000,
  answerKeys: 40,
  profileBytes: 512 * 1024,
})

const problem = (message, status = 400) => Object.assign(new Error(message), { status })
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const clone = value => (value === undefined ? value : structuredClone(value))
const text = (value, max = MOCHI_LIMITS.text) => (typeof value === 'string' ? value.slice(0, max) : '')
const keyFor = teamId => createHash('sha256').update(String(teamId)).digest('hex').slice(0, 32)

/** Durable identity: current team/desk/thread/task plus the source question/permission id. */
export function eventIdentity(event) {
  const source = event.sourceId !== undefined && event.sourceId !== null && String(event.sourceId).trim() ? String(event.sourceId) : String(event.id ?? '')
  return [event.teamId, event.slotId, event.threadId, event.taskId, event.kind, source]
    .map(part => String(part ?? '').slice(0, 200))
    .join('|')
}

function sanitizeContext(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return redactSecrets(value).slice(0, MOCHI_LIMITS.contextString)
  if (Array.isArray(value)) {
    if (depth >= 5) return []
    return value.slice(0, MOCHI_LIMITS.contextKeys).map(item => sanitizeContext(item, depth + 1)).filter(item => item !== undefined)
  }
  if (isPlainObject(value) && depth < 5) {
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, MOCHI_LIMITS.contextKeys)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      const clean = sanitizeContext(item, depth + 1)
      if (clean !== undefined) out[key.slice(0, 80)] = clean
    }
    return out
  }
  return undefined
}

function sanitizeAnswer(value) {
  if (!isPlainObject(value)) return undefined
  const out = {}
  for (const [key, item] of Object.entries(value).slice(0, MOCHI_LIMITS.answerKeys)) {
    if (typeof item === 'string') out[key.slice(0, 120)] = item.slice(0, MOCHI_LIMITS.text)
    else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) out[key.slice(0, 120)] = item
  }
  return out
}

function defaultRecord(teamId) {
  return { id: String(teamId), config: { ...DEFAULT_CONFIG }, events: [], proposals: [], log: [], seen: {}, updatedAt: 0 }
}

function normalizeEvent(event) {
  const seenAt = Date.now()
  const normalized = {
    id: typeof event.id === 'string' && event.id ? event.id.slice(0, 200) : randomUUID(),
    teamId: String(event.teamId),
    slotId: text(event.slotId, 200),
    threadId: text(event.threadId, 200),
    taskId: text(event.taskId, 200),
    kind: EVENT_KINDS.includes(event.kind) ? event.kind : 'tracking_unknown',
    sourceId: text(event.sourceId, 200),
    createdAt: typeof event.createdAt === 'number' || typeof event.createdAt === 'string' ? event.createdAt : seenAt,
    context: sanitizeContext(event.context) || {},
    status: 'new',
    attempts: 0,
    notBefore: 0,
    proposalId: null,
    lastError: null,
    seenAt,
    processedAt: null,
  }
  normalized.key = eventIdentity(normalized)
  return normalized
}

function normalizeProposal(proposal) {
  const status = PROPOSAL_STATUSES.includes(proposal.status) ? proposal.status : 'pending'
  return {
    id: typeof proposal.id === 'string' && proposal.id ? proposal.id.slice(0, 200) : randomUUID(),
    eventId: text(proposal.eventId, 200),
    eventKey: text(proposal.eventKey, 260),
    teamId: String(proposal.teamId),
    slotId: text(proposal.slotId, 200),
    threadId: text(proposal.threadId, 200),
    taskId: text(proposal.taskId, 200),
    sourceId: text(proposal.sourceId, 200),
    kind: PROPOSAL_KINDS.includes(proposal.kind) ? proposal.kind : 'escalate',
    status,
    answer: sanitizeAnswer(proposal.answer),
    reason: text(proposal.reason, MOCHI_LIMITS.reason),
    createdAt: Date.now(),
    resolvedAt: status === 'pending' ? null : Date.now(),
  }
}

/** Keep every list bounded; trim resolved proposals before pending ones. */
function boundRecord(record) {
  if (record.events.length > MOCHI_LIMITS.events) record.events = record.events.slice(-MOCHI_LIMITS.events)
  if (record.log.length > MOCHI_LIMITS.log) record.log = record.log.slice(-MOCHI_LIMITS.log)
  if (record.proposals.length > MOCHI_LIMITS.proposals) {
    // Pending proposals are kept first but are themselves capped, so a stream of
    // unanswered events can never grow the store without limit.
    const pending = record.proposals.filter(item => item.status === 'pending').slice(-MOCHI_LIMITS.proposals)
    const resolved = record.proposals.filter(item => item.status !== 'pending')
    const room = Math.max(0, MOCHI_LIMITS.proposals - pending.length)
    record.proposals = [...pending, ...(room ? resolved.slice(-room) : [])].sort((a, b) => a.createdAt - b.createdAt)
  }
  const keys = Object.keys(record.seen)
  if (keys.length > MOCHI_LIMITS.seen) for (const key of keys.slice(0, keys.length - MOCHI_LIMITS.seen)) delete record.seen[key]
  return record
}

/** Conservative fallback used only until the policy validator is wired in. */
function fallbackValidateConfig(patch, current) {
  if (!isPlainObject(patch)) throw problem('Invalid Mochi configuration.')
  const errors = []
  const next = { ...DEFAULT_CONFIG, ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!CONFIG_KEYS.includes(key)) { errors.push(`Unknown field “${key}”.`); continue }
    if (key === 'mode') { if (value !== 'suggest' && value !== 'automatic') errors.push('Choose suggest or automatic mode.'); else next.mode = value; continue }
    if (key === 'model') { if (typeof value !== 'string' || value.length > 200) errors.push('Choose a valid OpenCode model.'); else next.model = value.trim(); continue }
    if (typeof value !== 'boolean') errors.push(`“${key}” must be true or false.`); else next[key] = value
  }
  if (next.enabled && !next.model) errors.push('A configured, available OpenCode model is required before enabling Mochi.')
  if (errors.length) { const error = problem(errors.join(' ')); error.errors = errors; throw error }
  return { ...next, model: text(next.model, 200) }
}

function normalizeRecord(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const record = defaultRecord(raw.id)
  if (isPlainObject(raw.config)) for (const key of CONFIG_KEYS) if (typeof raw.config[key] === typeof DEFAULT_CONFIG[key]) record.config[key] = raw.config[key]
  if (!['suggest', 'automatic'].includes(record.config.mode)) record.config.mode = 'suggest'
  record.config.model = text(record.config.model, 200)
  if (Array.isArray(raw.events)) {
    record.events = raw.events.filter(event => isPlainObject(event) && typeof event.key === 'string').map(event => ({
      ...normalizeEvent({ ...event, teamId: raw.id }),
      key: event.key,
      status: event.status === 'processing' ? 'failed' : EVENT_STATUSES.includes(event.status) ? event.status : 'new',
      lastError: event.status === 'processing' ? 'interrupted' : text(event.lastError, 500) || null,
      attempts: Number.isInteger(event.attempts) ? event.attempts : 0,
      notBefore: Number.isFinite(event.notBefore) ? event.notBefore : 0,
      proposalId: typeof event.proposalId === 'string' ? event.proposalId : null,
    }))
  }
  if (Array.isArray(raw.proposals)) {
    record.proposals = raw.proposals.filter(item => isPlainObject(item) && typeof item.id === 'string' && PROPOSAL_KINDS.includes(item.kind)).map(item => ({
      ...normalizeProposal({ ...item, teamId: raw.id }),
      id: item.id,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      resolvedAt: Number.isFinite(item.resolvedAt) ? item.resolvedAt : null,
      status: PROPOSAL_STATUSES.includes(item.status) ? item.status : 'pending',
    }))
  }
  if (isPlainObject(raw.seen)) for (const [key, value] of Object.entries(raw.seen)) if (typeof key === 'string' && key.length <= 300) record.seen[key] = { status: text(value?.status, 40) || 'new', at: Number.isFinite(value?.at) ? value.at : 0 }
  if (Array.isArray(raw.log)) record.log = raw.log.filter(entry => isPlainObject(entry)).slice(-MOCHI_LIMITS.log).map(entry => ({ at: Number.isFinite(entry.at) ? entry.at : 0, level: ['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info', message: text(entry.message, 500), eventKey: entry.eventKey ? text(entry.eventKey, 260) : undefined }))
  record.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  return boundRecord(record)
}

export class MochiStore {
  /**
   * @param {string} directory  Storage directory (one hashed JSON profile per team).
   * @param {{validateConfig?: (patch:object, current:object) => object}} [options]
   */
  constructor(directory, { validateConfig } = {}) {
    if (typeof directory !== 'string' || !directory) throw problem('A Mochi storage directory is required.')
    this.directory = directory
    this.policy = typeof validateConfig === 'function' ? validateConfig : null
    this.teams = new Map()
    this.writes = Promise.resolve()
    this.ready = this.restore()
    void this.ready.catch(() => {})
  }

  async restore() {
    let names = []
    try { names = await readdir(this.directory) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const record = normalizeRecord(JSON.parse(await readFile(path.join(this.directory, name), 'utf8')))
        if (record) this.teams.set(record.id, record)
      } catch { /* a corrupt profile is skipped, never crashes startup nor grows the store */ }
    }
  }

  /** Await all pending writes (tests and graceful shutdown). */
  async flush() { await this.ready; await this.writes.catch(() => {}); return this }

  fileFor(teamId) { return path.join(this.directory, `${keyFor(teamId)}.json`) }

  /** Pure read: an unknown team yields defaults and is never written. */
  async get(teamId) {
    if (typeof teamId !== 'string' || !teamId) throw problem('A team id is required.')
    await this.ready
    return clone(this.teams.get(teamId) || defaultRecord(teamId))
  }

  /** Additive: team ids with a persisted profile. */
  async list() { await this.ready; return [...this.teams.keys()] }

  async #persist(record) {
    const bounded = boundRecord(record)
    const raw = JSON.stringify(bounded)
    if (Buffer.byteLength(raw) > MOCHI_LIMITS.profileBytes) throw problem('This team’s Mochi store exceeded its size limit.', 409)
    const file = this.fileFor(record.id)
    await mkdir(this.directory, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, raw, 'utf8')
    await retryFileOperation(() => rename(temporary, file))
  }

  change(teamId, operation) {
    if (typeof teamId !== 'string' || !teamId) return Promise.reject(problem('A team id is required.'))
    const next = this.writes.catch(() => {}).then(async () => {
      await this.ready
      const working = clone(this.teams.get(teamId) || defaultRecord(teamId))
      const result = await operation(working)
      working.updatedAt = Date.now()
      const bounded = boundRecord(working)
      await this.#persist(bounded)
      this.teams.set(teamId, bounded)
      return clone(result)
    })
    this.writes = next
    return next
  }

  #validate(patch, current) {
    if (this.policy) {
      const result = this.policy(patch, current)
      if (isPlainObject(result) && 'config' in result) {
        if (Array.isArray(result.errors) && result.errors.length) { const error = problem(result.errors.join(' ')); error.errors = result.errors; throw error }
        return this.#normalizeConfig(result.config)
      }
      return this.#normalizeConfig(result)
    }
    return fallbackValidateConfig(patch, current)
  }

  #normalizeConfig(value) {
    const next = { ...DEFAULT_CONFIG }
    if (isPlainObject(value)) for (const key of CONFIG_KEYS) if (typeof value[key] === typeof DEFAULT_CONFIG[key]) next[key] = value[key]
    if (!['suggest', 'automatic'].includes(next.mode)) next.mode = 'suggest'
    next.model = text(next.model, 200)
    return next
  }

  /** Validated partial config update; returns the resulting config. */
  configure(teamId, patch) {
    return this.change(teamId, record => {
      const next = this.#validate(patch, record.config)
      record.config = next
      return next
    })
  }

  /** Insert an actionable event once; repeat identities are ignored (durable idempotency). */
  putEvent(event) {
    if (!isPlainObject(event) || typeof event.teamId !== 'string' || !event.teamId) return Promise.reject(problem('Event needs a team id.'))
    return this.change(event.teamId, record => {
      const stored = normalizeEvent(event)
      if (record.seen[stored.key]) return { added: false, key: stored.key, event: record.events.find(item => item.key === stored.key) || null }
      record.events.push(stored)
      record.seen[stored.key] = { status: 'new', at: stored.seenAt }
      return { added: true, key: stored.key, event: stored }
    })
  }

  /** Insert a proposal once per event; repeats are ignored. */
  putProposal(proposal) {
    if (!isPlainObject(proposal) || typeof proposal.teamId !== 'string' || !proposal.teamId) return Promise.reject(problem('Proposal needs a team id.'))
    return this.change(proposal.teamId, record => {
      const normalized = normalizeProposal(proposal)
      const existing = record.proposals.find(item => (normalized.eventKey && item.eventKey === normalized.eventKey) || (normalized.eventId && item.eventId === normalized.eventId) || item.id === normalized.id)
      if (existing) return { added: false, proposal: existing }
      record.proposals.push(normalized)
      return { added: true, proposal: normalized }
    })
  }

  resolveProposal(teamId, id, status) {
    return this.change(teamId, record => {
      const proposal = record.proposals.find(item => item.id === id)
      if (!proposal) throw problem('Proposal was not found.', 404)
      if (!PROPOSAL_STATUSES.includes(status)) throw problem('Unknown proposal status.')
      proposal.status = status
      proposal.resolvedAt = Date.now()
      if (proposal.eventKey && record.seen[proposal.eventKey]) record.seen[proposal.eventKey] = { status: 'done', at: Date.now() }
      return proposal
    })
  }

  /** Additive runtime support: move an event through new/processing/done/failed. */
  markEvent(teamId, key, patch = {}) {
    return this.change(teamId, record => {
      const event = record.events.find(item => item.key === key)
      const seen = record.seen[key]
      if (!event && !seen) throw problem('Event was not found.', 404)
      const status = patch.status
      if (status && !EVENT_STATUSES.includes(status)) throw problem('Unknown event status.')
      if (event) {
        if (status) event.status = status
        if ('attempts' in patch) event.attempts = Math.max(0, Number(patch.attempts) || 0)
        if ('notBefore' in patch) event.notBefore = Number(patch.notBefore) || 0
        if ('lastError' in patch) event.lastError = patch.lastError ? text(patch.lastError, 500) : null
        if ('proposalId' in patch) event.proposalId = patch.proposalId ? text(patch.proposalId, 200) : null
        if (status === 'done' || status === 'failed') event.processedAt = Date.now()
      }
      record.seen[key] = { status: status || seen?.status || 'new', at: Date.now() }
      return event || { key, status: record.seen[key].status }
    })
  }

  /** Additive: bounded, honest activity log per team. */
  appendLog(teamId, entry = {}) {
    return this.change(teamId, record => {
      const item = {
        at: Date.now(),
        level: ['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info',
        message: text(entry.message, 500),
        eventKey: entry.eventKey ? text(entry.eventKey, 260) : undefined,
      }
      record.log.push(item)
      if (record.log.length > MOCHI_LIMITS.log) record.log = record.log.slice(-MOCHI_LIMITS.log)
      return item
    })
  }
}
