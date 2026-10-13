import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/hooks/useWelcomeSequence.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function harness() {
  const slots = [], timers = new Map()
  let cursor = 0, nextId = 0, now = 0, dirty = false, checking = true, phase
  const hooks = {
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: initial }
      return [slots[index].value, value => { slots[index].value = value; dirty = true }]
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (slots[index] && deps.every((value, i) => value === slots[index].deps[i])) return
      slots[index]?.cleanup?.()
      slots[index] = { deps, cleanup: fn() }
    },
  }
  const context = vm.createContext({ exports: {}, require: () => hooks, window: {
    setTimeout(fn, delay) { timers.set(++nextId, { fn, at: now + delay }); return nextId },
    clearTimeout(id) { timers.delete(id) },
  } })
  vm.runInContext(compiled, context)
  function render() { cursor = 0; dirty = false; phase = context.exports.useWelcomeSequence(checking) }
  render()
  return {
    get phase() { return phase },
    checkComplete() { checking = false; render() },
    advance(ms) {
      const target = now + ms
      while (true) {
        const pending = [...timers].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!pending) break
        now = pending[1].at; timers.delete(pending[0]); pending[1].fn()
        if (dirty) render()
      }
      now = target
    },
    unmount() { slots.forEach(slot => slot.cleanup?.()); assert.equal(timers.size, 0) },
  }
}
const fast = harness()
fast.advance(100); fast.checkComplete()
fast.advance(900); assert.equal(fast.phase, 'waiting', 'retain the original one-second minimum')
fast.advance(9399); assert.equal(fast.phase, 'waiting')
fast.advance(1); assert.equal(fast.phase, 'leaving')
fast.advance(599); assert.equal(fast.phase, 'leaving')
fast.advance(1); assert.equal(fast.phase, 'done', 'finish exactly ten seconds after baseline')
fast.unmount()
const slow = harness()
slow.advance(15000); assert.equal(slow.phase, 'waiting', 'never finish while license checks remain pending')
slow.checkComplete(); slow.advance(9999); assert.equal(slow.phase, 'leaving')
slow.advance(1); assert.equal(slow.phase, 'done', 'slow checks get the full additional ten seconds')
slow.unmount()
const cancelled = harness()
cancelled.advance(1000); cancelled.checkComplete(); cancelled.unmount()
console.log('Passed: original minimum, ten extra seconds after fast/slow checks, 600ms exit and timer cleanup. No real waits, UI or license requests.')
