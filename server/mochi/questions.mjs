import { randomUUID } from 'node:crypto'

/**
 * Mochi desk 3 — questions planner.
 *
 * Builds exactly ONE clarification proposal for a `question` event, or null.
 *
 * Modes of answering (in order of preference):
 *   1. Deterministic answer: used ONLY when the event context carries explicit
 *      evidence (`context.evidence`) for EVERY form field, each validated
 *      against the actual field id/options the question really shows.
 *   2. Model decision via the injected `decide` — the model result is untrusted
 *      data: answers are re-validated field by field before they become a
 *      proposal. Never executed as instructions.
 *   3. Escalate to the operator — anything dangerous, secret-bearing,
 *      destructive, malformed, conflicting or ambiguous.
 *
 * This planner never applies anything: every proposal it returns is
 * `status:'pending'` and it invokes no provider action itself. `decide` is only
 * ever called for clarification wording; approvals and source-change accepts
 * are out of scope in v1 (desks 5/8).
 */

const DANGEROUS =
  /\b(password|passwd|secret|token|api[-_]?key|credential|private[-_ ]?key|access[-_ ]?key)\b|\b(delete|purge|wipe|erase|format|uninstall|shutdown)\b|\brm\s+-[rf]\b|\b(sudo|drop\s+table)\b|\$\(|`|\bhook\b|\bwebhook\b/i

const APPROVAL_OR_SENSITIVE = /\b(approve|allow|permission|execute|run|install|command|shell|commit|push|deploy|migration)\b|حذف|مسح|توكن|مفتاح|كلمة\s*(?:المرور|السر)|موافق|صلاحيات|تنفيذ\s*أمر|نشر|قاعدة\s*البيانات/i

const dangerousText = value => typeof value === 'string' && (DANGEROUS.test(value) || APPROVAL_OR_SENSITIVE.test(value))

/** A question/label that asks to reveal a secret or perform something destructive. */
const dangerousField = field => dangerousText(field.id) || dangerousText(field.label ?? '') || dangerousText(field.question ?? '')

export const questionIsSensitive = context => dangerousText(context?.question)
  || (Array.isArray(context?.fields) && context.fields.some(field => dangerousField(field || {})))

function optionValues(options) {
  if (!Array.isArray(options) || options.length === 0) return null
  const values = []
  for (const option of options) {
    const value = typeof option === 'string' ? option : option && typeof option === 'object' && typeof option.id === 'string' ? option.id : null
    if (value === null) return null
    values.push(value)
  }
  return values
}

/**
 * Validate a candidate answer map (from context evidence or the model) against
 * the REAL form fields. Returns {answers} or {reason} — unknown fields,
 * disallowed choices and non-string values are rejected, never guessed.
 */
function validateAnswers(candidate, fields) {
  const answers = {}
  const used = new Set()
  for (const field of fields) {
    const value = candidate?.[field.id]
    if (value === undefined) return { reason: `missing answer for field '${field.id}'` }
    if (typeof value !== 'string') return { reason: `'${field.id}' answer is not a string` }
    const allowed = optionValues(field.options)
    if (allowed && !allowed.includes(value)) return { reason: `'${field.id}' answer is not one of the field's options` }
    answers[field.id] = value
    used.add(field.id)
  }
  for (const key of Object.keys(candidate ?? {})) {
    if (!used.has(key)) return { reason: `answer references unknown field '${key}'` }
  }
  return { answers }
}

export async function planQuestion(event, config, { decide, id = () => randomUUID(), now = () => new Date().toISOString() } = {}) {
  if (!event || typeof event !== 'object' || event.kind !== 'question') return null
  if (!config || typeof config !== 'object' || config.enabled !== true) return null
  if (Array.isArray(event.context?.fields) ? event.context.fields.length === 0 : true) {
    // Without the real form there is nothing answers can be validated against.
    return escalate(event, id, now, 'the event carries no form fields to validate an answer against')
  }

  const context = event.context ?? {}
  if (context.operatorOnly === true) return escalate(event, id, now, 'the original question requires operator review')
  const questionText = typeof context.question === 'string' ? context.question : ''
  const fields = event.context.fields

  if (!questionText) return escalate(event, id, now, 'the question text is missing — cannot plan honestly')
  if (dangerousText(questionText)) return escalate(event, id, now, 'the question mentions secrets or destructive actions — operator only')
  for (const field of fields) {
    if (!field || typeof field.id !== 'string' || !field.id) return escalate(event, id, now, 'a form field is malformed')
    if (dangerousField(field)) return escalate(event, id, now, `field '${field.id}' touches secrets or destructive actions — operator only`)
    if (!field.options && field.type !== 'text') return escalate(event, id, now, `field '${field.id}' has no known answer type — ambiguous`)
  }

  const evidence = context.evidence && typeof context.evidence === 'object' ? context.evidence : {}
  const complete = fields.every(field => evidence[field.id] !== undefined)
  if (complete) {
    const checked = validateAnswers(evidence, fields)
    if (checked.reason) return escalate(event, id, now, `context evidence is unsafe: ${checked.reason}`)
    return answer(event, id, now, checked.answers, 'answered deterministically from explicit context evidence, validated against the real form fields')
  }

  if (typeof decide !== 'function') return escalate(event, id, now, 'the question is ambiguous and no model decision is available')

  const result = await decide(event, config)
  if (!result || typeof result !== 'object') return escalate(event, id, now, 'the model decision was not a usable object')
  if (result.decision === 'escalate' || result.decision === 'resume_task') {
    // resume_task is recovery's domain (desk 4), not a clarification answer.
    return escalate(event, id, now, typeof result.reason === 'string' && result.reason ? `model says escalate: ${result.reason}` : 'the model chose to escalate')
  }
  if (result.decision !== 'answer_question') return escalate(event, id, now, `model decision '${result.decision}' is not a clarification answer`)
  const checked = validateAnswers(result.answer, fields)
  if (checked.reason) return escalate(event, id, now, `model answer failed validation: ${checked.reason}`)
  return answer(event, id, now, checked.answers, typeof result.reason === 'string' && result.reason ? result.reason : 'input from model, validated against the real form fields')
}

function base(event, { id: pid, now }) {
  return {
    id: `mochi-proposal-${pid()}`,
    eventId: event.id,
    teamId: event.teamId,
    slotId: event.slotId,
    threadId: event.threadId,
    taskId: event.taskId,
    sourceId: event.sourceId,
    status: 'pending',
    createdAt: now(),
  }
}

function answer(event, pid, now, answers, reason) {
  return { ...base(event, { id: pid, now }), kind: 'answer_question', answer: answers, reason }
}

function escalate(event, pid, now, reason) {
  return { ...base(event, { id: pid, now }), kind: 'escalate', reason: reason ?? 'escalated to the operator' }
}
