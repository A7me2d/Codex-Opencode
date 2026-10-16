import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Run the real controller with isolated React state and a fake polling/API layer.
function harness(id, initialDraft, initialSettings) {
  const slots = [], effects = [], calls = []
  let cursor = 0
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i] },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, index) => !Object.is(dep, slots[i].deps[index]))) slots[i] = { value: fn(), deps }; return slots[i].value },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) { const i = cursor++; if (slots[i] && deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) return; slots[i] = { deps }; effects.push(fn) },
  }
  const api = Object.fromEntries(['codexModels', 'codexSettings', 'turnState', 'messages', 'handoff', 'sendMessage', 'stopTurn', 'selectProjectFile', 'setThreadModel', 'setCodexPermissions'].map(name => [name, (...args) => {
    calls.push({ name, args })
    if (name === 'turnState') return { active: false }
    if (name === 'codexSettings') return { model: 'fake-model', effort: 'medium', sandbox: 'read-only' }
    return []
  }]))
  const modules = {
    react, '../lib/api': { api }, '../lib/i18n': { tr: value => value },
    '../lib/chat': { readCodexChat: () => [] }, '../lib/forms': { readForms: () => [] }, '../lib/diff': { readCodexFileChanges: () => [] },
    '../app/config': { config: { poll: {} } },
    './useProviderActivity': { useProviderActivity: () => ({ providers: { codex: true, opencode: true } }) },
    './usePolling': { usePolling: load => ({ data: load ? load() : null, status: 'ready', error: null, refresh: async () => load?.() }) },
  }
  const context = vm.createContext({ exports: {}, require: name => { assert.ok(modules[name], name); return modules[name] }, window: { dispatchEvent() {} }, CustomEvent: class {} })
  vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/hooks/useConversation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
  const sent = [], drafts = [], settings = []
  const options = {
    enabled: true, codexOnly: true, initialDraft: { text: initialDraft, attachments: [] },
    initialSettings, saveSettings: value => settings.push(value),
    models: [{ model: 'fake-model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }],
    send: async (...args) => { sent.push(args) }, saveDraft: (text, attachments) => drafts.push({ text, attachments }),
  }
  return { calls, sent, drafts, settings, options, render() { cursor = 0; const controller = context.exports.useConversation({ id, directory: `D:/${id}` }, options); effects.splice(0).forEach(run => run()); return controller } }
}
const manager = harness('manager-thread', 'Manager draft'), worker = harness('worker-thread', 'Worker draft')
let lead = manager.render(), task = worker.render()
assert.equal(lead.composer.draft, 'Manager draft')
assert.equal(task.composer.draft, 'Worker draft')
lead.composer.onDraftChange('Changed manager draft')
lead = manager.render(); task = worker.render()
assert.equal(task.composer.draft, 'Worker draft')
assert.equal(manager.drafts.at(-1).text, 'Changed manager draft')
lead.codexSelection.onEffortChange('high'); lead = manager.render()
assert.equal(lead.codexSelection.current.effort, 'high')
assert.equal(worker.render().codexSelection.current.effort, 'medium')
assert.equal(harness('manager-thread', 'Restored draft', manager.settings.at(-1)).render().codexSelection.current.effort, 'high')
lead.composer.onSend()
for (let i = 0; i < 20; i++) await Promise.resolve()
lead = manager.render()
assert.equal(manager.sent.length, 1)
assert.equal(manager.sent[0][0], 'manager-thread')
assert.equal(manager.sent[0][1], 'Changed manager draft')
assert.equal(worker.sent.length, 0)
assert.equal(lead.composer.draft, '')
assert.ok(!manager.calls.some(call => ['handoff', 'codexModels', 'sendMessage'].includes(call.name)))
task.composer.onQueue(); worker.render()
assert.equal(worker.sent.length, 0, 'Super Agent never auto-sends a parked draft')
worker.options.enabled = false; worker.calls.length = 0
task = worker.render(); task.composer.onSendText('Hidden workspace attempt')
for (let i = 0; i < 10; i++) await Promise.resolve()
assert.equal(worker.calls.length, 0)
assert.equal(worker.sent.length, 0)
console.log('Passed: isolated manager/worker drafts, correct explicit destination, shared model catalog, no OpenCode handoff or automatic sends, and hidden workspace polling/sends paused. All requests were synthetic.')
