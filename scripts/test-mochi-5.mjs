// Mochi v1 — desk 5 isolated checks (policy.mjs + actions.mjs).
// Pure node, no provider, no store, no network. Run: node scripts/test-mochi-5.mjs
import assert from 'node:assert/strict'
import { applyMochiProposal, resetActionInterlocks } from '../server/mochi/actions.mjs'
import {
  authorizeProposal, PolicyError, validateConfig,
  DEFAULT_MOCHI_CONFIG, SAFE_TOOL_CATEGORIES, HARD_DENIED_TOOL_CATEGORIES,
} from '../server/mochi/policy.mjs'

let passed = 0
const failures = []
const checks = []
const check = (name, run) => checks.push([name, run])

async function main() {
  for (const [name, run] of checks) {
    try {
      await run()
      passed += 1
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`mochi desk-5 checks: ${passed} passed, ${failures.length} failed`)
    process.exitCode = 1
    return
  }
  console.log(`mochi desk-5 checks: ${passed}/${passed} passed`)
}

const CONFIG = validateConfig({ enabled: true, model: 'x/y' }, DEFAULT_MOCHI_CONFIG)

const baseContext = () => ({
  teamId: 'team-1', slotId: 'worker-1', threadId: 'ses_1', taskId: 'task_1',
  event: { id: 'evt_1', kind: 'question' },
  providerReady: true, licenseReady: true,
  source: {
    id: 'frm_1', status: 'pending', safe: true,
    fields: [{ key: 'choice', type: 'string', options: [{ value: 'a' }, { value: 'b' }] }],
  },
  task: { status: 'failed' },
})

const answerProposal = (overrides = {}, context = baseContext(), config = CONFIG) => ({
  id: 'prp_1', eventId: 'evt_1', teamId: context.teamId, slotId: context.slotId,
  threadId: context.threadId, taskId: context.taskId, kind: 'answer_question',
  sourceId: context.source.id, status: 'pending', answer: { choice: 'a' }, reason: 'safe answer',
  ...overrides,
})

const resumeContext = () => ({ ...baseContext(), event: { id: 'evt_2', kind: 'failed' }, source: { id: 'task_1_source', status: 'pending', safe: true } })
const resumeProposal = (context = resumeContext()) => ({
  id: 'prp_r', eventId: 'evt_2', teamId: context.teamId, slotId: context.slotId,
  threadId: context.threadId, taskId: context.taskId, kind: 'resume_task',
  sourceId: context.source.id, status: 'pending', reason: 'confirmed failure',
})

const permissionContext = () => ({
  ...baseContext(), event: { id: 'evt_3', kind: 'permission' },
  source: {
    id: 'prm_1', status: 'pending', safe: true, category: 'read_only',
    options: [{ id: 'opt_allow', safe: true }, { id: 'opt_never', safe: false }],
    safeOptionId: 'opt_allow',
  },
})
const approveProposal = (context = permissionContext()) => ({
  id: 'prp_p', eventId: 'evt_3', teamId: context.teamId, slotId: context.slotId,
  threadId: context.threadId, taskId: context.taskId, kind: 'approve_tool',
  sourceId: context.source.id, status: 'pending', reason: 'least-privilege read-only grant',
})

// ---------------------------------------------------------------- validateConfig
check('config: defaults hold', () => {
  assert.deepEqual(validateConfig({}, undefined), { ...DEFAULT_MOCHI_CONFIG })
})
check('config: rejects unknown fields', () => {
  assert.throws(() => validateConfig({ enabled: true, fontSize: 12 }, undefined), /Unknown Mochi config field/)
})
check('config: strict types (no number-for-boolean)', () => {
  assert.throws(() => validateConfig({ enabled: 1 }, undefined), /must be a boolean/)
  assert.throws(() => validateConfig({ autoAnswer: 'yes' }, undefined), /must be a boolean/)
})
check('config: strict enums', () => {
  assert.throws(() => validateConfig({ mode: 'auto', enabled: true, model: 'x/y' }, undefined), /must be "suggest" or "automatic"/)
})
check('config: enabling requires a model string', () => {
  assert.throws(() => validateConfig({ enabled: true, model: '   ' }, undefined), /requires a configured OpenCode model/)
})
check('config: automatic mode requires enabled', () => {
  assert.throws(() => validateConfig({ mode: 'automatic', enabled: false, model: 'x/y' }, undefined), /Automatic mode requires/)
})
check('config: bounds on model text', () => {
  assert.throws(() => validateConfig({ model: 'm/'.padEnd(260, 'x') }, undefined), /200 characters or fewer/)
  const kept = validateConfig({ model: '  provider/model  ' }, undefined)
  assert.equal(kept.model, 'provider/model')
})
check('config: partial merges over current', () => {
  const next = validateConfig({ mode: 'automatic' }, { ...DEFAULT_MOCHI_CONFIG, enabled: true, model: 'x/y' })
  assert.equal(next.mode, 'automatic'); assert.equal(next.enabled, true)
})

