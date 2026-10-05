import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the hook with deterministic timers and delayed network responses.
function harness(hidden = false) {
  const slots = []
  let cursor = 0
  let updates = 0
  const effects = []
  const timers = new Map()
  const delays = new Map()
  const listeners = new Map()
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
    useState(value) {
      const i = cursor++
      slots[i] ??= { value }
      return [slots[i].value, (next) => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (value !== slots[i].value) { slots[i].value = value; updates++ }
      }]
    },
    useCallback(fn) { cursor++; return fn },
    useEffect(fn, deps) {
      const i = cursor++
      if (slots[i] && deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) return
      const previous = slots[i]
      slots[i] = { deps }
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn() })
    },
  }
  // React keeps the refresh callback stable between renders.
  hooks.useCallback = (fn) => { const i = cursor++; return slots[i] ??= fn }
  const context = vm.createContext({
    exports: {}, require: () => hooks,
    document: { hidden, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) },
    window: { setTimeout: (fn, delay) => { const id = timers.size + 1; timers.set(id, fn); delays.set(id, delay); return id }, clearTimeout: (id) => { timers.delete(id); delays.delete(id) } },
  })
  const source = readFileSync(new URL('../src/hooks/usePolling.ts', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
  return {
    render(load, resetKey = 'a', interval = 1000) {
      cursor = 0
      const result = context.exports.usePolling(load, interval, { resetKey })
      effects.splice(0).forEach((run) => run())
      return result
    },
    tick: () => Array.from(timers).forEach(([id, fn]) => { timers.delete(id); fn() }),
    get updates() { return updates },
    get timers() { return timers.size },
    get delays() { return Array.from(delays.values()) },
  }
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const h = harness()
let calls = 0
let resolve
const slow = () => { calls++; return new Promise((done) => { resolve = done }) }
let view = h.render(slow)
assert.equal(h.timers, 0, 'next poll is scheduled only after the response completes')
h.tick(); h.tick(); void view.refresh()
assert.equal(calls, 1, 'slow polling and manual refresh share one request')
resolve({ messages: ['hello'] }); await flush()
view = h.render(slow)
const original = view.data
const before = h.updates
const next = view.refresh()
resolve({ messages: ['hello'] }); await next
assert.equal(h.updates, before, 'unchanged response does not update React state')
assert.equal(h.render(slow).data, original, 'unchanged data retains its reference')

const old = view.refresh()
const finishOld = resolve
h.render(async () => ({ messages: ['new session'] }), 'b')
await flush()
finishOld({ messages: ['stale session'] }); await old
view = h.render(async () => ({ messages: ['new session'] }), 'b')
assert.equal(view.data.messages[0], 'new session', 'late response cannot overwrite another session')
const background = harness(true)
let backgroundCalls = 0
background.render(async () => { backgroundCalls++; return [] })
assert.equal(backgroundCalls, 0)
assert.equal(background.timers, 0, 'hidden tab does not start polling')
const once = harness()
once.render(async () => [], 'settings', 0)
await flush()
assert.equal(once.timers, 0, 'load-once resources do not keep polling')
const adaptive = harness()
adaptive.render(async () => ({ active: false }), 'status', (data) => data?.active ? 800 : 5000)
await flush()
assert.deepEqual(adaptive.delays, [5000], 'idle status uses the slower cadence')
console.log('Passed: no overlapping requests, no unchanged renders, stale session responses discarded, hidden polling paused.')
