import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/super-agent/ClineSlot.tsx', import.meta.url), 'utf8')
function harness({ enabled = true, permissions = [], active = false } = {}) {
  const hooks = [], effects = [], calls = [], loads = []
  let cursor = 0, tree
  const data = { id: 'session-id', active, loading: false, preparing: false, permissions, messages: [{ id: 'reply', role: 'assistant', text: 'Scoped response' }], tools: [], error: null,
    configOptions: [{ id: 'model', type: 'select', currentValue: 'free-model', options: [{ value: 'free-model', name: 'Free model' }] }, { id: 'mode', type: 'select', currentValue: 'act', options: [{ value: 'act', name: 'Act' }, { value: 'plan', name: 'Plan' }] }] }
  const react = {
    useState(initial) { const i = cursor++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, next => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next }] },
    useEffect(fn, deps) { const i = cursor++; if (hooks[i] && deps.every((dep, j) => Object.is(dep, hooks[i].deps[j]))) return; hooks[i] = { deps }; effects.push(fn) },
  }
  const api = {
    superClineState: (...args) => { loads.push(['state', ...args]); return data },
    superClineStatus: (...args) => { loads.push(['status', ...args]); return { active: data.active, waitingPermission: Boolean(data.permissions.length), error: null } },
    ...Object.fromEntries(['sendSuperMessage', 'stopSuperCline', 'configSuperCline', 'connectSuperCline', 'permissionSuperCline'].map(name => [name, async (...args) => { calls.push({ name, args }) }])),
  }
  const SettingsSelect = () => {}, SuperMessage = () => {}
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'lucide-react': Object.fromEntries(['RefreshCw', 'Send', 'Square'].map(name => [name, name])),
    '../../lib/api': { api }, '../../lib/i18n': { useLocale: () => 'en' },
    '../../hooks/usePolling': { usePolling: load => ({ data: load?.() ?? null, error: null, status: load ? 'ready' : 'idle', refresh: async () => load?.() }) },
    '../../hooks/useChatHistory': { useChatHistory: messages => ({ visibleMessages: messages, hiddenCount: 0, atLatest: true, ref: {}, scrollToLatest() {}, handleScroll() {}, handleWheel() {} }) },
    '../../components/ui/EarlierMessages': { EarlierMessages: () => {} },
    './SuperMessage': { SuperMessage }, '../../components/ui/SettingsSelect': { SettingsSelect },
  }
  const context = vm.createContext({ exports: {}, require: name => { assert.ok(modules[name], `Unexpected UI dependency ${name}`); return modules[name] } })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  const props = { team: { id: 'team-id', archived: false }, slot: { id: 'worker-1', label: 'Design', thread: { id: 'session-id', provider: 'cline' } }, enabled, compact: true, incoming: null, onTransfer() {} }
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]
  return { calls, loads, data, props, api, render() { cursor = 0; tree = context.exports.ClineSlot(props); effects.splice(0).forEach(fn => fn()); return tree },
    node: predicate => nodes(tree).find(predicate), select: label => nodes(tree).find(node => node.type === SettingsSelect && node.props.label === label),
  }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const paused = harness({ enabled: false }); paused.render()
assert.equal(paused.loads.length, 0, 'disabled providers must not poll')
const chat = harness(); chat.render()
chat.node(node => node.type === 'textarea').props.onChange({ target: { value: 'Task for this desk' } }); chat.render()
chat.node(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush(); chat.render()
assert.equal(chat.calls[0].name, 'sendSuperMessage')
assert.deepEqual(Array.from(chat.calls[0].args).slice(0, 4), ['team-id', 'worker-1', 'session-id', 'Task for this desk'])
assert.equal(chat.node(node => node.type === 'textarea').props.value, '')
assert.equal(chat.select('Cline model').props.options[0].value, 'free-model')
chat.select('Mode').props.onChange('plan'); await flush(); chat.render()
assert.equal(chat.calls.at(-1).name, 'configSuperCline')
assert.deepEqual(Array.from(chat.calls.at(-1).args), ['team-id', 'worker-1', 'mode', 'plan'])
const waiting = harness({ active: true, permissions: [{ id: 'permission-id', title: 'Edit file?', options: [{ id: 'deny', name: 'Deny', kind: 'reject_once' }] }] }); waiting.render()
waiting.node(node => node.type === 'textarea').props.onChange({ target: { value: 'Do not send while waiting' } }); waiting.render()
waiting.node(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush()
assert.equal(waiting.calls.length, 0, 'pending permissions must not auto-approve or start another message')
assert.equal(waiting.select('Cline model').props.disabled, true)
waiting.node(node => node.type === 'button' && node.props.children === 'Deny').props.onClick(); await flush()
assert.equal(waiting.calls[0].name, 'permissionSuperCline')
assert.deepEqual(Array.from(waiting.calls[0].args), ['team-id', 'worker-1', 'permission-id', 'deny'])
waiting.node(node => node.type === 'button' && node.props['aria-label'] === 'Stop this conversation').props.onClick(); await flush()
assert.equal(waiting.calls.at(-1).name, 'stopSuperCline')
const failed = harness(); failed.api.sendSuperMessage = async () => { throw new Error('license blocked') }; failed.render()
failed.node(node => node.type === 'textarea').props.onChange({ target: { value: 'Keep my draft' } }); failed.render()
failed.node(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush(); failed.render()
assert.equal(failed.node(node => node.type === 'textarea').props.value, 'Keep my draft', 'failed delivery keeps the draft')
console.log('Passed: real Cline desk component routes exact sends/config/stop/permission, blocks disabled polling and overlapping sends, requires explicit permission choices, and preserves failed drafts. No DOM, browser or AI calls.')
