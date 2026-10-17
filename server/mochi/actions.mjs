/**
 * Mochi v1 — safe actions (desk 5).
 *
 * The only path through which a Mochi proposal becomes a real action. Every
 * call: validates the config, re-reads the live context, re-authorizes the
 * proposal against it, gates on mode/auto policy, and only then invokes one
 * of the injected dependencies. Missing dependencies, missing context, stale
 * bindings, or unknown tool categories produce `blocked` results — never
 * success, never an exception that could hide the outcome.
 *
 * Fine points:
 * - In `suggest` mode nothing applies without `operatorApproved: true`.
 * - In `automatic` mode a kind applies only when its config flag is on, and
 *   only for sources the policy classified safe. Unreliable classification
 *   stays blocked even with `autoApproveTools: true`.
 * - Danger categories (shell, filesystem write/delete, network publish,
 *   secrets, permission escalation, external databases) are denied inside
 *   `authorizeProposal` for EVERY caller, operator included, because Mochi is
 *   not the interface for them: they belong to the provider's own approval UI.
 * - Double execution is impossible: an in-flight proposal returns `blocked`,
 *   and the first successful apply marks the proposal id so any later call —
 *   double click included — gets `blocked: already applied`.
 *
 * Wire contract: `.relay-state/reviews/mochi-r1/CONTRACT.md`.
 */

import { authorizeProposal, PolicyError, validateConfig } from './policy.mjs'

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const MAX_APPLIED_MEMORY = 1000

const APPLIED = new Set()
const IN_FLIGHT = new Set()

function rememberApplied(id) {
  APPLIED.add(id)
  while (APPLIED.size > MAX_APPLIED_MEMORY) {
    APPLIED.delete(APPLIED.values().next().value)
  }
}

const blocked = (reason, proposalId = null) => ({ status: 'blocked', proposalId, reason })

/** Test seam: clear the process-local interlocks between isolated checks. */
export function resetActionInterlocks() {
  APPLIED.clear()
  IN_FLIGHT.clear()
}

/**
 * Normalize the caller's current config over the contract defaults so the
 * apply path keeps working even when the store hands back a partial.
 */
function configForApply(config) {
  try {
    return validateConfig({}, config ?? undefined)
  } catch (error) {
    if (error instanceof PolicyError) throw error
    throw new PolicyError('Mochi config is invalid.', { status: 500 })
  }
}

function dependencyFor(deps, action) {
  const table = {
    answer_question: 'answerQuestion',
    resume_task: 'resumeTask',
    approve_tool: 'approveTool',
  }
  const name = table[action]
  return { name, invoke: deps?.[name] }
}

function inputFor(action, decision, context, proposal) {
  const identity = {
    teamId: context.teamId,
    slotId: context.slotId,
    threadId: context.threadId,
    taskId: context.taskId,
    eventId: proposal.eventId,
    sourceId: proposal.sourceId,
  }
  if (action === 'answer_question') return { ...identity, formId: proposal.sourceId, answer: decision.answer }
  if (action === 'approve_tool') return { ...identity, permissionId: proposal.sourceId, optionId: decision.optionId }
  return identity
}

/**
 * Apply one proposal through the guarded action dependencies.
 *
 * `deps` must provide:
 * - `liveContext(proposal)` — fresh re-read of current binding, event, source
 *   question/permission, task status, provider and license readiness (the
 *   shape `authorizeProposal` expects). Without it nothing is applied.
 * - `answerQuestion` / `resumeTask` / `approveTool` — the *existing* guarded
 *   action paths; the integrator adapts their result shape.
 *
 * Returns `{status:'applied', proposalId, action, detail}` or
 * `{status:'blocked', proposalId, reason}`. Dependencies throwing, returning
 * `{ok:false}`, or missing are reported honestly as `blocked`.
 */
export async function applyMochiProposal(proposal, config, deps, { operatorApproved = false } = {}) {
  const id = typeof proposal?.id === 'string' ? proposal.id.trim() : ''
  if (!id) return blocked('proposal is missing a usable id')
  if (APPLIED.has(id)) return blocked('proposal already applied through Mochi; ignoring the repeated request', id)
  // Concurrency interlock must be taken synchronously, before any await:
  // two calls racing past the async context re-read must not both proceed.
  if (IN_FLIGHT.has(id)) return blocked('proposal is already being applied', id)
  IN_FLIGHT.add(id)
  try {
    if (typeof operatorApproved !== 'boolean') return blocked('operatorApproved must be a boolean flag', id)

    let policyConfig
    try {
      policyConfig = configForApply(config)
      if (policyConfig.enabled !== true) return blocked('Mochi is disabled in the team configuration', id)
    } catch (error) {
      return blocked(error instanceof Error ? error.message : 'Mochi config is invalid', id)
    }

    const liveContext = deps?.liveContext
    if (typeof liveContext !== 'function') {
      return blocked('the liveContext dependency is missing; Mochi cannot revalidate the current task state', id)
    }

    let context
    try {
      context = await liveContext(proposal)
    } catch (error) {
      return blocked(`live context could not be re-read: ${error instanceof Error ? error.message : String(error)}`, id)
    }

    const decision = authorizeProposal(proposal, policyConfig, context)
    if (!decision.allowed) return blocked(decision.reason, id)

    // Auto gating: suggest mode is operator-only; automatic mode per-kind flags.
    if (!operatorApproved) {
      if (policyConfig.mode !== 'automatic') {
        return blocked('Mochi runs in suggest mode: it proposed this, the operator must approve it', id)
      }
      const autoFlag = decision.action === 'answer_question' ? policyConfig.autoAnswer
        : decision.action === 'resume_task' ? policyConfig.autoResume
          : policyConfig.autoApproveTools
      if (autoFlag !== true) {
        return blocked(`automatic execution for "${decision.action}" is not enabled; routing to the operator instead`, id)
      }
    }

    const { name, invoke } = dependencyFor(deps, decision.action)
    if (typeof invoke !== 'function') {
      return blocked(`action dependency "${name}" is not wired by the integration yet`, id)
    }

    try {
      const result = await invoke(inputFor(decision.action, decision, context, proposal))
      if (result?.ok === false || !result || (result.status ? result.status !== 'applied' : result.ok !== true)) {
        return blocked(`"${name}" reported failure: ${typeof result?.reason === 'string' ? result.reason : typeof result?.error === 'string' ? result.error : 'no confirmed result'}`, id)
      }
      rememberApplied(id)
      return { status: 'applied', proposalId: id, action: decision.action, detail: result ?? null }
    } catch (error) {
      return blocked(`"${name}" failed after authorization: ${error instanceof Error ? error.message : String(error)}`, id)
    }
  } finally {
    IN_FLIGHT.delete(id)
  }
}
