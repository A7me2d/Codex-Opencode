/**
 * Mochi v1 — policy layer (desk 5).
 *
 * Owns three things only: strict config validation, proposal authorization,
 * and the safe-action policy that `applyMochiProposal` enforces before any
 * dependency is invoked. Nothing here invents data: a missing field, a
 * non-pending source, or an unknown tool category is a denial with a reason,
 * never a guess.
 *
 * Trust model: model replies and stored proposal payloads are untrusted data.
 * Decisions come from the shape checks below plus the live context the
 * integrator re-reads at apply time. Free text inside a proposal or a model
 * result is never treated as an instruction.
 *
 * Wire contract: `.relay-state/reviews/mochi-r1/CONTRACT.md`.
 */

export const DEFAULT_MOCHI_CONFIG = Object.freeze({
  enabled: false,
  mode: 'suggest',
  /** Which provider serves Mochi's own brain. Independent of the desks Mochi watches. */
  brainProvider: 'opencode',
  /** OpenCode model selector (`providerID/modelID`) when brainProvider is "opencode". */
  model: '',
  /** Cline model id from Cline's own catalog when brainProvider is "cline". */
  clineModel: '',
  clineProvider: 'cline',
  autoAnswer: false,
  autoResume: false,
  autoApproveTools: false,
})

const CONFIG_FIELDS = new Set(Object.keys(DEFAULT_MOCHI_CONFIG))
const MODES = new Set(['suggest', 'automatic'])
const BRAIN_PROVIDERS = new Set(['opencode', 'cline'])

/** The model selector that matters for the currently selected brain provider. */
export function brainModel(config) {
  return config?.brainProvider === 'cline' ? config?.clineModel || '' : config?.model || ''
}

/** Human name of the selected brain provider, for honest operator messages. */
export function brainProviderName(config) {
  return config?.brainProvider === 'cline' ? 'Cline' : 'OpenCode'
}

export class PolicyError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message)
    this.name = 'PolicyError'
    this.status = status
  }
}

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Control characters for config text: everything below 0x20 plus DEL. */
const CONFIG_CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', '')
/** Form answers may carry tab/newline/carriage-return, nothing else below 0x20, and not DEL. */
const ANSWER_CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', '')