// ------------------------------------------------------------- authorizeProposal
check('authorize: rejects unknown kinds by default', () => {
  const result = authorizeProposal(answerProposal({ kind: 'install_updates' }), CONFIG, baseContext())
  assert.equal(result.allowed, false)
})
check('authorize: escalate is never applicable', () => {
  const result = authorizeProposal(answerProposal({ kind: 'escalate', answer: undefined }), CONFIG, baseContext())
  assert.equal(result.allowed, false); assert.match(result.reason, /operator/)
})
check('authorize: disabled config denies', () => {
  assert.equal(authorizeProposal(answerProposal(), { ...CONFIG, enabled: false }, baseContext()).allowed, false)
})
check('authorize: incomplete context (missing provider flag) denies instead of approving', () => {
  const context = baseContext(); delete context.providerReady
  assert.equal(authorizeProposal(answerProposal(), CONFIG, context).allowed, false)
  const licenseContext = baseContext(); delete licenseContext.licenseReady
  assert.equal(authorizeProposal(answerProposal(), CONFIG, licenseContext).allowed, false)
})
check('authorize: stale — binding changed / source answered / proposal resolved', () => {
  const context = baseContext()
  const staleTeam = authorizeProposal(answerProposal(), CONFIG, { ...context, teamId: 'other-team' })
  assert.equal(staleTeam.allowed, false); assert.equal(staleTeam.stale, true)
  const answered = authorizeProposal(answerProposal(), CONFIG, { ...context, source: { ...context.source, status: 'answered' } })
  assert.equal(answered.allowed, false); assert.equal(answered.stale, true)
  const resolved = authorizeProposal(answerProposal({ status: 'applied' }), CONFIG, context)
  assert.equal(resolved.allowed, false); assert.equal(resolved.stale, true)
})
check('authorize: a stale approval cannot authorize a different question', () => {
  const context = baseContext()
  const moved = authorizeProposal(answerProposal({ sourceId: 'frm_other' }), CONFIG, context)
  assert.equal(moved.allowed, false); assert.equal(moved.stale, true)
  const otherEvent = authorizeProposal(answerProposal({ eventId: 'evt_9' }), CONFIG, context)
  assert.equal(otherEvent.allowed, false); assert.equal(otherEvent.stale, true)
})
check('authorize: unsafe/malicious question sources are operator territory', () => {
  const context = baseContext()
  assert.equal(authorizeProposal(answerProposal(), CONFIG, { ...context, source: { ...context.source, safe: false } }).allowed, false)
})
check('authorize: answers revalidated against live fields/options', () => {
  const context = baseContext()
  const notOption = authorizeProposal(answerProposal({ answer: { choice: 'zzz' } }), CONFIG, context)
  assert.equal(notOption.allowed, false); assert.match(notOption.reason, /not one of the current options/)
  const changed = authorizeProposal(answerProposal({ answer: { join_meeting_url: 'file://attacker' } }), CONFIG, context)
  assert.equal(changed.allowed, false); assert.equal(changed.stale, true)
  const crude = authorizeProposal(answerProposal({ answer: { choice: 'a\n\x0B' } }), CONFIG, context)
  assert.equal(crude.allowed, false); assert.match(crude.reason, /control characters/)
  const deep = authorizeProposal(answerProposal({ answer: { choice: `${'a'.repeat(2000)}b` } }), CONFIG, context)
  assert.equal(deep.allowed, false); assert.match(deep.reason, /2000 characters/)
})
check('authorize: resume only from confirmed failure/tracking_unknown', () => {
  const context = resumeContext()
  assert.deepEqual(authorizeProposal(resumeProposal(context), CONFIG, context).allowed, true)
  const running = { ...context, task: { status: 'running' } }
  const runningResult = authorizeProposal(resumeProposal(running), CONFIG, running)
  assert.equal(runningResult.allowed, false); assert.match(runningResult.reason, /not a failure/)
  const waiting = { ...context, event: { id: 'e', kind: 'question' } }
  assert.equal(authorizeProposal(resumeProposal(waiting), CONFIG, waiting).allowed, false)
})
check('authorize: approve_tool only for classified safe options', () => {
  const context = permissionContext()
  assert.equal(authorizeProposal(approveProposal(context), CONFIG, context).allowed, true)
  assert.deepEqual(authorizeProposal(approveProposal(context), CONFIG, context).optionId, 'opt_allow')
  for (const category of HARD_DENIED_TOOL_CATEGORIES) {
    const hostile = { ...context, source: { ...context.source, category, safe: true } }
    const result = authorizeProposal(approveProposal(hostile), CONFIG, hostile)
    assert.equal(result.allowed, false, category); assert.match(result.reason, /operator|unreliable|denied/)
  }
  const unclassified = { ...context, source: { ...context.source, category: 'surprise_me' } }
  assert.equal(authorizeProposal(approveProposal(unclassified), CONFIG, unclassified).allowed, false)
  const missingOption = { ...context, source: { ...context.source, safeOptionId: 'opt_ghost' } }
  assert.equal(authorizeProposal(approveProposal(missingOption), CONFIG, missingOption).allowed, false)
  assert.deepEqual(SAFE_TOOL_CATEGORIES, ['read_only', 'safe_inspection'])
})

