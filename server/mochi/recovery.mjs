// Mochi v1 — desk 4: recovery planner and executor.
//
// Recovery is the only responsibility of this module, and it is deliberately conservative:
//
//  * Only a *real* failure or a *confirmed* stop is evidence. The passage of time, an `active`
//    desk, a queued/waiting task, a permission block and an unknown/lost tracking state are never
//    evidence, and nothing is ever resent because a timer or a task age expired.
//  * A resume is always a proposal for the operator (`status: 'pending'`). This module never
//    answers, never grants permissions and never applies anything by itself.
//  * `applyRecovery` runs only on the operator-approved policy path (`operatorApproved: true`),
//    re-reads the live task state and re-checks every identity field before the guarded resume
//    path is used, so a stale, changed or foreign task is never touched.
//  * At most one bounded continuation per task, claimed durably (once) *before* the resume. A
//    provider that cannot continue safely ends as `blocked` with a manual-open suggestion instead
//    of a fabricated success.
//  * The original request is never replayed: the only action this module invokes is the injected
//    `deps.resumeTask` (the existing guarded path, with its own license/message-id handling).

/** One approved bounded continuation per task unless the injected claim reports its own limit. */
export const MAX_RESUME_ATTEMPTS = 1

const MAX_ID = 200
const MAX_TEXT = 400
const MAX_ATTEMPT_LIMIT = 5

// A task state that is a real end: only these (or an explicit failure outcome / confirmed stop /
// provider error with no contradicting state) may be planned for recovery.
const FAILURE_STATES = new Set(['failed', 'stopped', 'interrupted', 'cancelled', 'error', 'aborted'])
// States that are explicitly *not* a failure reason. Listed for documentation and for the tests:
// `active`, `running`, `queued`, `waiting`, `waiting_input`, `asking`, `pending`, `timeout`,
// `permission_blocked`, `tracking_unknown`, `unknown`, `lost`, `completed`.

const bounded = (value, max = MAX_TEXT) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const isId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readConfig = config => {
  const source = plainObject(config) ? config : {}
  return { enabled: source.enabled === true, mode: source.mode === 'auto' ? 'auto' : 'suggest' }
}

/**
 * Normalize an incoming event into the fields recovery needs, or `null` when the event cannot be
 * identified safely (nothing should be proposed for an event we cannot name).
 */
const readEvent = event => {
  const source = plainObject(event) ? event : null
  if (!source) return null
  const identity = {}
  for (const key of ['id', 'teamId', 'slotId', 'threadId', 'taskId']) {
    if (!isId(source[key])) return null
    identity[key] = source[key].trim()
  }
  identity.sourceId = isId(source.sourceId) ? source.sourceId.trim() : ''
  identity.kind = typeof source.kind === 'string' ? source.kind : ''
  identity.createdAt = typeof source.createdAt === 'string' ? source.createdAt.slice(0, 40) : ''
  const context = plainObject(source.context) ? source.context : {}
  const state = typeof context.state === 'string' ? context.state.trim().toLowerCase() : ''
  const attempts_raw = context.resumeAttempts !== undefined ? context.resumeAttempts : context.attempts
  // A malformed attempt counter fails closed: it is treated as "the limit is already reached".
  const attempts = attempts_raw === undefined ? 0 : Number.isInteger(attempts_raw) && attempts_raw >= 0 ? attempts_raw : MAX_ATTEMPT_LIMIT
  return {
    ...identity,
    state,
    outcome: typeof context.outcome === 'string' ? context.outcome.trim().toLowerCase() : '',
    error: bounded(context.error),
    stoppedByOperator: context.stoppedByOperator === true || context.stopped === true,
    canResume: context.canResume === true || context.providerCanContinue === true,
    resumeCapabilityKnown: context.canResume !== undefined || context.providerCanContinue !== undefined,
    messageId: isId(context.messageId) ? context.messageId.trim() : '',
    attempts,
  }
}

const attemptLimit = limit => {
  const value = Number.isInteger(limit) ? limit : MAX_RESUME_ATTEMPTS
  return Math.max(1, Math.min(MAX_ATTEMPT_LIMIT, value))
}

const proposalOf = (event, { kind, status, reason }) => ({
  id: `recovery:${event.id}`,
  eventId: event.id,
  teamId: event.teamId,
  slotId: event.slotId,
  threadId: event.threadId,
  taskId: event.taskId,
  kind,
  status,
  reason: bounded(reason),
  createdAt: new Date().toISOString(),
})

/**
 * Plan a recovery proposal for one event, or `null` when recovery does not apply.
 *
 * `null` is the honest answer for everything that is not a real failure or a confirmed stop —
 * including `active`, `queued`, `waiting`, `timeout`, `permission_blocked` and
 * `tracking_unknown` — and for any event that cannot be identified safely or has already used its
 * bounded attempts. When the provider cannot continue the task safely in its current state the
 * plan is a `blocked` escalation for the operator to open the conversation manually, never a
 * resume and never a fabricated success.
 */