/** Printable, bounded, control-character-free text. Model text boundaries. */
function safeText(value, field, { maxLength = 200, allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new PolicyError(`Mochi config field "${field}" must be a string.`)
  const text = value.trim()
  if (!text && !allowEmpty) throw new PolicyError(`Mochi config field "${field}" must not be empty.`)
  if (text.length > maxLength) throw new PolicyError(`Mochi config field "${field}" must be ${maxLength} characters or fewer.`)
  if (CONFIG_CONTROL_CHARS.test(text)) throw new PolicyError(`Mochi config field "${field}" contains control characters.`)
  return text
}

/**
 * Validate a partial config patch and merge it over the current config.
 *
 * Strict types/enums/field bounds, only the contract fields, unknown fields
 * rejected. Returns the full merged config (never a partial). Throws
 * `PolicyError` with a `.status` HTTP code on any invalid input.
 *
 * Enabling or automatic mode requires a configured model string for the
 * selected brain provider; actual model availability is the runtime's job
 * (`requireEnabled`), this only guarantees the field is present and well-formed.
 */
export function validateConfig(patch, current) {
  if (patch === undefined || patch === null) return normalize(defaultOr(current))
  if (!isRecord(patch)) throw new PolicyError('Mochi config must be an object.')
  const base = normalize(defaultOr(current))
  for (const field of Object.keys(patch)) {
    if (!CONFIG_FIELDS.has(field)) throw new PolicyError(`Unknown Mochi config field "${field}".`, { status: 400 })
  }
  const merged = { ...base }
  if ('enabled' in patch) {
    if (typeof patch.enabled !== 'boolean') throw new PolicyError('Mochi config field "enabled" must be a boolean.')
    merged.enabled = patch.enabled
  }
  if ('mode' in patch) {
    if (typeof patch.mode !== 'string' || !MODES.has(patch.mode)) throw new PolicyError('Mochi config field "mode" must be "suggest" or "automatic".')
    merged.mode = patch.mode
  }
  if ('model' in patch) merged.model = safeText(patch.model, 'model', { maxLength: 200, allowEmpty: true })
  if ('clineModel' in patch) merged.clineModel = safeText(patch.clineModel, 'clineModel', { maxLength: 200, allowEmpty: true })
  if ('clineProvider' in patch) {
    if (!['cline', 'openrouter', 'anthropic'].includes(patch.clineProvider)) throw new PolicyError('Choose a supported Cline provider.')
    merged.clineProvider = patch.clineProvider
  }
  if ('brainProvider' in patch) {
    if (typeof patch.brainProvider !== 'string' || !BRAIN_PROVIDERS.has(patch.brainProvider)) {
      throw new PolicyError('Mochi config field "brainProvider" must be "opencode" or "cline".')
    }
    merged.brainProvider = patch.brainProvider
  }
  for (const field of ['autoAnswer', 'autoResume', 'autoApproveTools']) {
    if (field in patch) {
      if (typeof patch[field] !== 'boolean') throw new PolicyError(`Mochi config field "${field}" must be a boolean.`)
      merged[field] = patch[field]
    }
  }
  if (merged.enabled === true && !brainModel(merged)) {
    throw new PolicyError(`Enabling Mochi requires a configured ${brainProviderName(merged)} model (model availability is checked at runtime).`)
  }
  if (merged.mode === 'automatic' && merged.enabled !== true) {
    throw new PolicyError('Automatic mode requires Mochi to be enabled.')
  }
  return merged
}

function defaultOr(current) {
  if (current === undefined || current === null) return {}
  if (!isRecord(current)) throw new PolicyError('Current Mochi config must be an object.', { status: 500 })
  for (const field of Object.keys(current)) {
    if (!CONFIG_FIELDS.has(field)) throw new PolicyError(`Stored Mochi config has unknown field "${field}".`, { status: 500 })
  }
  return current
}

function normalize(partial) {
  const config = { ...DEFAULT_MOCHI_CONFIG, ...partial }
  config.model = typeof config.model === 'string' ? config.model.trim() : ''
  config.clineModel = typeof config.clineModel === 'string' ? config.clineModel.trim() : ''
  if (!['cline', 'openrouter', 'anthropic'].includes(config.clineProvider)) config.clineProvider = 'cline'
  if (config.model.length > 200) throw new PolicyError('Stored Mochi model selector exceeds 200 characters.', { status: 500 })
  if (config.clineModel.length > 200) throw new PolicyError('Stored Mochi Cline model selector exceeds 200 characters.', { status: 500 })
  if (!BRAIN_PROVIDERS.has(config.brainProvider)) {
    // Stored configs from before brain providers existed stay on OpenCode, untouched.
    config.brainProvider = 'opencode'
  }
  if (!MODES.has(config.mode)) throw new PolicyError('Stored Mochi mode is invalid.', { status: 500 })
  for (const field of ['enabled', 'autoAnswer', 'autoResume', 'autoApproveTools']) {
    if (typeof config[field] !== 'boolean') throw new PolicyError(`Stored Mochi config field "${field}" is invalid.`, { status: 500 })
  }
  return config
}

/**
 * Kinds a proposal can carry, and the kinds that may ever be executed.
 * `escalate` is operator work by definition: Mochi never applies it.
 */
export const PROPOSAL_KINDS = Object.freeze(['answer_question', 'resume_task', 'approve_tool', 'escalate'])
export const APPLYABLE_KINDS = Object.freeze(['answer_question', 'resume_task', 'approve_tool'])

/** Tool categories that are hard-denied from any automated or Mochi-routed approval. */
export const HARD_DENIED_TOOL_CATEGORIES = Object.freeze([
  'shell', 'filesystem_write', 'filesystem_delete', 'network_publish',
  'secrets', 'permission_escalation', 'external_database', 'destructive', 'unknown',
])
export const SAFE_TOOL_CATEGORIES = Object.freeze(['read_only', 'safe_inspection'])

const ANSWER_MAX = 2000
const FIELD_COUNT_MAX = 20

function deny(reason, { stale = false } = {}) {
  return { allowed: false, reason, stale }
}

/**
 * One compact, deniable identity check: every identifier the proposal carries
 * must match the live context exactly. A stale approval must not authorize a
 * different question, task, desk, or team.
 */
function identityMatches(proposal, context) {
  const pairs = [
    ['teamId', proposal.teamId, context.teamId],
    ['slotId', proposal.slotId, context.slotId],
    ['threadId', proposal.threadId, context.threadId],
    ['taskId', proposal.taskId, context.taskId],
    ['eventId', proposal.eventId, context.event?.id],
    ['sourceId', proposal.sourceId, context.source?.id],
  ]
  const mismatch = pairs.find(([, left, right]) => left !== right)
  return mismatch ? { field: mismatch[0] } : null
}

function fieldHasOptions(field) {
  return Array.isArray(field?.options) && field.options.length > 0
}

function fieldId(field) {
  return typeof field?.key === 'string' && field.key ? field.key : field?.id ?? null
}

/**
 * Authorize a stored proposal against the *live* re-read context.
 *
 * `context` is the integrator's fresh snapshot for this exact desk, requiring:
 * - `teamId/slotId/threadId/taskId` — the current binding,
 * - `event: {id, kind}` — the live event this proposal belongs to,
 * - `providerReady: true` and `licenseReady: true` — *explicit* booleans
 *   (absent is a denial; Mochi never bypasses provider or license guards),
 * - `source` for the proposal's origin, re-read from the provider right now:
 *   `{id, status, safe, fields?, options?, category?, safeOptionId?}`,
 * - `task: {status}` for resume_task proposals.
 *
 * Returns `{allowed: true, action, ...}` or `{allowed: false, reason, stale?}`.
 * Strict by default: an incomplete context is a denial, never an approval.
 */
export function authorizeProposal(proposal, config, context) {
  if (!isRecord(proposal) || typeof proposal.id !== 'string' || !proposal.id.trim()
    || typeof proposal.eventId !== 'string' || !proposal.eventId.trim()) {
    return deny('proposal is missing a usable id or eventId')
  }
  if (!PROPOSAL_KINDS.includes(proposal.kind)) return deny(`unknown proposal kind "${String(proposal.kind)}"`)
  if (!isRecord(config)) return deny('Mochi config is unavailable')
  if (config.enabled !== true) return deny('Mochi is disabled')
  if (!isRecord(context)) return deny('live context is unavailable for revalidation', { stale: true })

  const mismatch = identityMatches(proposal, context)
  if (mismatch) return deny(`binding changed: proposal ${mismatch.field} does not match the current ${mismatch.field}`, { stale: true })

  // Provider/license guards: explicit true or deny. Absence is not permission.
  if (context.providerReady !== true) return deny('provider is not ready; Mochi never bypasses the provider guard')
  if (context.licenseReady !== true) return deny('license guard failed; Mochi never bypasses licensing')

  if (proposal.status !== 'pending') return deny(`proposal is no longer pending (status "${String(proposal.status)}")`, { stale: true })

  if (proposal.kind === 'escalate') {
    return deny('escalations are presented to the operator; Mochi never acts on them')
  }

  if (!isRecord(context.source) || typeof context.source.id !== 'string') {
    return deny('current source question/permission is unavailable', { stale: true })
  }
  if (context.source.status !== 'pending') {
    return deny(`source is no longer pending (status "${String(context.source.status)}"); the proposal is stale`, { stale: true })
  }
  if (context.source.safe !== true) {
    return deny('source is not deterministically classified as safe; it needs the operator, not Mochi')
  }

  if (proposal.kind === 'answer_question') {
    if (context.event?.kind !== 'question') {
      return deny(`this proposal does not belong to a live question event ("${String(context.event?.kind)}")`, { stale: true })
    }
    const fields = Array.isArray(context.source.fields) ? context.source.fields : []
    if (fields.length > FIELD_COUNT_MAX) return deny('current question has too many fields to validate a safe answer')
    if (!isRecord(proposal.answer) || Object.keys(proposal.answer).length === 0) {
      return deny('proposal carries no usable answer record')
    }
    const answer = {}
    for (const key of Object.keys(proposal.answer)) {
      const field = fields.find(candidate => fieldId(candidate) === key)
      if (!field) return deny(`source question changed: field "${key}" no longer exists in the live form`, { stale: true })
      const value = proposal.answer[key]
      if (typeof value !== 'string') return deny(`answer for field "${key}" must be a string`)
      if (value.length > ANSWER_MAX || ANSWER_CONTROL_CHARS.test(value)) {
        return deny(`answer for field "${key}" exceeds ${ANSWER_MAX} characters or contains control characters`)
      }
      if (fieldHasOptions(field)) {
        const options = field.options.filter(option => typeof option?.value === 'string')
        if (!options.some(option => option.value === value)) {
          return deny(`answer for field "${key}" is not one of the current options`, { stale: true })
        }
      } else if (field.type === 'boolean' && value !== 'true' && value !== 'false') {
        return deny(`answer for boolean field "${key}" must be "true" or "false"`)
      }
      answer[key] = value
    }
    if (fields.some(field => !Object.hasOwn(answer, fieldId(field)))) return deny('The answer must cover every current field')
    return { allowed: true, action: 'answer_question', answer }
  }

  if (proposal.kind === 'resume_task') {
    if (context.event?.kind !== 'failed' && context.event?.kind !== 'tracking_unknown') {
      return deny(`this proposal does not belong to a failure/tracking event ("${String(context.event?.kind)}")`, { stale: true })
    }
    if (!isRecord(context.task)) return deny('current task state is unavailable')
    // A running/queued/waiting task is NOT failure evidence; only a confirmed
    // failure or unknown-tracking state justifies a bounded continuation.
    if (context.task.status !== 'failed') {
      return deny(`task status "${String(context.task.status)}" is not a failure or unknown tracking state`)
    }
    return { allowed: true, action: 'resume_task' }
  }

  // approve_tool: only an exactly-classified, least-privileged option.
  if (proposal.kind === 'approve_tool') {
    if (context.event?.kind !== 'permission') {
      return deny(`this proposal does not belong to a permission event ("${String(context.event?.kind)}")`, { stale: true })
    }
    const category = typeof context.source.category === 'string' ? context.source.category : 'unknown'
    if (HARD_DENIED_TOOL_CATEGORIES.includes(category)) {
      return deny(`tool category "${category}" is hard-denied for Mochi approvals; approve it directly in the provider UI as the operator`)
    }
    if (!SAFE_TOOL_CATEGORIES.includes(category)) {
      return deny(`tool category "${category}" has no safe Mochi policy; classification is missing or unreliable`)
    }
    const options = Array.isArray(context.source.options) ? context.source.options : []
    if (!options.length) return deny('current permission exposes no options to validate a safe approval')
    if (typeof context.source.safeOptionId !== 'string' || !context.source.safeOptionId.trim()) {
      return deny('no exact safe option identified; approve it directly in the provider UI as the operator')
    }
    const option = options.find(candidate => candidate?.id === context.source.safeOptionId)
    if (!option || option.safe !== true) {
      return deny('the identified safe option is not present or not marked safe in the current permission', { stale: true })
    }
    return { allowed: true, action: 'approve_tool', optionId: option.id }
  }

  return deny(`unknown proposal kind "${String(proposal.kind)}"`)
}
