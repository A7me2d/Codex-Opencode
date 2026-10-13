import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// Exercise the real IPC handlers with a synthetic PTY; never run shell commands.
const handlers = new Map(), launches = [], terminals = new Map(), sent = []
const source = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8')
const start = source.indexOf("ipcMain.handle('terminal:start'")
const end = source.indexOf("ipcMain.handle('terminal:clipboard-read'", start)
assert.ok(start >= 0 && end > start)
const context = vm.createContext({
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn) },
  terminals, path, process: { env: {} },
  fs: { existsSync: directory => directory !== path.resolve('missing'), statSync: () => ({ isDirectory: () => true }) },
  app: { getPath: () => path.resolve('documents') },
  spawnPty(exe, args, options) {
    const terminal = { killed: false, writes: [], kill() { this.killed = true }, write(data) { this.writes.push(data) }, resize() {}, onData(fn) { this.data = fn }, onExit(fn) { this.exit = fn } }
    launches.push({ exe, args: Array.from(args), options, terminal })
    return terminal
  },
})
vm.runInContext(source.slice(start, end), context)
const event = { sender: { id: 1, send: (...args) => sent.push(args) } }
const shell = handlers.get('terminal:start')(event, { directory: 'project', sessionId: '' })
assert.equal(shell.command, '')
assert.equal(shell.cwd, path.resolve('project'))
assert.deepEqual(launches[0].args, ['-NoLogo', '-NoProfile', '-NoExit'], 'normal terminal does not automatically execute OpenCode or any script')
assert.equal(launches[0].options.cwd, path.resolve('project'))
handlers.get('terminal:write')(event, 'npm install\r')
assert.deepEqual(launches[0].terminal.writes, ['npm install\r'], 'typed commands reach the interactive shell unchanged')
assert.throws(() => handlers.get('terminal:start')(event, { sessionId: 'ses_bad; command' }))
assert.equal(launches[0].terminal.killed, false, 'invalid session input does not interrupt the current shell')
assert.throws(() => handlers.get('terminal:start')(event, { directory: 'missing' }))
assert.equal(launches[0].terminal.killed, false, 'invalid folder does not interrupt the current shell')
const session = handlers.get('terminal:start')(event, { directory: 'project', sessionId: 'ses_123abc' })
assert.equal(session.command, 'opencode --session ses_123abc')
assert.equal(launches[0].terminal.killed, true)
assert.deepEqual(launches[1].args.slice(-2), ['-Command', 'opencode --session ses_123abc'])
launches[0].terminal.exit({ exitCode: 0 })
assert.equal(terminals.get(1), launches[1].terminal, 'old exit cannot clear a replacement terminal')
handlers.get('terminal:stop')(event)
assert.equal(launches[1].terminal.killed, true)
assert.equal(terminals.size, 0)
console.log('Passed: interactive shell by default, typed command input, optional validated OpenCode session, folder validation and terminal replacement. No real processes or commands ran.')