export const planRecovery = (event, config) => {
  const settings = readConfig(config)
  // Mochi off means no activity at all, not even a proposal.
  if (!settings.enabled) return null
  const planned = readEvent(event)
  if (!planned) return null
  // Questions, permissions and lost tracking are other desks' business: a permission block stays
  // an operator proposal and must never turn into a resume.
  if (planned.kind !== 'failed') return null
  // An explicitly named state must itself be a real end; an `active`/`queued`/`waiting`/unknown
  // state is not a failure reason no matter what else the event carries.
  if (planned.state && !FAILURE_STATES.has(planned.state)) return null
  const evidence = Boolean(planned.state) || planned.outcome === 'failed' || planned.stoppedByOperator || Boolean(planned.error)
  if (!evidence) return null // time alone is never evidence of failure
  if (planned.attempts >= attemptLimit(undefined)) return null // bounded attempts: plan no further
  if (!planned.canResume) {
    return proposalOf(planned, {
      kind: 'escalate',
      status: 'blocked',
      reason: 'The task ended, but the provider cannot continue it safely in its current state. Open the conversation and continue manually; nothing was sent automatically.',
    })
  }
  const trigger = planned.stoppedByOperator ? 'a confirmed operator stop' : 'a real failure'
  return proposalOf(planned, {
    kind: 'resume_task',
    status: 'pending',
    reason: `The task ended with ${trigger} after ${planned.attempts} continuation attempt(s). Approving requests one bounded continuation through the normal guarded resume path; nothing is sent before the operator approves.`,
  })
}

/* ---------------------------------------------------------------------------- executor ---- */

const result = (proposalId, status, reason, extra = {}) => ({
  proposalId: proposalId || null,
  status,
  // `ok` is true only for a confirmed resume, and `blocked` is true for every non-applied outcome:
  // this keeps a stale/blocked/failed action out of any `applied` mapping downstream.
  ok: status === 'applied',
  blocked: status !== 'applied',
  reason: bounded(reason),
  ...extra,
})

/**
 * Apply one operator-approved recovery proposal. Never throws, never reports success unless the
 * guarded resume path confirmed `resumed`, and never replays the original request itself.
 *
 * Injected deps (concrete integration interface for desk 8 / desk 5):
 *  - `operatorApproved: boolean` — set by the policy path after explicit operator approval.
 *  - `readTask({teamId,slotId,threadId,taskId})` -> live state, including `status`, the current
 *    binding (`teamId/slotId/threadId/taskId`), the verified `messageId` of the ended turn and the
 *    provider capability (`canResume`/`providerCanContinue`).
 *  - `claimAttempt({proposalId,teamId,slotId,threadId,taskId})` -> `{claimed, attempt, maxAttempts?,
 *    reason?}` — durable, once-only claim consumed *before* the resume (persistence is the
 *    integrator's job, so a restart cannot reuse an attempt).
 *  - `resumeTask({teamId,slotId,threadId,taskId,messageId,attempt,proposalId})` -> the existing
 *    guarded resume path (license / message-id behaviour stays there): `{status:'resumed',…}` on
 *    success, otherwise an honest `{status:'blocked'|'unsupported'|'failed',…}`.
 *
 * The returned result always carries `ok` (true only for a confirmed resume) and `blocked` (true
 * for every non-applied outcome). Desk 1's `MochiRuntime#applyStatus` maps `{ok:false, blocked:true}`
 * to `blocked` and `{ok:false, blocked:false}` to `rejected`, so this shape can never turn a stale,
 * blocked or failed action into `applied`.
 */