// ------------------------------------------------------------- applyMochiProposal
const okContextDeps = context => ({
  liveContext: async () => ({ ...context, providerReady: true, licenseReady: true }),
})

check('apply: suggest mode never auto-applies (blocked proposal, no dep call)', () => {
  resetActionInterlocks()
  let called = 0
  const result = applyMochiProposal(answerProposal(), CONFIG, {
    ...okContextDeps(baseContext()), answerQuestion: async () => { called += 1; return { ok: true } },
  })
  return Promise.resolve(result).then(r => { assert.equal(r.status, 'blocked'); assert.equal(called, 0) })
})

;[{
  name: 'apply: operator-approved answer applies via deps.answerQuestion with exact identity',
  proposal: answerProposal(), context: baseContext(), operatorApproved: true,
  dep: 'answerQuestion', enabled: true,
}, {
  name: 'apply: automatic answer applies only when autoAnswer is on',
  proposal: answerProposal(), context: baseContext(), operatorApproved: false,
  dep: 'answerQuestion', enabled: true, flags: { mode: 'automatic', autoAnswer: true },
}, {
  name: 'apply: automatic resume blocked when autoResume off',
  proposal: resumeProposal(), context: resumeContext(), operatorApproved: false,
  dep: 'resumeTask', enabled: false, flags: { mode: 'automatic', autoAnswer: true },
}, {
  name: 'apply: automatic resume applies with autoResume on',
  proposal: resumeProposal(), context: resumeContext(), operatorApproved: false,
  dep: 'resumeTask', enabled: true, flags: { mode: 'automatic', autoResume: true },
}].forEach(test => {
  check(test.name, () => {
    resetActionInterlocks()
    const proposals = [], calls = []
    const deps = {
      ...okContextDeps(test.context),
      answerQuestion: async input => { calls.push(['answerQuestion', input]); return { ok: true } },
      resumeTask: async input => { calls.push(['resumeTask', input]); return { ok: true } },
      approveTool: async input => { calls.push(['approveTool', input]); return { ok: true } },
    }
    const config = validateConfig({ ...test.flags, enabled: true, model: 'x/y' }, DEFAULT_MOCHI_CONFIG)
    return Promise.resolve(applyMochiProposal(test.proposal, config, deps, { operatorApproved: test.operatorApproved }))
      .then(result => {
        const expectAllowed = test.enabled
        assert.equal(result.status, expectAllowed ? 'applied' : 'blocked')
        assert.equal(calls.length, expectAllowed ? 1 : 0)
        if (expectAllowed) {
          const [name, input] = calls[0]
          assert.equal(name, test.dep)
          assert.equal(input.teamId, 'team-1'); assert.equal(input.threadId, 'ses_1')
          assert.equal(input.eventId, test.proposal.eventId)
        }
      })
  })
})

check('apply: propose-tool unsafe categories are blocked even with autoApproveTools and operator approval', async () => {
  resetActionInterlocks()
  for (const category of HARD_DENIED_TOOL_CATEGORIES) {
    resetActionInterlocks()
    const context = { ...permissionContext(), source: { ...permissionContext().source, category, safe: true } }
    let called = 0
    const deps = {
      ...okContextDeps(context),
      approveTool: async () => { called += 1; return { ok: true } },
    }
    const config = validateConfig({ mode: 'automatic', autoApproveTools: true, enabled: true, model: 'x/y' }, DEFAULT_MOCHI_CONFIG)
    const auto = await applyMochiProposal(approveProposal(context), config, deps)
    assert.equal(auto.status, 'blocked', category)
    const manual = await applyMochiProposal(approveProposal(context), config, deps, { operatorApproved: true })
    assert.equal(manual.status, 'blocked', `${category} operator route`)
    assert.equal(called, 0)
  }
})

check('apply: reliable safe classification applies with autoApproveTools', async () => {
  resetActionInterlocks()
  const context = permissionContext()
  let calls = []
  const deps = { ...okContextDeps(context), approveTool: async input => { calls.push(input); return { ok: true } } }
  const config = validateConfig({ mode: 'automatic', autoApproveTools: true, enabled: true, model: 'x/y' }, DEFAULT_MOCHI_CONFIG)
  const result = await applyMochiProposal(approveProposal(context), config, deps)
  assert.equal(result.status, 'applied'); assert.equal(calls.length, 1)
  assert.equal(calls[0].permissionId, 'prm_1'); assert.equal(calls[0].optionId, 'opt_allow')
})

