import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/mochi/MochiPet.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/features/mochi/mochi-pet.css', import.meta.url), 'utf8')
const icons = ['CircleAlert', 'CircleHelp', 'CircleSlash', 'LoaderCircle', 'Pause', 'Sparkles']
const states = ['disabled', 'idle', 'working', 'waiting_user', 'blocked']

const openCalls = [], pauseCalls = []
function harness(locale = 'en') {
  const modules = {
    react: {},
    'react/jsx-runtime': { jsx: (type, props) => typeof type === 'function' ? type(props) : { type, props }, jsxs: (type, props) => typeof type === 'function' ? type(props) : { type, props }, Fragment: 'fragment' },
    'lucide-react': Object.fromEntries(icons.map(name => [name, name])),
    '../../lib/i18n': { useLocale: () => locale, direction: () => locale === 'ar' ? 'rtl' : 'ltr' },
    '../../lib/cx': { cx: (...parts) => parts.filter(Boolean).join(' ') },
    './mochi-pet.css': {},
  }
  const context = vm.createContext({ exports: {}, require: name => { assert.ok(modules[name], `MochiPet must not depend on ${name}`); return modules[name] } })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  const base = { state: 'disabled', notice: null, onOpen: () => openCalls.push('open'), onPause: undefined, className: 'mount-here' }
  const all = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(all)]
  return {
    props: base,
    nodes() { return all(context.exports.MochiPet(base)) },
  }
}

const en = harness('en'), ar = harness('ar')

// Every state renders one pet with its own data-state, a translated visible
// state text, and a keyboard-accessible trigger that opens the panel.
const chipText = {
  disabled: ['Mochi is off', 'Mochi متوقف'],
  idle: ['Mochi idle', 'Mochi جاهز'],
  working: ['Mochi is working', 'Mochi يعمل'],
  waiting_user: ['Waiting for you', 'بانتظار قرارك'],
  blocked: ['Stuck, review the panel', 'متعثّر، راجع اللوحة'],
}
const invite = ['Open the Mochi suggestions panel', 'انقر لفتح لوحة اقتراحات Mochi']
for (const state of states) {
  en.props.state = state
  const nodes = en.nodes()
  const root = nodes.find(node => node.type === 'div' && typeof node.props.className === 'string' && node.props.className.includes('mochi'))
  assert.equal(root?.props['data-state'], state, `state ${state} must reach the DOM attribute`)
  const trigger = nodes.find(node => node.type === 'button' && node.props.className === 'mochi-trigger')
  assert.ok(trigger, `state ${state} needs an open trigger`)
  assert.equal(trigger.props.type, 'button')
  assert.ok(typeof trigger.props.onClick === 'function')
  assert.ok(invite.some(word => (trigger.props['aria-label'] || '').includes(word)), `aria invite in ${state}`)
  const chipNode = nodes.find(node => node.type === 'span' && node.props.className === 'mochi-chip-text')
  assert.ok(chipNode, `state ${state} shows visible translated text`)
  assert.ok(chipText[state].includes(chipNode.props.children), `state text mismatch for ${state}: ${chipNode.props.children}`)
  assert.ok(nodes.some(node => node.type === 'svg'), `mascot svg present in ${state}`)
}

// Opening the panel is the only side effect; no network, no AI, no polling.
en.props.state = 'waiting_user'
en.nodes().find(node => node.props?.className === 'mochi-trigger').props.onClick()
assert.deepEqual(openCalls, ['open'])

// The pause button exists only when the caller hands us onPause, and never fires implicitly.
assert.ok(!en.nodes().some(node => node.props?.className === 'mochi-pause'), 'no pause affordance without a callback')
const paused = harness('en')
paused.props.state = 'working'
paused.props.onPause = () => pauseCalls.push('pause')
const pauseButton = paused.nodes().find(node => node.props?.className === 'mochi-pause')
assert.equal(pauseButton.props.type, 'button')
pauseButton.props.onClick()
assert.deepEqual(pauseCalls, ['pause'])

// Optional notice renders as polite live text only when provided.
const quiet = harness('en')
quiet.props.state = 'idle'
assert.ok(!quiet.nodes().some(node => typeof node.props?.className === 'string' && node.props.className.includes('mochi-notice')), 'no notice line without content')
quiet.props.notice = 'Mochi suggests answering the form.'
const notice = quiet.nodes().find(node => typeof node.props?.className === 'string' && node.props.className.includes('mochi-notice'))
assert.equal(notice.props['aria-live'], 'polite')
assert.equal(notice.props.children, 'Mochi suggests answering the form.')

// Direction follows the locale, so the caller can anchor the pet on the physical left in RTL too.
ar.props.state = 'waiting_user'
assert.equal(ar.nodes().find(node => node.type === 'div' && typeof node.props.className === 'string' && node.props.className.includes('mochi')).props.dir, 'rtl')
en.props.state = 'idle'
assert.equal(en.nodes().find(node => node.type === 'div' && typeof node.props.className === 'string' && node.props.className.includes('mochi')).props.dir, 'ltr')

// Visual contract in CSS: every state is color-expressed, motion is limited to
// an explicit motion-safe block with transforms, and reduced motion silences it.
for (const state of states) assert.ok(css.includes(`.mochi[data-state='${state}']`), `theme mapping for ${state}`)
assert.ok(css.includes('prefers-reduced-motion: reduce') && css.includes('animation: none !important'), 'reduced motion silences motion')
const motionless = css.split('@media (prefers-reduced-motion: no-preference)')[0]
assert.ok(!/animation\s*:/.test(motionless), 'no animation outside the motion-safety block')
const animated = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*)\n\}/.exec(css)?.[1] ?? ''
assert.ok(/transform\s*:/.test(animated), 'expressive motion animates transforms')
assert.ok(!css.includes('blur('), 'no costly blur effects')

// The component stays visual-only: no api, no polling hook, no runtime surprises.
assert.ok(!source.includes('lib/api'), 'no API dependency')
assert.ok(!source.includes('usePolling'), 'no polling hook dependency')
assert.ok(!/fetch|WebSocket|setInterval/i.test(source), 'no network or timers in the visual component')

console.log('mochi pet visual contract ok')