export const applyRecovery = async (proposal, deps) => {
  const source = plainObject(proposal) ? proposal : null
  const proposalId = isId(source?.id) ? source.id.trim() : null
  try {
    if (!source || !proposalId) return result(proposalId, 'blocked', 'A malformed proposal cannot be applied; nothing was sent.')
    const identity = {}
    for (const key of ['teamId', 'slotId', 'threadId', 'taskId']) {
      if (!isId(source[key])) return result(proposalId, 'blocked', `The proposal is missing its ${key}; nothing was sent.`)
      identity[key] = source[key].trim()
    }
    if (source.kind !== 'resume_task') return result(proposalId, 'blocked', 'Only a resume_task proposal can be applied by recovery; nothing was sent.')
    if (source.status !== 'pending') return result(proposalId, 'blocked', `This proposal is ${bounded(source.status, 40) || 'not pending'} and cannot be applied again; nothing was sent.`)
    const guards = plainObject(deps) ? deps : {}
    // An approval is an explicit operator act, never an inference from the mode or the config.
    if (guards.operatorApproved !== true) return result(proposalId, 'blocked', 'Operator approval is required before any recovery action; nothing was sent.')
    if (typeof guards.readTask !== 'function') return result(proposalId, 'blocked', 'The live task state cannot be reread, so recovery was not attempted.')

    let live = null
    try { live = await guards.readTask(identity) } catch { live = null }
    if (!plainObject(live)) return result(proposalId, 'blocked', 'The live task state could not be read; nothing was sent.')
    // Identity and binding must still be the same task, so a resume can never touch another desk.
    if (live.teamId !== undefined && live.teamId !== identity.teamId) return result(proposalId, 'stale', 'The team binding changed; nothing was sent.')
    if (live.slotId !== undefined && live.slotId !== identity.slotId) return result(proposalId, 'stale', 'The desk binding changed; nothing was sent.')
    if (live.threadId !== undefined && live.threadId !== identity.threadId) return result(proposalId, 'stale', 'The conversation binding changed; nothing was sent.')
    if (live.taskId !== undefined && live.taskId !== identity.taskId) return result(proposalId, 'stale', 'The task identity changed; nothing was sent.')
    const state = typeof live.status === 'string' ? live.status.trim().toLowerCase() : ''
    if (state === 'completed') return result(proposalId, 'stale', 'The task already completed, so there is nothing to resume; nothing was sent.')
    // The live reread decides, not the event and not the elapsed time: a task that is still
    // active/queued/waiting (or whose tracking is unknown) is not evidence of failure.
    if (!FAILURE_STATES.has(state) && !(live.stoppedByOperator === true || live.outcome === 'failed')) {
      return result(proposalId, 'blocked', `The live task state is ${state || 'unknown'} — not a confirmed failure or stop — so it was left untouched and nothing was sent.`)
    }
    if (live.canResume !== true && live.providerCanContinue !== true) {
      return result(proposalId, 'blocked', 'The provider cannot continue this task safely in its current state. Open the conversation and continue manually; nothing was sent.')
    }
    // The verified message id of the ended turn is required so the existing guarded resume path
    // (with its license/message-id handling) is used unchanged and no turn is fabricated.
    const messageId = isId(live.messageId) ? live.messageId.trim() : ''
    if (!messageId) return result(proposalId, 'blocked', 'The verified message id of the ended turn is unavailable, so the guarded resume path cannot be used; nothing was sent.')
    if (typeof guards.claimAttempt !== 'function' || typeof guards.resumeTask !== 'function') {
      return result(proposalId, 'blocked', 'The durable attempt claim or the guarded resume path is unavailable to this build; nothing was sent.')
    }

    // Durable, once-only claim *before* the action, so a crash/restart cannot replay an attempt.
    let claim = null
    try { claim = await guards.claimAttempt({ proposalId, ...identity }) } catch { claim = null }
    if (!plainObject(claim) || claim.claimed !== true) {
      return result(proposalId, 'blocked', bounded(claim?.reason) || 'A bounded continuation was already used for this task (durable claim); nothing was sent.')
    }
    const limit = attemptLimit(claim.maxAttempts)
    const attempt = Number.isInteger(claim.attempt) && claim.attempt > 0 ? claim.attempt : 1
    if (attempt > limit) return result(proposalId, 'blocked', `The continuation limit (${limit}) for this task is already reached; nothing was sent.`, { attempt })

    let resumed = null
    try { resumed = await guards.resumeTask({ ...identity, messageId, attempt, proposalId, operatorApproved: true }) }
    catch (error) { return result(proposalId, 'failed', `The guarded resume path failed: ${bounded(error?.message) || 'unknown error'}. The original request was not replayed.`, { attempt }) }
    const status = typeof resumed?.status === 'string' ? resumed.status.trim().toLowerCase() : ''
    if (status === 'resumed') {
      return result(proposalId, 'applied', 'The operator-approved single continuation was requested through the normal guarded resume path.', { attempt, resumed: { status: 'resumed', turnId: isId(resumed?.turnId) ? resumed.turnId.trim() : null } })
    }
    if (status === 'blocked' || status === 'unsupported' || status === 'not_supported' || status === 'unsafe') {
      return result(proposalId, 'blocked', bounded(resumed?.reason) || 'The provider cannot continue this task safely in its current state. Open the conversation and continue manually; nothing was sent.', { attempt })
    }
    return result(proposalId, 'failed', bounded(resumed?.reason) || 'The guarded resume path did not confirm a continuation; it is not reported as success and the original request was not replayed.', { attempt })
  } catch (error) {
    return result(proposalId, 'failed', `The recovery action could not be completed: ${bounded(error?.message) || 'unknown error'}. Nothing was replayed.`)
  }
}
