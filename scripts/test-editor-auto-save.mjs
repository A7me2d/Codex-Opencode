import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Drive the actual debounce hook with fake timers. No file writes or network.
const slots = [], timers = new Map(), saved = []
let cursor = 0, timerId = 0
const hooks = {
  useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
  useEffect(fn, deps) {
    const i = cursor++
    if (slots[i] && deps.every((value, index) => Object.is(value, slots[i].deps[index]))) return
    slots[i]?.cleanup?.()
    slots[i] = { deps, cleanup: fn() }
  },
}
const context = vm.createContext({ exports: {}, require: () => hooks, window: {
  setTimeout(fn, delay) { assert.equal(delay, 800); timers.set(++timerId, fn); return timerId },
  clearTimeout(id) { timers.delete(id) },
} })
const source = readFileSync(new URL('../src/hooks/useEditorAutoSave.ts', import.meta.url), 'utf8')
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
const render = (tabs, enabled = true, busy = '', root = 'project') => {
  cursor = 0
  context.exports.useEditorAutoSave(tabs, root, enabled, busy, async path => { saved.push(path) })
}
const tick = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()) }
const first = [{ path: 'first.ts', content: 'edit', saved: 'original' }]
render(first)
assert.equal(timers.size, 1)
render([{ ...first[0], content: 'newer edit' }])
assert.equal(timers.size, 1, 'typing restarts the debounce instead of accumulating saves')
tick(); assert.deepEqual(saved, ['first.ts'])
render(first, true, 'first.ts')
assert.equal(timers.size, 0, 'no save is scheduled during an in-flight save')
render(first, false)
tick(); assert.equal(saved.length, 1, 'disabling Auto Save cancels pending saves')
render(first); render([], true, '', 'other-project')
tick(); assert.equal(saved.length, 1, 'switching projects cancels the old draft timer')
render([{ ...first[0], content: 'original' }])
assert.equal(timers.size, 0, 'clean files never save')
render([{ ...first[0], content: 'edit during save', saved: 'edit' }])
tick(); assert.equal(saved.length, 2, 'edits newer than the saved snapshot are scheduled again')
console.log('Passed: typing debounce, no scheduling while saving, disabling, project changes, clean files and edits during save. No files were written.')