check('apply: unreliable classification (no explicit flags) stays blocked with autoApproveTools on', async () => {
  resetActionInterlocks()
  const context = permissionContext()
  const deps = {
    liveContext: async () => ({
      ...context, providerReady: true, licenseReady: true,
      source: { id: 'prm_1', status: 'pending' }, // no safe/category/option classification at all
    }),
    approveTool: async () => { throw new Error('must never be called') },
  }
  const config = validateConfig({ mode: 'automatic', autoApproveTools: true, enabled: true, model: 'x/y' }, DEFAULT_MOCHI_CONFIG)
  const result = await applyMochiProposal(approveProposal(context), config, deps)
  assert.equal(result.status, 'blocked')
  assert.match(result.reason, /operator|classification|available/)
})

check('apply: missing dependency is blocked, never success', async () => {
  resetActionInterlocks()
  const result = await applyMochiProposal(answerProposal(), CONFIG, { ...okContextDeps(baseContext()) }, { operatorApproved: true })
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /answerQuestion/)
})

check('apply: missing liveContext is blocked, never success', async () => {
  resetActionInterlocks()
  const result = await applyMochiProposal(answerProposal(), CONFIG, { answerQuestion: async () => ({ ok: true }) }, { operatorApproved: true })
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /liveContext/)
})

check('apply: dep throw and {ok:false} are reported honestly as blocked', async () => {
  resetActionInterlocks()
  const failing = await applyMochiProposal(answerProposal({ id: 'prp_throw' }), CONFIG, {
    ...okContextDeps(baseContext()), answerQuestion: async () => { throw new Error('provider exploded') },
  }, { operatorApproved: true })
  assert.equal(failing.status, 'blocked'); assert.match(failing.reason, /provider exploded/)
  resetActionInterlocks()
  const refusing = await applyMochiProposal(answerProposal({ id: 'prp_refuse' }), CONFIG, {
    ...okContextDeps(baseContext()), answerQuestion: async () => ({ ok: false, error: 'form already answered' }),
  }, { operatorApproved: true })
  assert.equal(refusing.status, 'blocked'); assert.match(refusing.reason, /already answered/)
})

check('apply: double click — in-flight proposal is blocked, never executed twice', async () => {
  resetActionInterlocks()
  let calls = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const deps = {
    ...okContextDeps(baseContext()),
    answerQuestion: async () => { calls += 1; await gate; return { ok: true } },
  }
  const proposal = answerProposal({ id: 'prp_double' })
  const first = applyMochiProposal(proposal, CONFIG, deps, { operatorApproved: true })
  const second = applyMochiProposal(proposal, CONFIG, deps, { operatorApproved: true })
    .then(result => ({ status: result.status, reason: result.reason }))
  // Let the in-flight dep actually start, then release the gate.
  await new Promise(resolve => setImmediate(resolve))
  release()
  const applied = await first
  assert.equal(((applied.status) === 'applied'), true)
  const secondResult = await second
  assert.equal(secondResult.status, 'blocked'); assert.match(secondResult.reason, /already being applied/)
  assert.equal(calls, 1)
})

check('apply: idempotency — a completed proposal cannot run again', async () => {
  resetActionInterlocks()
  let calls = 0
  const deps = { ...okContextDeps(baseContext()), answerQuestion: async () => { calls += 1; return { ok: true } } }
  const proposal = answerProposal({ id: 'prp_once' })
  const first = await applyMochiProposal(proposal, CONFIG, deps, { operatorApproved: true })
  assert.equal(first.status, 'applied')
  const second = await applyMochiProposal(proposal, CONFIG, deps, { operatorApproved: true })
  assert.equal(second.status, 'blocked'); assert.match(second.reason, /already applied/)
  assert.equal(calls, 1)
})

check('apply: disabled config blocks even operator approval', async () => {
  resetActionInterlocks()
  const result = await applyMochiProposal(answerProposal(), { ...CONFIG, enabled: false }, {
    ...okContextDeps(baseContext()), answerQuestion: async () => ({ ok: true }),
  }, { operatorApproved: true })
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /disabled/)
})

check('apply: absent, stale or blocked action results cannot become success', async () => {
  for (const outcome of [undefined, null, { status: 'blocked' }, { status: 'stale' }, { ok: true, status: 'failed' }]) {
    resetActionInterlocks()
    const result = await applyMochiProposal(answerProposal(), CONFIG, { ...okContextDeps(baseContext()), answerQuestion: async () => outcome }, { operatorApproved: true })
    assert.equal(result.status, 'blocked')
  }
})
await main()
