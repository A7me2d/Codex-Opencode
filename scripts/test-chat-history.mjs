import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Run the actual hook with deterministic layout, observers and animation frames.
const slots = [], effects = [], frames = new Map(), observers = []
let cursor = 0, nextFrame = 0, height = 1000, top = 0
const element = {
  style: {}, children: [{}], clientHeight: 200,
  get scrollHeight() { return height },
  get scrollTop() { return top },
  set scrollTop(value) { top = Math.max(0, Math.min(value, height - this.clientHeight)) },
  scrollTo({ top: value }) { this.scrollTop = value },
}
const hooks = {
  useRef(value) { const i = cursor++; return slots[i] ??= { current: i === 0 ? element : value } },
  useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = next }] },
  useMemo(fn) { cursor++; return fn() },
  useCallback(fn) { cursor++; return fn },
  useLayoutEffect(fn, deps) {
    const i = cursor++
    if (slots[i] && deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) return
    const old = slots[i]
    slots[i] = { deps }
    effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() })
  },
}
class Observer {
  constructor(callback) { this.callback = callback; observers.push(this) }
  observe() { this.active = true }
  disconnect() { this.active = false }
}
const context = vm.createContext({
  exports: {}, require: name => name === 'react' ? hooks : { config: { stickyScrollThresholdPx: 80 } },
  ResizeObserver: Observer, MutationObserver: Observer,
  requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame },
  cancelAnimationFrame: id => frames.delete(id), window: { matchMedia: () => ({ matches: false }) },
})
const source = readFileSync(new URL('../src/hooks/useChatHistory.ts', import.meta.url), 'utf8')
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
let messages = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }))
const render = (key = 'a') => {
  cursor = 0
  const view = context.exports.useChatHistory(messages, key)
  effects.splice(0).forEach(fn => fn())
  return view
}
const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()) }
const growth = () => { observers.filter(o => o.active).forEach(o => o.callback()); flush() }
let view = render(); view = render()
assert.equal(view.visibleMessages.length, 5)
assert.equal(top, 800)
assert.equal(view.atLatest, true)
height = 1200; growth()
assert.equal(top, 1000, 'streamed text follows without needing a new message')
view.handleScroll(); view = render()
assert.equal(view.following, true, 'programmatic follow does not detach')
view.handleWheel({ deltaY: -30 }); top = 600; view.handleScroll(); view = render()
height = 1400; growth()
assert.equal(top, 600, 'streaming preserves position while reading older content')
view = render()
assert.equal(view.atLatest, false, 'latest button is needed while reading above the bottom')
top = 40; view.handleScroll(); height = 1800; view = render()
assert.equal(top, 440, 'prepending history preserves the reading position')
view.scrollToLatest(); view = render(); flush(); view = render()
assert.equal(view.visibleMessages.length, 5)
assert.equal(top, 1600)
height = 2000; growth()
assert.equal(top, 1800, 'a new send/jump resumes streaming follow')
view = render()
assert.equal(view.atLatest, true)
view.handleWheel({ deltaY: -1 }); view = render()
assert.equal(view.following, false)
assert.equal(view.atLatest, true, 'pausing follow alone must not show the latest button at the bottom')
height = 1600; element.scrollTop = top; growth(); view = render()
assert.equal(view.atLatest, true, 'shrinking content at completion keeps the button hidden without a scroll event')
element.clientHeight = 2000; growth(); view = render()
assert.equal(view.atLatest, true, 'a transcript that fits the viewport has no latest button')
view = render('b'); view = render('b')
assert.equal(view.following, true)
assert.equal(observers.filter(o => o.active).length, 2, 'switching sessions cleans up old observers')
console.log('Passed: streaming follow, manual reading, history anchoring, resumed follow and observer cleanup.')
