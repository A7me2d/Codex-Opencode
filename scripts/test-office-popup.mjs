import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/features/super-agent/office-popup.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { officePopupPlacement, officePopupEqual, officePopupDefaults } = context.exports

const EPS = 0.01
const container = (width, height) => ({ left: 0, top: 0, width, height })
const desk = (left, width, height = 298, top = 180) => ({ left, top, width, height })
const inside = (placement, box) => {
  assert.ok(Number.isFinite(placement.left) && Number.isFinite(placement.top) && Number.isFinite(placement.width) && Number.isFinite(placement.height), 'placement must be finite')
  assert.ok(placement.left >= -EPS, 'panel must not leave the workspace on the inline-start side')
  assert.ok(placement.left + placement.width <= box.width + EPS, 'panel must not leave the workspace on the inline-end side')
  assert.ok(placement.top >= -EPS && placement.top + placement.height <= box.height + EPS, 'panel must stay inside the workspace vertically')
}
const clearOfDesk = (placement, anchor) => {
  if (placement.mode !== 'side') return
  const before = placement.left + placement.width <= anchor.left - officePopupDefaults.gap + EPS
  const after = placement.left >= anchor.left + anchor.width + officePopupDefaults.gap - EPS
  assert.ok(before || after, `side panel must not cover the desk (${JSON.stringify(placement)} vs ${JSON.stringify(anchor)})`)
}

// A desk on the free half opens the panel toward the outer edge, never over the desk.
const box = container(1200, 700)
const rightDesk = desk(900, 280)
const rightPlacement = officePopupPlacement({ container: box, anchor: rightDesk })
assert.equal(rightPlacement.mode, 'side')
assert.equal(rightPlacement.side, 'left')
assert.ok(rightPlacement.width >= officePopupDefaults.minWidth)
inside(rightPlacement, box); clearOfDesk(rightPlacement, rightDesk)

const leftDesk = desk(60, 280)
const leftPlacement = officePopupPlacement({ container: box, anchor: leftDesk })
assert.equal(leftPlacement.mode, 'side')
assert.equal(leftPlacement.side, 'right', 'a desk on the left opens the panel to its right')
inside(leftPlacement, box); clearOfDesk(leftPlacement, leftDesk)

// Office controls are measured too: the panel tucks above/below them instead of blocking them.
const legend = { left: 16, top: 16, width: 190, height: 36 }
const toolbar = { left: 16, top: 644, width: 152, height: 40 }
const tucked = officePopupPlacement({ container: box, anchor: desk(420, 154, 164, 378), avoid: [legend, toolbar] })
assert.equal(tucked.side, 'left')
assert.equal(tucked.left, 10)
assert.ok(tucked.top >= legend.top + legend.height + officePopupDefaults.gap - EPS, 'the panel must clear the legend')
assert.ok(tucked.top + tucked.height <= toolbar.top - officePopupDefaults.gap + EPS, 'the panel must clear the zoom toolbar')
assert.ok(tucked.height >= officePopupDefaults.minHeight, 'tucking must keep a usable chat')
inside(tucked, box)

// Controls on the far side never shorten the panel.
const opposite = officePopupPlacement({ container: box, anchor: desk(60, 280), avoid: [legend, toolbar] })
assert.equal(opposite.side, 'right')
assert.equal(opposite.top, 10)
assert.equal(opposite.height, 680)
assert.equal(officePopupPlacement({ container: box, anchor: desk(420, 154, 164, 378), avoid: [{ left: 16, top: 16, width: 0, height: 0 }] }).top, 10, 'empty rects must be ignored')

// The same geometry must come out wherever the workspace sits on screen (no global coordinates).
const shifted = officePopupPlacement({ container: { left: 300, top: 40, width: 1200, height: 700 }, anchor: { ...desk(420, 154, 164, 378), left: 420 + 300, top: 378 + 40 }, avoid: [{ ...legend, left: 316, top: 56 }, { ...toolbar, left: 316, top: 684 }] })
assert.deepEqual(shifted, tucked, 'placements must be translation invariant')

// A cramped workspace keeps a usable chat rather than clipping it, even if a control is covered.
const cramped = officePopupPlacement({ container: container(320, 300), anchor: desk(20, 280), avoid: [legend, { left: 16, top: 244, width: 152, height: 40 }] })
assert.ok(cramped.height >= officePopupDefaults.minHeight - EPS)
inside(cramped, container(320, 300))

// Zoom in widens the measured desk; the panel flips or shrinks but never overlaps it.
// Covers the real UI extremes (40%–200%) plus intermediate steps.
for (const scale of [0.4, 0.55, 0.8, 1, 1.35, 1.75, 2]) {
  const anchor = desk(420, 280 * scale, 298 * scale, 460 - 149 * scale)
  const placement = officePopupPlacement({ container: box, anchor })
  inside(placement, box); clearOfDesk(placement, anchor)
}

// Scrolling moves the desk (even partially off-view) and the panel follows without covering it.
for (const offset of [-90, -20, 0, 120, 380, 900]) {
  const anchor = desk(offset, 280)
  const placement = officePopupPlacement({ container: box, anchor })
  inside(placement, box); clearOfDesk(placement, anchor)
}

