import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExtensionWorkbench, workbenchFolder, workbenchPath, trustedExtensionRequest } from '../server/extension-workbench.mjs'

assert.equal(workbenchFolder('D:\\Nx Projects\\demo', 'win32'), '/D:/Nx Projects/demo')
assert.equal(workbenchFolder('/home/project', 'linux'), '/home/project')
assert.equal(trustedExtensionRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } }), true)
assert.equal(trustedExtensionRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:9999' } }), false)
assert.equal(trustedExtensionRequest({ headers: { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' } }), false)
const root = await mkdtemp(path.join(tmpdir(), 'openzero-extension-test-'))
const children = []
const launches = []
const launch = (exe, args, options) => {
  launches.push({ exe, args, options })
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  // No OS pid, so cleanup cannot accidentally kill another real process.
  child.pid = undefined
  child.kill = () => { child.emit('exit', 1); return true }
  children.push(child)
  if (args[0] === 'serve-web') queueMicrotask(() => {
    child.stdout.write('Web UI available at http://127.0.0.1:')
    child.stdout.write('43001/api/extensions/workbench/\n')
  })
  return child
}
try {
  const host = new ExtensionWorkbench(root, { launch, resolveCLI: () => 'synthetic-code-cli' })
  assert.equal(host.status(root).running, false)
  assert.equal(launches.length, 0)
  await assert.rejects(host.start(root, false), /Accept/)
  assert.equal(launches.length, 0)
  const statuses = await Promise.all([host.start(root, true), host.start(root, true)])
  assert.equal(launches.length, 1)
  assert.equal(statuses[0].running, true)
  assert.equal(launches[0].options.shell, false)
  assert.equal(launches[0].options.windowsHide, true)
  assert.equal(launches[0].args[launches[0].args.indexOf('--host') + 1], '127.0.0.1')
  assert.equal(launches[0].args.includes('--without-connection-token'), false)
  const token = await readFile(path.join(host.storage, 'connection-token'), 'utf8')
  assert.equal(token.length, 64)
  assert.equal(statuses[0].path.includes(token), false)
  assert.equal(statuses[0].directory, root)
  const target = host.target(`${workbenchPath}?folder=/project`)
  assert.equal(target.hostname, '127.0.0.1')
  assert.equal(target.port, '43001')
  assert.equal(target.searchParams.get('tkn'), token)
  assert.throws(() => host.target('/api/license/status'), /Invalid/)
  const otherHost = host.target(`http://someone.example${workbenchPath}`)
  assert.equal(otherHost.hostname, '127.0.0.1')
  await assert.rejects(host.installNx(), /still downloading/)

  // Synthetic vendor layout only. Never downloads or executes a real extension.
  const runtime = path.join(host.storage, 'cli', 'serve-web', 'commit')
  await mkdir(path.join(runtime, 'out'), { recursive: true })
  await writeFile(path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'), '')
  await writeFile(path.join(runtime, 'out', 'server-main.js'), '')
  assert.equal(host.status(root).runtimeReady, true)
  const install = host.installNx()
  const concurrentInstall = host.installNx()
  assert.equal(launches.length, 2)
  assert.equal(launches[1].args[launches[1].args.indexOf('--install-extension') + 1], 'nrwl.angular-console')
  assert.equal(launches[1].options.shell, false)
  const extension = path.join(host.storage, 'data', 'extensions', 'nrwl.angular-console-1.0.0')
  await mkdir(extension, { recursive: true })
  await writeFile(path.join(extension, 'package.json'), JSON.stringify({ publisher: 'nrwl', name: 'angular-console', version: '1.0.0' }))
  children[1].emit('exit', 0)
  const results = await Promise.all([install, concurrentInstall])
  assert.equal(results.every(result => result.installed === true), true)
  assert.equal(host.status(root).nxInstalled, true)

  // HTTP proxy preserves frame policy and rewrites internal auth redirects.
  let proxiedTarget
  const incoming = new PassThrough()
  incoming.url = `${workbenchPath}?folder=/project`; incoming.method = 'GET'; incoming.headers = { host: '127.0.0.1:4280' }
  const outgoing = new PassThrough()
  let responseHeaders
  outgoing.writeHead = (code, headers) => { assert.equal(code, 302); responseHeaders = headers }
  const received = []
  outgoing.on('data', chunk => received.push(chunk))
  host.request = (url, options, callback) => {
    proxiedTarget = url
    assert.equal(options.headers.host, '127.0.0.1:4280')
    const sink = new PassThrough()
    queueMicrotask(() => {
      const response = new PassThrough()
      response.statusCode = 302
      response.headers = { 'content-security-policy': "frame-ancestors 'self'", location: `http://127.0.0.1:43001${workbenchPath}?tkn=${token}` }
      callback(response); response.end('synthetic response')
    })
    return sink
  }
  host.proxy(incoming, outgoing)
  incoming.end()
  await new Promise(resolve => outgoing.on('finish', resolve))
  assert.equal(proxiedTarget.searchParams.get('tkn'), token)
  assert.equal(responseHeaders['content-security-policy'], "frame-ancestors 'self'")
  assert.equal(responseHeaders.location.includes('tkn='), false)
  assert.equal(Buffer.concat(received).toString(), 'synthetic response')

  // WebSocket upgrade forwards both buffered heads and bidirectional streams.
  let upgradeRequest
  host.request = () => {
    upgradeRequest = new EventEmitter()
    upgradeRequest.end = () => {}
    upgradeRequest.destroy = () => {}
    return upgradeRequest
  }
  class Socket extends EventEmitter {
    constructor() { super(); this.chunks = []; this.destroyed = false }
    write(chunk) { this.chunks.push(String(chunk)); return true }
    pipe(other) { this.destination = other; return other }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close') } }
  }
  const client = new Socket(), remote = new Socket()
  host.upgrade(incoming, client, Buffer.from('client-head'))
  upgradeRequest.emit('upgrade', { rawHeaders: ['Upgrade', 'websocket', 'Connection', 'Upgrade'] }, remote, Buffer.from('remote-head'))
  assert.match(client.chunks[0], /101 Switching Protocols/)
  assert.equal(client.chunks[1], 'remote-head')
  assert.equal(remote.chunks[0], 'client-head')
  assert.equal(client.destination, remote)
  assert.equal(remote.destination, client)
  await host.stop()
  assert.equal(client.destroyed, true)
  assert.equal(remote.destroyed, true)
  assert.equal(host.status(root).running, false)
  assert.throws(() => host.target(workbenchPath), /Start/)
  console.log('Passed: no automatic launch; explicit server-term acceptance; serialized startup and Nx installation; private loopback token; manifest verification; HTTP/CSP proxy; WebSocket handshake and cleanup; folder mapping. All processes and extension files were synthetic.')
} finally { await rm(root, { recursive: true, force: true }) }
