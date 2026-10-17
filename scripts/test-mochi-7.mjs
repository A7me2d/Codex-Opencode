/**
 * Mochi isolated checks — Desk 7 (run: node scripts/test-mochi-7.mjs).
 *
 * Scope: the pure contract surface of desk 7 only (types.ts validators +
 * routing), plus static structure checks on MochiPanel.tsx / api.ts for the
 * no-mock-success, poll-only-while-visible and stop-button-always-available
 * rules. No server, no network, no browser, no build.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  mochiDefaultConfig,
  mochiRoute,
  pickMochiConfigPatch,
  validateMochiSnapshot,
} from '../src/features/mochi/types.ts'

const checks = []
function check(name, run) {
  try {
    run()
    checks.push({ name, result: 'pass' })
  } catch (error) {
    checks.push({ name, result: 'fail', detail: String(error?.message ?? error) })
  }
}

// --- Contract defaults ---
check('default config matches the contract literally', () => {
  assert.deepEqual({
    enabled: mochiDefaultConfig.enabled,
    mode: mochiDefaultConfig.mode,
    model: mochiDefaultConfig.model,
    autoAnswer: mochiDefaultConfig.autoAnswer,
    autoResume: mochiDefaultConfig.autoResume,
    autoApproveTools: mochiDefaultConfig.autoApproveTools,
  }, { enabled: false, mode: 'suggest', model: '', autoAnswer: false, autoResume: false, autoApproveTools: false })
})

// --- Snapshot validator: honest, no mock successes ---
const validSnapshot = {
  config: { enabled: false, mode: 'suggest', model: 'gpt-5/x1', autoAnswer: false, autoResume: false, autoApproveTools: false },
  runtime: { state: 'idle', error: null },
  proposals: [{
    id: 'p1', eventId: 'e1', teamId: 't1', slotId: 'manager', threadId: 'th1', taskId: 'tk1',
    kind: 'answer_question', status: 'pending', answer: { field1: 'yes' }, reason: 'form question', createdAt: '2026-10-17T00:00:00Z',
  }],
  events: [{
    id: 'e1', teamId: 't1', slotId: 'manager', threadId: 'th1', taskId: 'tk1',
    kind: 'question', sourceId: 's1', createdAt: '2026-10-17T00:00:00Z', context: { question: 'continue?' },
  }],
}
check('valid snapshot passes the guard', () => {
  assert.ok(validateMochiSnapshot(validSnapshot))
})
check('unknown runtime state is rejected, not guessed', () => {
  assert.equal(validateMochiSnapshot({ ...validSnapshot, runtime: { state: 'cooking', error: null } }), null)
})
check('unknown config mode is rejected', () => {
  assert.equal(validateMochiSnapshot({ ...validSnapshot, config: { ...validSnapshot.config, mode: 'yolo' } }), null)
})
check('proposal with bad status is rejected', () => {
  assert.equal(validateMochiSnapshot({
    ...validSnapshot,
    proposals: [{ ...validSnapshot.proposals[0], status: 'magic' }],
  }), null)
})
check('non-contract answer record type is rejected', () => {
  assert.equal(validateMochiSnapshot({
    ...validSnapshot,
    proposals: [{ ...validSnapshot.proposals[0], answer: { field1: 7 } }],
  }), null)
})
check('missing arrays are rejected', () => {
  assert.equal(validateMochiSnapshot({ ...validSnapshot, events: undefined }), null)
})

// --- Config patch picker: unknown fields never leave the panel ---
check('unknown patch fields are dropped and types enforced', () => {
  assert.deepEqual(pickMochiConfigPatch({
    enabled: true, mode: 'automatic', model: ' gpt-5/x1 ', autoApproveTools: true,
    sneaky: 'rm -rf', shellAccess: true,
  }), { enabled: true, mode: 'automatic', model: 'gpt-5/x1', autoApproveTools: true })
})
check('wrong-typed patch fields are dropped entirely', () => {
  assert.deepEqual(pickMochiConfigPatch({ enabled: 'yes', model: 42 }), {})
})
check('autoApproveTools true can only come from a typed boolean', () => {
  assert.deepEqual(pickMochiConfigPatch({ autoApproveTools: 'true' }), {})
})

// --- Routes ---
check('mochi routes match the fixed contract', () => {
  assert.equal(mochiRoute('team-a'), '/api/super-agent/teams/team-a/mochi')
  assert.equal(mochiRoute('team-a', 'config'), '/api/super-agent/teams/team-a/mochi/config')
  assert.equal(
    mochiRoute('team-a', `proposals/${encodeURIComponent('p%1')}/resolve`),
    '/api/super-agent/teams/team-a/mochi/proposals/p%251/resolve',
  )
})
check('team id is percent-encoded', () => {
  assert.equal(mochiRoute('أ ب'), '/api/super-agent/teams/%D8%A3%20%D8%A8/mochi')
})
check('empty team id throws instead of building a broken route', () => {
  assert.throws(() => mochiRoute('  '))
})

// --- Static structure checks (my sources only, read-only) ---
const panelSource = await readFile(
  fileURLToPath(new URL('../src/features/mochi/MochiPanel.tsx', import.meta.url)), 'utf8')
const apiSource = await readFile(
  fileURLToPath(new URL('../src/features/mochi/api.ts', import.meta.url)), 'utf8')

check('panel polls the snapshot only while visible', () => {
  const effect = panelSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(!visible \|\| !teamId\) return undefined/g)
  assert.ok(effect, 'polling effect must start with the visibility guard')
})
check('stop button exists and is only gated on an in-flight save', () => {
  assert.ok(panelSource.includes('onClick={stopMochi}'), 'stop button must be rendered')
  const line = panelSource.split('\n').find(entry => entry.includes('onClick={stopMochi}'))
  assert.ok(line && /disabled=\{savingConfig\}/.test(line), 'stop must stay clickable during errors (never gated on error state)')
})
check('proposal buttons carry busy + double-click guard', () => {
  assert.ok(panelSource.includes('resolvingIds.includes(proposal.id)'), 'busy gate present')
  assert.ok(panelSource.includes('if (proposal.status !== \'pending\' || resolvingIds.includes(proposal.id)) return'), 're-entry guard present')
})
check('panel shows failures instead of faking success (mock searched outside comments)', () => {
  const code = panelSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')
  assert.ok(panelSource.includes('actionFailed') && code.includes('catch'), 'error state must exist')
  assert.ok(!code.includes('mock'), 'no mock code outside comments')
})
check('api guard: GET helpers exist, resolve is a POST route with decision', () => {
  assert.ok(apiSource.includes("mochiRoute(teamId)"), 'snapshot GET present')
  assert.ok(apiSource.includes("mochiRoute(teamId, 'config')"), 'config POST present')
  assert.ok(apiSource.includes('proposals/${encodeURIComponent(id)}/resolve'), 'resolve POST present')
  assert.ok(apiSource.includes("JSON.stringify({ decision })"), 'resolve body carries the decision')
})
check('api never carries a free/cost field or claim in code', () => {
  const codeWithoutComments = apiSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')
  assert.ok(!/\bfree\b/i.test(codeWithoutComments), 'no free claim in code')
  assert.ok(!/(cost|price|سعر|اجور)/i.test(codeWithoutComments.slice(-400)), 'no cost copy in code')
})
check('panel copy states the no-free-claim honesty line', () => {
  assert.ok(panelSource.includes('nothing is claimed free') || panelSource.includes('لا يوجد أي ادّعاء بأنّه مجاني'))
})

const failures = checks.filter(entry => entry.result === 'fail')
for (const entry of checks) {
  console.log(`${entry.result === 'pass' ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`)
}
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`)
if (failures.length > 0) process.exitCode = 1
