import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExtensionWorkbench, findInstalledNxExtension, workbenchFolder, workbenchPath, trustedExtensionRequest } from '../server/extension-workbench.mjs'

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
const responseRequest = (statusCode = 200) => (url, options, callback) => {
  assert.equal(url.searchParams.has('tkn'), false, 'probe avoids query-token redirect loop')
  assert.match(options.headers.cookie, /vscode-tkn=[a-f0-9]{64}/)
  const request = new EventEmitter()
  request.destroy = () => request.emit('error', new Error('cancelled'))
  request.end = () => queueMicrotask(() => {
    const response = new PassThrough()
    response.statusCode = statusCode
    response.headers = { 'content-type': 'text/html' }
    callback(response); response.end('synthetic vendor page')
  })
  return request
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const host = new ExtensionWorkbench(root, { launch, request: responseRequest(), resolveCLI: () => 'synthetic-code-cli', resolveLocalNx: () => null, runtimeCaches: [] })
  assert.equal(host.status(root).running, false)
  assert.equal(launches.length, 0)
  await assert.rejects(host.start(root, false), /Accept/)
  assert.equal(launches.length, 0)
  const statuses = await Promise.all([host.start(root, true), host.start(root, true)])
  assert.equal(launches.length, 1)
  assert.equal(statuses[0].running, true)
  assert.equal(statuses[0].phase, 'downloading')
  assert.equal(statuses[0].path, null, 'opening the port is not editor readiness')
  await wait(20)
  assert.equal(host.status(root).phase, 'ready')
  assert.equal(launches[0].options.shell, false)
  assert.equal(launches[0].options.windowsHide, true)
  assert.equal(launches[0].args[launches[0].args.indexOf('--host') + 1], '127.0.0.1')
  assert.equal(launches[0].args.includes('--without-connection-token'), false)
  const token = await readFile(path.join(host.storage, 'connection-token'), 'utf8')
  assert.equal(token.length, 64)
  assert.equal(host.status(root).path.includes(token), false)
  assert.equal(statuses[0].directory, root)
  const target = host.target(`${workbenchPath}?folder=/project`)
  assert.equal(target.hostname, '127.0.0.1')
  assert.equal(target.port, '43001')
  assert.equal(target.searchParams.has('tkn'), false)
  const cookies = host.upstreamHeaders({ cookie: 'locale=ar; vscode-tkn=stale' }).cookie
  assert.equal(cookies, `locale=ar; vscode-tkn=${token}`)
  assert.throws(() => host.target('/api/license/status'), /Invalid/)
  const otherHost = host.target(`http://someone.example${workbenchPath}`)
  assert.equal(otherHost.hostname, '127.0.0.1')
  await assert.rejects(host.installNx(), /still downloading/)

  const incomplete = path.join(host.storage, 'cli', 'serve-web', 'partial.staging-123')
  await mkdir(path.join(incomplete, 'out'), { recursive: true })
  await writeFile(path.join(incomplete, process.platform === 'win32' ? 'node.exe' : 'node'), '')
  await writeFile(path.join(incomplete, 'out', 'server-main.js'), '')
  assert.equal(host.status(root).runtimeReady, false, 'partial extraction cannot be used to install extensions')

  // Synthetic vendor layout only. Never downloads or executes a real extension.
  const commit = 'a'.repeat(40)
  const runtime = path.join(host.storage, 'cli', 'serve-web', commit)
  await mkdir(path.join(runtime, 'out'), { recursive: true })
  await writeFile(path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'), '')
  await writeFile(path.join(runtime, 'out', 'server-main.js'), '')
  assert.equal(host.status(root).runtimeCached, false, 'Node and server-main alone are not a complete web runtime')
  await mkdir(path.join(runtime, 'out', 'vs', 'code', 'browser', 'workbench'), { recursive: true })
  await writeFile(path.join(runtime, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'), '<html>synthetic editor</html>')
  await mkdir(path.join(runtime, 'bin'), { recursive: true })
  await writeFile(path.join(runtime, 'bin', process.platform === 'win32' ? 'code-server.cmd' : 'code-server'), '')
  await writeFile(path.join(runtime, 'product.json'), JSON.stringify({ commit, quality: 'stable' }))
  assert.equal(host.status(root).runtimeReady, true)
  const install = host.installNx()
  const concurrentInstall = host.installNx()
  assert.equal(launches.length, 2)
  assert.equal(launches[1].args[launches[1].args.indexOf('--install-extension') + 1], 'nrwl.angular-console')
  assert.equal(launches[1].options.shell, false)
  const extension = path.join(host.storage, 'data', 'extensions', 'nrwl.angular-console-1.0.0')
  await mkdir(extension, { recursive: true })
  await writeFile(path.join(extension, 'package.json'), JSON.stringify({ publisher: 'nrwl', name: 'angular-console', version: '1.0.0', main: 'main.js' }))
  await writeFile(path.join(extension, 'main.js'), '// synthetic extension')
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
    assert.equal(options.headers.cookie, `vscode-tkn=${token}`)
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
  assert.equal(proxiedTarget.searchParams.has('tkn'), false)
  assert.equal(responseHeaders['content-security-policy'], "frame-ancestors 'self'")
  assert.equal(responseHeaders.location.includes('tkn='), false)
  assert.equal(Buffer.concat(received).toString(), 'synthetic response')

  // WebSocket upgrade forwards both buffered heads and bidirectional streams.
  let upgradeRequest
  host.request = (url, options) => {
    assert.equal(url.searchParams.has('tkn'), false)
    assert.equal(options.headers.cookie, `vscode-tkn=${token}`)
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

  const pending = new ExtensionWorkbench(path.join(root, 'pending'), { launch, request: responseRequest(202), resolveCLI: () => 'synthetic-code-cli', resolveLocalNx: () => null, runtimeCaches: [], readinessTimeoutMs: 40 })
  await pending.start(root, true)
  await wait(20)
  assert.equal(pending.status(root).path, null, 'vendor download placeholder never becomes an iframe')
  pending.captureRuntimeProgress('Downloading server: 42%')
  assert.equal(pending.status(root).downloadPercent, 42)
  await wait(1550)
  assert.equal(pending.status(root).phase, 'error', 'stalled downloads have a bounded setup period')
  assert.match(pending.status(root).error, /timed out/)
  await pending.stop()
  assert.equal(pending.status(root).phase, 'stopped')
  pending.request = responseRequest()
  await pending.start(root, true); await wait(20)
  assert.equal(pending.status(root).phase, 'ready', 'retry can recover without deleting saved extensions')
  await pending.stop()

  const failed = new ExtensionWorkbench(path.join(root, 'failed'), { launch, request: responseRequest(500), resolveCLI: () => 'synthetic-code-cli', resolveLocalNx: () => null, runtimeCaches: [] })
  await failed.start(root, true); await wait(20)
  assert.equal(failed.status(root).phase, 'error')
  assert.equal(failed.status(root).path, null)
  failed.captureRuntimeProgress('error downloading https://example.invalid/?tkn=secret-value')
  assert.equal(failed.status(root).error.includes('secret-value'), false, 'raw vendor output stays private')
  await failed.stop()
  // Cached starts stay on the completed runtime; explicit updates can fetch a newer one.
  host.request = responseRequest()
  const beforeCached = launches.length
  await host.start(root, true)
  assert.equal(launches[beforeCached].args[launches[beforeCached].args.indexOf('--commit-id') + 1], commit)
  assert.equal(host.status(root).phase, 'starting', 'cached startup is not reported as a fresh download')
  await wait(20); await host.stop()

  const shared = new ExtensionWorkbench(path.join(root, 'web-host'), { launch, request: responseRequest(), resolveCLI: () => 'synthetic-code-cli', resolveLocalNx: () => null, runtimeCaches: [path.join(host.storage, 'cli')] })
  assert.equal(shared.status(root).runtimeCached, true)
  const beforeShared = launches.length
  await shared.start(root, true)
  assert.equal(launches[beforeShared].args[launches[beforeShared].args.indexOf('--cli-data-dir') + 1], path.resolve(host.storage, 'cli'))
  assert.equal(launches[beforeShared].args[launches[beforeShared].args.indexOf('--server-data-dir') + 1], path.join(shared.storage, 'data'), 'only binaries are shared; profiles and extension data stay isolated')
  await wait(20); await shared.stop()
  const beforeUpdate = launches.length
  await host.start(root, true, { updateRuntime: true })
  assert.equal(launches[beforeUpdate].args.includes('--commit-id'), false, 'an explicit editor update is not pinned')
  await wait(20); await host.stop()

  // Import an already installed local package using fixtures, without any marketplace or CLI call.
  const localDirectory = path.join(root, 'ordinary-vscode-extensions')
  const localPackage = path.join(localDirectory, 'nrwl.angular-console-18.102.0')
  await mkdir(localPackage, { recursive: true })
  await writeFile(path.join(localPackage, 'package.json'), JSON.stringify({ publisher: 'nrwl', name: 'angular-console', version: '18.102.0', main: 'main.js' }))
  await writeFile(path.join(localPackage, 'main.js'), '// synthetic Nx Console package')
  const localNx = findInstalledNxExtension(localDirectory)
  assert.equal(localNx.version, '18.102.0')
  const imported = new ExtensionWorkbench(path.join(root, 'local-import'), { launch, request: responseRequest(), resolveCLI: () => 'synthetic-code-cli', resolveLocalNx: () => localNx, runtimeCaches: [] })
  // Reuse only a synthetic runtime reference to exercise the installer independently of startup.
  imported.findRuntime = () => ({ node: 'synthetic-node', main: 'synthetic-server', commit })
  await imported.start(root, true); await wait(20)
  assert.equal(imported.status(root).nxLocalAvailable, true)
  const launchesBeforeImport = launches.length
  await Promise.all([imported.installNx(), imported.installNx()])
  assert.equal(launches.length, launchesBeforeImport, 'local import never downloads or starts an installer')
  assert.equal(imported.status(root).nxInstalled, true)
  assert.equal(await readFile(path.join(imported.storage, 'data', 'extensions', localNx.name, 'main.js'), 'utf8'), '// synthetic Nx Console package')
  await imported.stop()
  await writeFile(path.join(localDirectory, '.obsolete'), JSON.stringify({ [localNx.name]: true }))
  assert.equal(findInstalledNxExtension(localDirectory), null, 'obsolete local extension versions are not imported')
  console.log('Passed: cached runtime pinning, shared binary cache with isolated profiles, explicit updates, local Nx import, obsolete packages, startup/readiness, partial extraction, timeout/retry, private token, HTTP/CSP and WebSocket cleanup. All processes, downloads and extension files were synthetic.')
} finally {
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('openzero-extension-test-')) throw new Error('Unsafe fixture cleanup path')
  await rm(root, { recursive: true, force: true })
}
