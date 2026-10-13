import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { SourceControl, parseGitStatus } from '../server/source-control.mjs'

// All Git calls are simulated: no index, commit, remote or project file is changed.
const root = await realpath(process.cwd()), calls = []
let porcelain = ' M file with space.ts\0?? new.ts\0AM partial.ts\0R  renamed.ts\0original.ts\0'
let raw = 'initial staged snapshot', head = 'abc123', upstream = true
let waitForCommit, releaseCommit
const run = async (cwd, args) => {
  assert.equal(cwd, root); calls.push(args)
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return root + '\n'
  if (args[0] === 'status') return porcelain
  if (args[0] === 'symbolic-ref') return 'main\n'
  if (args[0] === 'remote') return 'origin\n'
  if (args[0] === 'diff' && args.includes('--raw')) return raw
  if (args[0] === 'diff') return '--- a/partial.ts\n+++ b/partial.ts\n-old\n+new\n'
  if (args[0] === 'rev-parse' && args[1] === '--verify') { if (!head) throw Error('unborn'); return head }
  if (args[0] === 'rev-parse') { if (!upstream) throw Error('no upstream'); return 'origin/main' }
  if (args[0] === 'rev-list') return '2\t1\n'
  if (args[0] === 'config') return args[2].endsWith('.remote') ? 'origin' : 'refs/heads/main'
  if (args[0] === 'commit' && waitForCommit) await waitForCommit
  return ''
}
const source = new SourceControl(run)
const parsed = parseGitStatus(porcelain)
assert.equal(parsed.length, 4)
assert.equal(parsed[0].path, 'file with space.ts')
assert.equal(parsed[1].staged, false)
assert.equal(parsed[1].changed, true)
assert.equal(parsed[2].staged && parsed[2].changed, true, 'partial staging appears in both groups')
assert.equal(parsed[3].originalPath, 'original.ts', 'NUL rename order is destination then original')
assert.equal(parseGitStatus('UU conflict.ts\0')[0].conflict, true)
const status = await source.status(root, root)
assert.equal(status.ahead, 2); assert.equal(status.behind, 1)
assert.equal(calls.every(args => !['add', 'restore', 'rm', 'commit', 'push'].includes(args[0])), true, 'opening Source Control is read-only')
await source.action(root, { root, action: 'stage', paths: ['file with space.ts'] })
assert.deepEqual(calls.find(args => args[0] === 'add'), ['add', '-A', '--', 'file with space.ts'])
await assert.rejects(source.action(root, { root, action: 'stage', paths: ['../outside'] }), /Refresh/)
await source.action(root, { root, action: 'unstage', paths: ['renamed.ts'] })
assert.deepEqual(calls.find(args => args[0] === 'restore'), ['restore', '--staged', '--', 'renamed.ts', 'original.ts'])
const commitInput = { root, action: 'commit', message: 'Fixture message', stagedVersion: status.stagedVersion }
raw = 'changed staged snapshot'
await assert.rejects(source.action(root, commitInput), /Staged Changes changed/)
raw = 'initial staged snapshot'
assert.equal((await source.commitContext(root, { root, stagedVersion: status.stagedVersion })).diff.includes('+new'), true)
await assert.rejects(source.commitContext(root, { root, stagedVersion: 'stale' }), /Staged Changes changed/)
await assert.rejects(source.action(root, { ...commitInput, message: '' }), /commit message/)
porcelain = 'UU conflict.ts\0M  partial.ts\0'
await assert.rejects(source.commitContext(root, { root, stagedVersion: status.stagedVersion }), /Merge Changes/)
await assert.rejects(source.action(root, commitInput), /Merge Changes/)
porcelain = ' M file with space.ts\0M  partial.ts\0'
await source.action(root, commitInput)
assert.deepEqual(calls.find(args => args[0] === 'commit'), ['commit', '-m', 'Fixture message'], 'Commit never stages unstaged changes')
waitForCommit = new Promise(resolve => { releaseCommit = resolve })
const pending = source.action(root, commitInput)
for (let i = 0; i < 20 && !source.locks.size; i++) await new Promise(resolve => setTimeout(resolve, 1))
await assert.rejects(source.action(root, { root, action: 'stage', paths: ['file with space.ts'] }), /already running/)
releaseCommit(); await pending; waitForCommit = null
await source.action(root, { root, action: 'push', head, branch: 'main' })
assert.deepEqual(calls.find(args => args[0] === 'push'), ['push', '--', 'origin', 'HEAD:refs/heads/main'])
assert.equal(calls.some(args => args.includes('--force') || args.includes('--force-with-lease')), false)
await assert.rejects(source.action(root, { root, action: 'push', head: 'old', branch: 'main' }), /branch changed/)
upstream = false
await source.action(root, { root, action: 'publish', remote: 'origin', head, branch: 'main' })
assert.equal(calls.some(args => args[0] === 'push' && args.includes('--set-upstream')), true)
head = ''
await source.action(root, { root, action: 'unstage', paths: ['partial.ts'] })
assert.deepEqual(calls.find(args => args[0] === 'rm'), ['rm', '--cached', '--ignore-unmatch', '--', 'partial.ts'])
assert.equal((await source.diff(root, { root, path: 'partial.ts', staged: true })).text.includes('+new'), true)
await assert.rejects(source.diff(root, { root, path: '../outside' }), /no longer available/)
console.log('Passed: Git status/rename/partial-stage parsing, read-only refresh, scoped staging, staged snapshot checks, conflict blocking, serialized writes, current-branch push/publish, unborn unstage and diff. All Git operations were simulated.')
