import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { acceptedCodexChangeIds, unacceptedCodexItems } from '../server/conversation-management.mjs'

const source = readFileSync(new URL('../src/lib/diff.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { readCodexFileChanges } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const edit = (id, text, status = 'completed') => ({ id, type: 'fileChange', status,
  changes: [{ path: 'app.ts', diff: `@@ -1 +1 @@\n-before\n+${text}`, kind: { type: 'update' } }],
})
const previous = edit('previous', 'already accepted')
const shown = edit('shown', 'visible when clicked')
const later = edit('later', 'new work after click')
const reply = { id: 'reply', type: 'agentMessage', text: 'Done' }
const items = [previous, shown, later, reply]

// Clicking the current snapshot must not silently accept a later edit,
// even when it changes the same file as already-accepted work.
const accepted = acceptedCodexChangeIds(items, ['previous'], ['shown'])
assert.deepEqual(accepted, ['previous', 'shown'])
const remaining = unacceptedCodexItems(items, accepted)
assert.deepEqual(remaining.map(item => item.id), ['later', 'reply'])
const files = readCodexFileChanges(remaining)
assert.deepEqual(files[0].changeIds, ['later'])
assert.match(files[0].patch, /new work after click/)
assert.doesNotMatch(files[0].patch, /already accepted|visible when clicked/)

const accumulated = readCodexFileChanges([shown, later, shown])
assert.deepEqual(accumulated[0].changeIds, ['shown', 'later'])
assert.equal(accumulated[0].additions, 2)
assert.equal(accumulated[0].deletions, 2)
assert.deepEqual(acceptedCodexChangeIds(items, accepted, ['shown']), accepted)

// Acceptance survives serializing saved session metadata, independent of tab lifetime.
const state = JSON.parse(JSON.stringify({ threads: { one: { acceptedChangeIds: accepted }, two: { acceptedChangeIds: [] } } }))
assert.deepEqual(unacceptedCodexItems(items, state.threads.one.acceptedChangeIds), remaining)
assert.equal(unacceptedCodexItems(items, state.threads.two.acceptedChangeIds).length, items.length)
assert.throws(() => acceptedCodexChangeIds(items, [], ['not-in-this-session']), /not available/)
assert.throws(() => acceptedCodexChangeIds([edit('pending', 'unfinished', 'inProgress')], [], ['pending']), /not available/)
assert.throws(() => acceptedCodexChangeIds(items, [], ['reply']), /not available/)
assert.throws(() => acceptedCodexChangeIds(items, [], []), /valid/)
assert.equal(unacceptedCodexItems([reply], ['reply'])[0], reply)
console.log('Passed: exact edit acceptance persists across reload; prior accepted changes stay hidden; later changes to the same file remain visible; other sessions and chat messages are preserved; duplicate and unfinished changes are handled.')
