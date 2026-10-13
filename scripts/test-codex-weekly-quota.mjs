import assert from 'node:assert/strict'
import { codexWeeklyQuota } from '../server/codex-weekly-quota.mjs'

const weekly = { windowDurationMins: 10080, usedPercent: 28.5, resetsAt: 1800000000 }
const short = { windowDurationMins: 300, usedPercent: 90 }
assert.deepEqual(codexWeeklyQuota({ rateLimits: { primary: short, secondary: weekly } }),
  { available: true, remainingPercent: 71.5, resetsAt: 1800000000 })
assert.equal(codexWeeklyQuota({ rateLimitsByLimitId: { codex: { primary: weekly } }, rateLimits: { limitId: 'other', secondary: short } }).remainingPercent, 71.5)
for (const response of [null, {}, { rateLimits: { secondary: short } }, { rateLimits: { limitId: 'other', secondary: weekly } }, { rateLimits: { secondary: { ...weekly, usedPercent: NaN } } }]) {
  assert.equal(codexWeeklyQuota(response).available, false, 'missing weekly Codex quota must not substitute other usage')
}
assert.equal(codexWeeklyQuota({ rateLimits: { secondary: { ...weekly, usedPercent: 100 } } }).remainingPercent, 0)
console.log('Passed: weekly remaining allowance, multiple buckets, missing data and exhausted quota.')
