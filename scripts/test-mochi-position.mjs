import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/mochi/mochi-position.ts', import.meta.url), 'utf8')
const launcherSource = readFileSync(new URL('../src/features/mochi/MochiLauncher.tsx', import.meta.url), 'utf8')
const launcherCss = readFileSync(new URL('../src/features/mochi/mochi-launcher.css', import.meta.url), 'utf8')
const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const {
  clampMochiAnchor, defaultMochiAnchor, resolveMochiAnchor, movedMochiAnchor,
  readMochiAnchor, writeMochiAnchor, placeMochiDrawer, isValidMochiAnchor,
  mochiAnchorKey, mochiDragThreshold, mochiStep, mochiBigStep,
} = context.exports

const bounds = { left: 100, top: 80, width: 1000, height: 700 }
const pet = { width: 120, height: 48 }
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message)

// Clamping keeps the pet fully inside the work area, margins included.
same(clampMochiAnchor({ x: 500, y: 400 }, bounds, pet), { x: 500, y: 400 })
same(clampMochiAnchor({ x: 0, y: 0 }, bounds, pet), { x: 112, y: 92 })
same(clampMochiAnchor({ x: 9999, y: -50 }, bounds, pet), { x: 968, y: 92 })
const tinyBounds = { left: 0, top: 0, width: 100, height: 60 }
same(clampMochiAnchor({ x: 500, y: 500 }, tinyBounds, pet), { x: 12, y: 12 }, 'a cramped area still yields a reachable spot')

// The default spot mirrors the original bottom-right launcher position.
same(defaultMochiAnchor(bounds, pet), { x: 964, y: 716 })

// resolve: corrupt or missing anchors fall back to the default; saved anchors clamp.
assert.equal(isValidMochiAnchor(null), false)
assert.equal(isValidMochiAnchor({ x: NaN, y: 10 }), false)
same(resolveMochiAnchor(null, bounds, pet), { x: 964, y: 716 })
same(resolveMochiAnchor({ x: 5000, y: 400 }, bounds, pet), { x: 968, y: 400 })
same(resolveMochiAnchor({ x: 5000, y: 400 }, { ...bounds, width: 0 }, pet), { x: 1068, y: 400 }, 'degenerate bounds use a safe fallback instead of pinning at zero')

// Keyboard nudges: 8px steps, 32px with Shift, clamped at the edges.
same(movedMochiAnchor({ x: 500, y: 400 }, -1, 0, bounds, pet), { x: 492, y: 400 })
same(movedMochiAnchor({ x: 500, y: 400 }, 1, 1, bounds, pet, true), { x: 532, y: 432 })
same(movedMochiAnchor({ x: 112, y: 92 }, -1, -1, bounds, pet), { x: 112, y: 92 })
assert.equal(mochiBigStep > mochiStep, true)

// Storage: independent key, honest round-trip, tolerant of junk and of a dead store.
const memory = new Map()
const store = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) }
assert.equal(readMochiAnchor(store), null)
assert.equal(readMochiAnchor(null), null)
writeMochiAnchor(null, { x: 1, y: 2 })
const breaking = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
assert.equal(readMochiAnchor(breaking), null)
writeMochiAnchor(breaking, { x: 1, y: 2 }) // must not throw
writeMochiAnchor(store, { x: 480.6, y: 312.2 })
assert.equal(memory.get(mochiAnchorKey), '{"x":481,"y":312}', 'one small record, rounded, saved at drag end only')
same(readMochiAnchor(store), { x: 481, y: 312 })
for (const junk of ['{', '42', '"text"', '{"x":"5","y":6}', '{"x":null,"y":3}', '[1,2]']) {
  memory.set(mochiAnchorKey, junk)
  assert.equal(readMochiAnchor(store), null, `junk stays inert: ${junk}`)
}

// Drawer placement: roomier side wins, geometry stays inside the area, above by default, below when the top is tight.
const drawer = { width: 380, height: 420 }
const centered = placeMochiDrawer({ x: 500, y: 600 }, pet, drawer, bounds)
assert.equal(centered.side, 'right')
same(centered, { left: 130, top: -430, side: 'right', below: false })
// Not enough room above (pet mid-area, tall drawer): the drawer opens below instead.
const midPet = placeMochiDrawer({ x: 500, y: 400 }, pet, drawer, bounds)
assert.equal(midPet.below, true)
assert.ok(midPet.top >= pet.height)
// Pet near the physical right edge: the drawer flips to the left side and stays clamped inside.
const rightPet = placeMochiDrawer({ x: 964, y: 400 }, pet, drawer, bounds)
assert.equal(rightPet.side, 'left')
assert.ok(100 + 12 <= 964 + rightPet.left && 964 + rightPet.left + 380 <= 100 + 1000 - 12, `drawer left edge ${964 + rightPet.left} stays inside`)
// Pet near the physical left edge (mirrored in RTL): drawer opens right.
const leftPet = placeMochiDrawer({ x: 112, y: 400 }, pet, drawer, bounds)
assert.equal(leftPet.side, 'right')
assert.ok(112 + leftPet.left >= 112, `drawer clears the left edge`)
// A pet parked near the top flips the drawer below.
const topPet = placeMochiDrawer({ x: 500, y: 92 }, pet, drawer, bounds)
assert.equal(topPet.below, true)
assert.ok(92 + topPet.top >= 92 + pet.height, `below opens past the pet`)
// Tall drawer on a short area: falls back below and never floats above the top edge.
const tallDrawer = { width: 380, height: 640 }
const squeezed = placeMochiDrawer({ x: 500, y: 690 }, pet, tallDrawer, bounds)
assert.equal(squeezed.below, true)
assert.ok(squeezed.top > 0, 'below keeps at least the pet height of offset')

// Launcher wiring: pointer capture, threshold, save-at-end, keyboard handle, and no per-move writes.
assert.ok(launcherSource.includes('.setPointerCapture('), 'pointer capture is used')
assert.ok(launcherSource.includes('mochiDragThreshold'), 'drag threshold gates click vs drag')
assert.ok(launcherSource.includes('writeMochiAnchor(safeStorage(), next)') && !/onPointerMove[\s\S]*writeMochiAnchor/.test(launcherSource), 'storage writes never happen inside pointer move')
assert.ok(launcherSource.includes('scheduleSave('), 'keyboard moves debounce their save')
assert.ok(launcherSource.includes('aria-keyshortcuts'), 'grip is keyboard reachable')
assert.ok(launcherSource.includes('data-office-avoid'), 'office avoidance preserved')
assert.ok(launcherSource.includes("closest('.mochi-pause')"), 'pause button keeps its own click')
assert.ok(launcherSource.includes('onClickCapture'), 'dragged gestures never open the panel as a click')
assert.ok(launcherSource.includes('getBoundingClientRect'), 'work area measured live for clamping')
assert.ok(launcherCss.includes('touch-action: none'), 'drag never turns into a page scroll on touch')
assert.ok(launcherCss.includes('prefers-reduced-motion: reduce'), 'reduced motion silences launcher transitions')

console.log('mochi position contract ok')
