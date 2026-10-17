/**
 * Mochi wire types + pure validation helpers (Desk 7).
 *
 * Mirrors `.relay-state/reviews/mochi-r1/CONTRACT.md` exactly; this module
 * intentionally imports nothing so the isolated test script can run it under
 * Node's type stripping without DOM or bundler assumptions.
 *
 * Data from the server is treated as untrusted: the snapshot validator below
 * returns null on anything that does not match the wire contract, and the
 * panel renders an honest error instead of guessing.
 */

export type MochiMode = 'suggest' | 'automatic'

export interface MochiConfig {
  enabled: boolean
  mode: MochiMode
  /** `providerID/modelID` chosen by the operator from the local OpenCode catalog. */
  model: string
  autoAnswer: boolean
  autoResume: boolean
  /** v1 never supports automatic tool approvals; the policy must always send those to the operator. */
  autoApproveTools: boolean
}

/** Contract default: everything off, every proposal waits for the operator. */
export const mochiDefaultConfig: MochiConfig = {
  enabled: false,
  mode: 'suggest',
  model: '',
  autoAnswer: false,
  autoResume: false,
  autoApproveTools: false,
}

const mochiModeValues = ['suggest', 'automatic'] as const

export interface MochiEvent {
  id: string
  teamId: string
  slotId: string
  threadId: string
  taskId: string
  kind: 'question' | 'permission' | 'failed' | 'tracking_unknown'
  sourceId: string
  createdAt: string
  /** Bounded sanitized context — never a whole conversation or credential. */
  context: Record<string, unknown>
}

export type MochiEventKind = MochiEvent['kind']

export interface MochiProposal {
  id: string
  eventId: string
  teamId: string
  slotId: string
  threadId: string
  taskId: string
  kind: 'answer_question' | 'resume_task' | 'approve_tool' | 'escalate'
  status: 'pending' | 'applied' | 'rejected' | 'stale' | 'blocked'
  /** Validated form-field IDs to selected/text answers. An approval is not an answer. */
  answer?: Record<string, string>
  reason: string
  createdAt: string
}

export type MochiProposalKind = MochiProposal['kind']
export type MochiProposalStatus = MochiProposal['status']

export type MochiRuntimeState = 'disabled' | 'idle' | 'working' | 'waiting_user' | 'blocked'

export interface MochiRuntime {
  state: MochiRuntimeState
  error: string | null
}

export interface MochiSnapshot {
  config: MochiConfig
  runtime: MochiRuntime
  proposals: MochiProposal[]
  events: MochiEvent[]
}

/** Server-side model result shape, mirrored for completeness of the wire contract. */
export interface MochiModelResult {
  decision: 'answer_question' | 'resume_task' | 'escalate'
  answer?: Record<string, string>
  reason: string
}

export type MochiConfigPatch = {
  enabled?: boolean
  mode?: MochiMode
  model?: string
  autoAnswer?: boolean
  autoResume?: boolean
  autoApproveTools?: boolean
}

const mochiRuntimeStates = ['disabled', 'idle', 'working', 'waiting_user', 'blocked'] as const
const mochiEventKinds = ['question', 'permission', 'failed', 'tracking_unknown'] as const
const mochiProposalKinds = ['answer_question', 'resume_task', 'approve_tool', 'escalate'] as const
const mochiProposalStatuses = ['pending', 'applied', 'rejected', 'stale', 'blocked'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlainModelId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && !value.includes('\u0000')
}

function enumGuard<T extends readonly string[]>(value: unknown, allowed: T): boolean {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function guardStringRecord(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.values(value).every(entry => typeof entry === 'string')
}

function guardProposal(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.eventId === 'string'
    && typeof value.teamId === 'string'
    && typeof value.slotId === 'string'
    && typeof value.threadId === 'string'
    && typeof value.taskId === 'string'
    && enumGuard(value.kind, mochiProposalKinds)
    && enumGuard(value.status, mochiProposalStatuses)
    && typeof value.reason === 'string'
    && typeof value.createdAt === 'string'
    && guardStringRecord(value.answer)
}

function guardEvent(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.teamId === 'string'
    && typeof value.slotId === 'string'
    && typeof value.threadId === 'string'
    && typeof value.taskId === 'string'
    && enumGuard(value.kind, mochiEventKinds)
    && typeof value.sourceId === 'string'
    && typeof value.createdAt === 'string'
    && isRecord(value.context)
}

function guardConfig(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.enabled === 'boolean'
    && enumGuard(value.mode, mochiModeValues)
    && isPlainModelId(value.model)
    && typeof value.autoAnswer === 'boolean'
    && typeof value.autoResume === 'boolean'
    && typeof value.autoApproveTools === 'boolean'
}

/**
 * Strict, allocation-free snapshot guard. Returns null for anything
 * off-contract so callers can surface an honest error, never a mock success.
 */
export function validateMochiSnapshot(value: unknown): MochiSnapshot | null {
  if (!isRecord(value)) return null
  if (!guardConfig(value.config) || !isRecord(value.runtime)) return null
  if (!enumGuard(value.runtime.state, mochiRuntimeStates)) return null
  if (value.runtime.error !== null && typeof value.runtime.error !== 'string') return null
  if (!Array.isArray(value.proposals) || !value.proposals.every(entry => guardProposal(entry))) return null
  if (!Array.isArray(value.events) || !value.events.every(entry => guardEvent(entry))) return null
  return value as unknown as MochiSnapshot
}

/**
 * Returns only known config fields with correctly-typed values, dropping
 * unknown fields before a POST so the wire stays inside the contract.
 */
export function pickMochiConfigPatch(input: unknown): MochiConfigPatch {
  const patch: MochiConfigPatch = {}
  if (!isRecord(input)) return patch
  if (typeof input.enabled === 'boolean') patch.enabled = input.enabled
  if (enumGuard(input.mode, mochiModeValues)) patch.mode = input.mode as MochiMode
  if (isPlainModelId(input.model)) patch.model = input.model.trim()
  if (typeof input.autoAnswer === 'boolean') patch.autoAnswer = input.autoAnswer
  if (typeof input.autoResume === 'boolean') patch.autoResume = input.autoResume
  if (typeof input.autoApproveTools === 'boolean') patch.autoApproveTools = input.autoApproveTools
  return patch
}

/** Same-origin route builder, no secret material ever enters a Mochi URL. */
export function mochiRoute(teamId: string, suffix = ''): string {
  const team = typeof teamId === 'string' ? teamId.trim() : ''
  if (!team) throw new Error('Mochi routes require a team id.')
  const base = `/api/super-agent/teams/${encodeURIComponent(team)}/mochi`
  const route = typeof suffix === 'string' ? suffix.trim().replace(/^\/+|\/+$/g, '') : ''
  return route ? `${base}/${route}` : base
}
