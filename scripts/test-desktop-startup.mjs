import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'electron/main.mjs'), 'utf8')
const start = source.indexOf('async function createWindow()')
const end = source.indexOf('function configureAutoUpdates()', start)
const loads = []
class Window {
  webContents = { send() {}, setWindowOpenHandler() {} }
  on() {} once() {} removeMenu() {} setMenuBarVisibility() {} show() {}
  async loadFile(file) { assert.ok(existsSync(file)); loads.push(['file', file]) }
  async loadURL(url) {
    assert.ok(url.length < 2 * 1024 * 1024, 'startup must not embed the animated logo in an oversized data URL')
    loads.push(['url', url])
  }
}
const context = vm.createContext({ BrowserWindow: Window, path, app: { getAppPath: () => root }, process: { platform: 'win32' }, serverUrl: undefined })
vm.runInContext(source.slice(start, end), context)
await context.createWindow()
assert.equal(loads[0][0], 'file')
assert.equal(loads[0][1], path.join(root, 'electron/loading.html'))
const html = readFileSync(loads[0][1], 'utf8')
assert.ok(html.length < 10000, 'HTML stays small regardless of logo size')
for (const match of html.matchAll(/src="([^"#]+)"/g)) {
  assert.ok(!match[1].startsWith('data:'), 'assets are referenced as separate local files')
  assert.ok(existsSync(path.resolve(path.dirname(loads[0][1]), match[1])), `Missing packaged asset: ${match[1]}`)
}
context.serverUrl = 'http://127.0.0.1:12345'
await context.createWindow()
assert.deepEqual(loads[1], ['url', context.serverUrl], 'reopening the window uses the running local server')

const bootStart = source.indexOf('app.whenReady().then('), bootEnd = source.indexOf("app.on('activate'", bootStart)
const calls = []
let startup
const failed = vm.createContext({
  Error,
  app: { whenReady: () => ({ then: fn => { startup = fn(); return startup } }) },
  createWindow: async () => { throw new Error('synthetic load failure') },
  readLicense: async () => calls.push('license'), startBackend: async () => calls.push('backend'),
  configureAutoUpdates: () => calls.push('updates'),
  showBackendFailure: async error => calls.push(error),
})
vm.runInContext(source.slice(bootStart, bootEnd), failed)
await startup
assert.deepEqual(calls, ['synthetic load failure'], 'window-load errors reach the existing shutdown/error handler before any license/backend work')
console.log('Passed: local-file splash, packaged image/script references, short startup URL, reopening and startup failure handling. No real windows, processes or license requests.')
