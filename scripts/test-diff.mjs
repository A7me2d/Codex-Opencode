import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/diff.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const { readDiffLines, readCodexFileChanges } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const lines = readDiffLines('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -7,3 +7,3 @@\n context\n-before\n+after\n same\n@@ -20 +25,2 @@\n-old\n+new\n+extra\n\\ No newline at end of file\n')
assert.deepEqual(lines.filter((line) => line.kind === 'added').map((line) => line.newLine), [8, 25, 26])
assert.deepEqual(lines.filter((line) => line.kind === 'removed').map((line) => line.oldLine), [8, 20])
assert.deepEqual(lines.filter((line) => line.kind === 'context').map((line) => [line.oldLine, line.newLine]), [[7, 7], [9, 9]])
assert.equal(lines.filter((line) => line.kind === 'note').length, 1)
assert.equal(readDiffLines('@@ -0,0 +1,2 @@\n+one\n+two\n')[2].newLine, 2)
assert.equal(readDiffLines('@@ -1,2 +0,0 @@\n-one\n-two\n')[2].oldLine, 2)
assert.equal(readDiffLines('Binary files a/image.png and b/image.png differ').length, 0)
console.log('Passed: accurate old/new line numbers across hunks, additions, deletions, new/deleted files and binary fallback.')
const completed = { id: 'edit', type: 'fileChange', status: 'completed', changes: [{ path: 'app.ts', diff: '@@ -1 +1 @@\n-old\n+new\n', kind: { type: 'update' } }] }
const changes = readCodexFileChanges([completed, completed, { ...completed, id: 'failed', status: 'failed' }])
assert.equal(changes.length, 1)
assert.equal(changes[0].additions, 1)
assert.equal(changes[0].deletions, 1)
assert.equal(changes[0].file, 'app.ts')
assert.deepEqual(readCodexFileChanges(null), [])
console.log('Passed: Codex changes exclude failed patches and duplicate records.')
