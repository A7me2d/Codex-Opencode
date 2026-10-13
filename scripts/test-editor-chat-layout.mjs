import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

let stored = null
const context = vm.createContext({ exports: {}, require: () => ({ preferenceKeys: { editorChatLayout: 'layout' } }), window: {
  innerWidth: 1440, innerHeight: 900, localStorage: { getItem: () => stored },
} })
const source = readFileSync(new URL('../src/lib/editor-chat-layout.ts', import.meta.url), 'utf8')
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const { constrainChatBox, readEditorChatLayout } = context.exports
const saved = readEditorChatLayout()
assert.equal(saved.pinned, false)
assert.equal(saved.box.width, 420)
const extreme = constrainChatBox({ x: -999, y: 9999, width: 9000, height: 8000 }, { width: 1440, height: 900 })
assert.equal(extreme.x, 12); assert.equal(extreme.y, 60)
assert.equal(extreme.width, 1416); assert.equal(extreme.height, 828)
const mobile = constrainChatBox(saved.box, { width: 320, height: 480 })
assert.ok(mobile.x + mobile.width <= 320 - 12)
assert.ok(mobile.y + mobile.height <= 480 - 12)
assert.ok(mobile.y >= 60, 'keep title bar reachable')
stored = JSON.stringify({ pinned: true, box: { x: 3000, y: 1000, width: 420, height: 620 } })
const restored = readEditorChatLayout()
assert.equal(restored.pinned, true)
assert.ok(restored.box.x + restored.box.width <= 1428, 'restore within current monitor bounds')
stored = JSON.stringify({ pinned: 'true', box: { x: null, y: '0', width: -1, height: {} } })
assert.equal(readEditorChatLayout().pinned, false)
assert.equal(readEditorChatLayout().box.width, 420)
stored = 'invalid json'
assert.equal(readEditorChatLayout().box.width, 420)
console.log('Passed: move/resize bounds, narrow screens, restored monitor positions and invalid preferences. No UI or storage writes.')
