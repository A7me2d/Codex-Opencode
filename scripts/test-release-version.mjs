import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { releaseVersion } from './release-version.mjs'

const { gt } = createRequire(import.meta.url)('semver')
for (const [counter, expected] of [[1, '1.0.1'], [9, '1.0.9'], [10, '1.1.0'], [19, '1.1.9'], [20, '1.2.0'], [59, '1.5.9'], [60, '1.6.0'], [99, '1.9.9'], [100, '2.0.0'], [199, '2.9.9'], [200, '3.0.0']]) {
  assert.equal(releaseVersion(String(counter)), expected)
}
assert.ok(gt(releaseVersion(60), '1.0.59'), 'new numbering must remain an upgrade from existing installed versions')
let previous = releaseVersion(1)
for (let counter = 2; counter <= 1000; counter++) {
  const next = releaseVersion(counter)
  assert.ok(gt(next, previous), `${previous} must upgrade to ${next} using the updater's semantic version ordering`)
  previous = next
}
for (const invalid of [0, -1, 1.5, '', undefined, null, '1e2', '10suffix', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => releaseVersion(invalid))
assert.equal(releaseVersion(60), releaseVersion('60'), 'rerunning the same workflow keeps the version stable')
console.log('Passed: patch/minor/major rollover, 1,000 ordered versions, legacy updater compatibility, stable reruns and invalid counters. No releases or package versions were modified.')