// A narrower office viewport still keeps the panel inside the workspace and clear of the desk.
const scrolled = officePopupPlacement({ container: box, viewport: { left: 0, top: 0, width: 820, height: 700 }, anchor: desk(700, 280) })
inside(scrolled, box); clearOfDesk(scrolled, desk(700, 280))
assert.equal(scrolled.mode, 'side')

// Too narrow for both side by side: dock on the far side of the desk, fitted to the workspace.
const narrow = container(340, 640)
const narrowPlacement = officePopupPlacement({ container: narrow, anchor: desk(20, 280) })
assert.equal(narrowPlacement.mode, 'dock')
assert.ok(narrowPlacement.width <= narrow.width, 'the docked panel shrinks to the workspace')
inside(narrowPlacement, narrow)
const tiny = officePopupPlacement({ container: container(200, 520), anchor: desk(-40, 280) })
assert.equal(tiny.mode, 'dock')
assert.ok(tiny.width <= 200)
inside(tiny, container(200, 520))

// No measurable desk falls back to the requested edge (inline-end), never guessing a provider.
assert.equal(officePopupPlacement({ container: box, anchor: null, fallbackSide: 'left' }).side, 'left')
assert.equal(officePopupPlacement({ container: box, fallbackSide: 'left' }).mode, 'dock')
assert.equal(officePopupPlacement({ container: box, fallbackSide: 'right' }).side, 'right')

// Short workspaces drop the vertical margin so the composer and header stay reachable.
const short = officePopupPlacement({ container: container(1000, 220), anchor: desk(700, 280) })
assert.equal(short.top, 0)
assert.equal(short.height, 220)
assert.ok(officePopupPlacement({ container: box, anchor: desk(900, 280) }).height >= 260)

// Degenerate measurements stay valid instead of producing NaN geometry.
for (const degenerate of [container(0, 0), container(0, 400), container(400, 0)]) {
  const placement = officePopupPlacement({ container: degenerate, anchor: desk(0, 280) })
  assert.ok(Number.isFinite(placement.left) && placement.width >= 0 && placement.height >= 0)
}

// Idempotent measurements, and tolerance keeps scroll noise from re-rendering the panel.
const sample = officePopupPlacement({ container: box, anchor: desk(900, 280) })
assert.deepEqual(officePopupPlacement({ container: box, anchor: desk(900, 280) }), sample, 'the same measurements must give the same placement')
assert.ok(officePopupEqual(sample, { ...sample, left: sample.left + 0.2 }))
assert.ok(!officePopupEqual(sample, { ...sample, left: sample.left + 8 }))
assert.ok(!officePopupEqual(sample, { ...sample, mode: 'dock' }))
assert.ok(officePopupEqual(null, null) && !officePopupEqual(null, sample))

// Sweep widths, desk offsets, zoom scales and scroll positions: every placement is usable.
let side = 0, dock = 0
for (const width of [240, 360, 480, 640, 800, 1024, 1280, 1600, 1920]) {
  for (const boxHeight of [260, 480, 700, 1080]) {
    for (const ratio of [-0.2, 0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.1]) {
      for (const scale of [0.4, 0.5, 1, 1.8, 2]) {
        const anchor = desk(width * ratio, 280 * scale, 298 * scale, 90)
        const viewport = { left: 0, top: 0, width: Math.min(width, 900), height: boxHeight }
        const placement = officePopupPlacement({ container: container(width, boxHeight), viewport, anchor })
        inside(placement, container(width, boxHeight)); clearOfDesk(placement, anchor)
        assert.ok(placement.width >= Math.min(officePopupDefaults.minWidth, width - 20) - EPS, 'panel must stay wide enough to use, or shrink to the workspace')
        placement.mode === 'side' ? side++ : dock++
      }
    }
  }
}
assert.ok(side > 100 && dock > 0, 'the sweep must exercise both placements')

// Same sweep with the real control boxes: the panel stays inside, clear of the desk and usable.
for (const width of [360, 640, 900, 1280, 1600]) {
  for (const height of [320, 700, 1000]) {
    for (const ratio of [0.02, 0.3, 0.5, 0.8, 0.98]) {
      const anchor = desk(width * ratio, 280, 298, height / 3)
      const boxes = [{ left: 16, top: 16, width: 190, height: 36 }, { left: 16, top: height - 56, width: 152, height: 40 }]
      const placement = officePopupPlacement({ container: container(width, height), anchor, avoid: boxes })
      inside(placement, container(width, height)); clearOfDesk(placement, anchor)
      assert.ok(placement.height >= Math.min(officePopupDefaults.minHeight, height) - EPS || placement.top === 10, 'controls must not squeeze the chat shut')
    }
  }
}

console.log(`Passed: desk chat geometry stays beside the desk (side ${side}, dock ${dock} cases), keeps the desk visible, honours zoom/scroll/viewport, avoids office controls and fits narrow workspaces. No AI, no build, no application data touched.`)
