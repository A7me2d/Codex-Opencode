import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Drive the actual room hook while its provider's thread list is still stale.
const slots = [], effects = [], requests = new Map(), loaders = []
let cursor = 0, finishCreation, finishList
const old = { id: 'old-thread', title: 'Old', directory: 'D:/project', updatedAt: 1 }
const created = { id: 'new-thread', title: 'New', directory: 'D:/project', updatedAt: 2 }
const api = Object.fromEntries(['codexStatus', 'openCodeStatus', 'project', 'threads', 'archivedThreads', 'relayEvents', 'models', 'workflow', 'openCodeSessions'].map(name => [name, () => {}]))
api.createThread = () => new Promise(resolve => { finishCreation = resolve })
const values = new Map([[api.codexStatus, { connected: true }], [api.project, { workRoot: 'D:/project' }], [api.threads, [old]], [api.workflow, { workflow: { planner: 'codex', executor: 'opencode' } }]])
const activity = { ready: true, providers: { codex: true, opencode: true, cline: true } }
const react = {
  useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
  useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, index) => !Object.is(dep, slots[i].deps[index]))) slots[i] = { value: fn(), deps }; return slots[i].value },
  useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
  useEffect(fn, deps) { const i = cursor++; if (slots[i] && deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) return; const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) },
}
const modules = {
  react, '../lib/api': { api }, '../lib/i18n': { tr: value => value }, '../app/config': { config: { poll: new Proxy({}, { get: () => 1000 }) } },
  '../lib/guards': { asArray: value => Array.isArray(value) ? value : [] }, '../lib/format': { toEpoch: value => value || 0 },
  '../lib/review': { openCodeReviewPrompt: () => '' }, './useProviderActivity': { useProviderActivity: () => activity },
  './useAgentAlerts': { useAgentAlerts: () => ({ alerts: [], dismiss() {}, notify() {} }) },
  './useConversation': { useConversation: thread => ({ view: { thread, messages: [], handoff: null }, turn: { active: false }, composer: { onSendText() {} } }) },
  './usePolling': { usePolling: load => {
    loaders.push(load)
    if (!requests.has(load)) requests.set(load, { data: values.get(load) || null, status: 'ready', error: null, refresh: load === api.threads ? () => new Promise(resolve => { finishList = () => { requests.get(load).data = values.get(load); resolve(values.get(load)) } }) : async () => values.get(load) || null })
    return requests.get(load)
  } },
}
const context = vm.createContext({ exports: {}, require: name => { assert.ok(modules[name], name); return modules[name] }, window: { addEventListener() {}, removeEventListener() {} }, Date })
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/hooks/useRelayRoom.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
const render = () => { cursor = 0; const room = context.exports.useRelayRoom(); effects.splice(0).forEach(run => run()); return room }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
render(); let room = render()
assert.equal(room.selectedId, old.id)
room.onCreateThread(); finishCreation(created); await flush()
room = render(); render()
assert.equal(room.selectedId, created.id)
assert.equal(room.conversation.view.thread.id, created.id, 'new conversation opens immediately while list refresh is pending')
assert.equal(room.threads.filter(thread => thread.id === created.id).length, 1)
values.set(api.threads, [created, old]); finishList(); await flush()
room = render(); room = render()
assert.equal(room.selectedId, created.id); assert.equal(room.threads.length, 2, 'list reconciliation neither switches back nor duplicates the new conversation')
activity.providers.opencode = false
loaders.length = 0; room = render()
assert.equal(loaders.includes(api.openCodeStatus), false)
assert.equal(loaders.includes(api.models), false)
assert.equal(loaders.includes(api.openCodeSessions), false)
activity.providers.codex = false
loaders.length = 0; room = render()
assert.equal(loaders.includes(api.codexStatus), false)
assert.equal(room.canCreateThread, false)
console.log('Passed: immediate new-chat selection with a delayed/stale provider list, stable selection after reconciliation, no duplicate sidebar entry, and disabled status/model/session polling. All data and requests were synthetic.')
