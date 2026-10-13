import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const slots = [], timers = new Map(), requests = [], opened = [], errors = []
let cursor = 0, nextId = 0
const hooks = {
  useRef(value) { return slots[cursor++] ??= { current: value } },
  useEffect(fn, deps) {
    const index = cursor++
    if (slots[index] && deps.every((value, i) => value === slots[index].deps[i])) return
    slots[index]?.cleanup?.()
    slots[index] = { deps, cleanup: fn() }
  },
}
const context = vm.createContext({ exports: {}, require(name) {
  if (name === 'react') return hooks
  if (name.includes('/api')) return { api: { projectPreviewFiles(root) {
    return new Promise((resolve, reject) => requests.push({ root, resolve, reject }))
  } } }
  return { openProjectFile: (...args) => opened.push(args) }
}, window: {
  setTimeout(fn, delay) { assert.equal(delay, 30000); timers.set(++nextId, fn); return nextId },
  clearTimeout(id) { timers.delete(id) },
} })
const source = readFileSync(new URL('../src/hooks/useAutomaticPreview.ts', import.meta.url), 'utf8')
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const render = (enabled, root = 'project') => { cursor = 0; context.exports.useAutomaticPreview(enabled, root, error => errors.push(error)) }
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
render(false); assert.equal(requests.length, 0)
render(true); requests.shift().resolve({ files: ['a.ts', 'b.ts'] }); await settle()
assert.equal(opened.length, 1)
assert.equal(opened[0][5].automatic, true)
assert.ok(opened[0][5].scrollFraction >= 0 && opened[0][5].scrollFraction < 1)
const tick = [...timers.values()][0]; timers.clear(); tick()
assert.equal(opened.length, 2)
assert.notEqual(opened[0][1], opened[1][1], 'avoid immediately repeating a file')
render(false); assert.equal(timers.size, 0)
render(true); render(true, 'other'); requests.shift().resolve({ files: ['old.ts'] }); await settle()
assert.equal(opened.length, 2, 'discard late response from old project')
requests.shift().resolve({ files: ['new.ts'] }); await settle()
assert.equal(opened.at(-1)[0], 'other')
render(false); render(true); requests.shift().resolve({ files: [] }); await settle()
assert.equal(errors.length, 1); assert.equal(timers.size, 0)
render(false); render(true); render(false); requests.shift().resolve({ files: ['late.ts'] }); await settle()
assert.equal(opened.length, 3, 'disabled mode never navigates after a late response')
console.log('Passed: default off, 30-second timing, no repeat, random scroll, project changes, disable cancellation and empty projects. No UI or network calls.')
