import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'

export const workbenchPath = '/api/extensions/workbench/'

export function trustedExtensionRequest(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  if (!request.headers.origin) return true // native local clients and same-origin resources
  try {
    const origin = new URL(request.headers.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.host
  } catch { return false }
}

export function findVSCodeCLI(env = process.env, platform = process.platform) {
  const candidates = [env.VSCODE_CLI_EXE]
  if (platform === 'win32') {
    for (const root of [env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
      const location = root.endsWith('Local') ? path.join(root, 'Programs') : root
      candidates.push(path.join(location, 'Microsoft VS Code', 'bin', 'code-tunnel.exe'))
    }
    for (const folder of (env.PATH ?? '').split(path.delimiter)) candidates.push(path.join(folder, 'code-tunnel.exe'))
  } else {
    for (const folder of (env.PATH ?? '').split(path.delimiter)) candidates.push(path.join(folder, 'code'))
  }
  return candidates.find(file => file && existsSync(file)) ?? null
}

export function workbenchFolder(directory, platform = process.platform) {
  const normalized = directory.replaceAll('\\', '/')
  return platform === 'win32' && !normalized.startsWith('/') ? `/${normalized}` : normalized
}

/** A private, on-demand VS Code host. No runtime is launched during import. */
export class ExtensionWorkbench {
  constructor(stateDirectory, { launch = spawn, request = httpRequest, resolveCLI = findVSCodeCLI, readinessTimeoutMs = 600_000 } = {}) {
    this.storage = path.join(stateDirectory, 'extension-workbench')
    this.launch = launch
    this.request = request
    this.resolveCLI = resolveCLI
    this.child = null
    this.starting = null
    this.port = null
    this.token = null
    this.error = null
    this.connections = new Set()
    this.installing = null
    this.installer = null
    this.phase = 'stopped'
    this.downloadPercent = null
    this.editorReady = false
    this.readinessTimeoutMs = readinessTimeoutMs
    this.readinessTimer = null
    this.readinessRequest = null
  }

  status(directory) {
    const cli = this.resolveCLI()
    return { directory, available: Boolean(cli), running: Boolean(this.child && this.port), starting: Boolean(this.starting),
      error: this.error, nxWorkspace: existsSync(path.join(directory, 'nx.json')),
      phase: this.phase, downloadPercent: this.downloadPercent,
      runtimeReady: this.editorReady && Boolean(this.findRuntime()), installing: Boolean(this.installing), nxInstalled: this.nxInstalled(),
      path: this.port && this.editorReady ? `${workbenchPath}?${new URLSearchParams({ folder: workbenchFolder(directory) })}` : null }
  }

  async start(directory, acceptedTerms) {
    if (this.child && this.port) return this.status(directory)
    if (this.starting) { await this.starting; return this.status(directory) }
    if (acceptedTerms !== true) throw Object.assign(new Error('Accept the VS Code Server terms to start the extensions workspace.'), { status: 400 })
    const cli = this.resolveCLI()
    if (!cli) throw Object.assign(new Error('Install Visual Studio Code or configure VSCODE_CLI_EXE to use extensions.'), { status: 503 })
    this.starting = this.launchHost(cli, directory)
    try { await this.starting; return this.status(directory) }
    finally { this.starting = null }
  }

  async launchHost(cli, directory) {
    await mkdir(this.storage, { recursive: true })
    this.token = randomBytes(32).toString('hex')
    const tokenFile = path.join(this.storage, 'connection-token')
    await writeFile(tokenFile, this.token, { mode: 0o600 })
    this.error = null
    this.phase = 'starting'; this.editorReady = false; this.downloadPercent = null
    const child = this.launch(cli, ['serve-web', '--host', '127.0.0.1', '--port', '0',
      '--cli-data-dir', path.join(this.storage, 'cli'), '--server-data-dir', path.join(this.storage, 'data'),
      '--server-base-path', workbenchPath.slice(0, -1), '--connection-token-file', tokenFile,
      '--default-folder', directory, '--disable-telemetry', '--accept-server-license-terms'],
    { cwd: this.storage, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    await new Promise((resolve, reject) => {
      let ready = false
      let output = ''
      const fail = () => {
        this.error ||= 'Could not start the VS Code extensions workspace. Check the VS Code installation and internet connection.'
        this.phase = 'error'; this.editorReady = false
        this.cancelReadiness()
        if (!ready) { clearTimeout(timeout); reject(new Error(this.error)) }
      }
      const timeout = setTimeout(() => { fail(); void this.stop() }, 30_000)
      const capture = chunk => {
        // CLI output can contain authentication URLs. Parse it without logging it.
        output = `${output}${chunk}`.replace(/\x1b\[[0-9;]*m/g, '').slice(-8192)
        this.captureRuntimeProgress(String(chunk))
        const match = output.match(/Web UI available at http:\/\/127\.0\.0\.1:(\d+)/)
        if (!match || ready) return
        const port = Number(match[1])
        if (port < 1 || port > 65535) return
        this.port = port; ready = true; clearTimeout(timeout)
        this.phase = 'downloading'
        this.monitorReadiness(child)
        resolve()
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      child.once('error', fail)
      child.once('exit', () => {
        if (this.child === child) { this.child = null; this.port = null; this.token = null; fail() }
        else if (!ready) fail()
      })
    })
  }

  captureRuntimeProgress(chunk) {
    if (this.phase === 'error' || this.phase === 'stopped') return
    const clean = chunk.replace(/\x1b\[[0-9;]*m/g, '')
    if (/Downloading server/i.test(clean) && !this.editorReady) {
      this.phase = 'downloading'
      const percent = clean.match(/(\d+(?:\.\d+)?)\s*%/)
      if (percent) this.downloadPercent = Math.min(100, Number(percent[1]))
    }
    if (/Starting server/i.test(clean) && !this.editorReady) this.phase = 'starting'
    // Never expose raw CLI output: it may contain tokens, URLs or private paths.
    if (/error getting latest version|error downloading|failed to download|error serving request|ServerDownloadError/i.test(clean)) {
      this.readinessFailed('VS Code Server could not be downloaded or started. Check your internet connection or proxy, then retry.')
    }
  }

  cancelReadiness() {
    clearTimeout(this.readinessTimer); this.readinessTimer = null
    this.readinessRequest?.destroy(); this.readinessRequest = null
  }

  readinessFailed(message) {
    this.error = message; this.phase = 'error'; this.editorReady = false
    this.cancelReadiness()
  }

  monitorReadiness(child) {
    const deadline = Date.now() + this.readinessTimeoutMs
    const probe = () => {
      if (this.child !== child || this.phase === 'error') return
      if (Date.now() >= deadline) {
        this.readinessFailed('VS Code Server setup timed out. Check your internet connection or proxy, then retry the extension workspace.')
        return
      }
      let settled = false
      let timeout
      const next = () => {
        if (settled) return
        settled = true; clearTimeout(timeout)
        this.readinessRequest = null
        if (this.child === child && !this.editorReady && ['starting', 'downloading'].includes(this.phase)) this.readinessTimer = setTimeout(probe, 1500)
      }
      const target = this.target(workbenchPath)
      const request = this.request(target, { method: 'GET', headers: this.upstreamHeaders() }, response => {
        // A real workbench responds 200; serve-web's download placeholder is 202.
        response.resume()
        if (this.child !== child) { next(); return }
        if (response.statusCode === 200 && /text\/html/i.test(response.headers['content-type'] ?? '')) {
          this.editorReady = true; this.phase = 'ready'; this.error = null
          this.downloadPercent = null
        } else if (response.statusCode >= 400) {
          this.readinessFailed('VS Code Server could not be downloaded or started. Check your internet connection or proxy, then retry.')
        }
        next()
      })
      this.readinessRequest = request
      timeout = setTimeout(() => { request.destroy(); next() }, Math.min(15_000, Math.max(1, deadline - Date.now())))
      request.on('error', next)
      request.end()
    }
    // Start the lazy vendor download even before an iframe is mounted.
    this.readinessTimer = setTimeout(probe, 0)
  }

  target(incoming) {
    if (!this.port || !this.token || !this.child) throw Object.assign(new Error('Start the extensions workspace first.'), { status: 503 })
    const url = new URL(incoming, `http://127.0.0.1:${this.port}`)
    if (!url.pathname.startsWith(workbenchPath)) throw Object.assign(new Error('Invalid extensions workspace path.'), { status: 400 })
    url.protocol = 'http:'; url.hostname = '127.0.0.1'; url.port = String(this.port)
    url.username = ''; url.password = ''
    url.searchParams.delete('tkn')
    return url
  }

  upstreamHeaders(headers = {}) {
    // Query-token authentication redirects the root page to remove that token.
    // Re-injecting it on every proxy request would create an endless 302 loop.
    const cookies = (headers.cookie ?? '').split(';').map(value => value.trim())
      .filter(value => value && !/^vscode-tkn\s*=/.test(value))
    cookies.push(`vscode-tkn=${this.token}`)
    return { ...headers, cookie: cookies.join('; ') }
  }

  findRuntime() {
    const root = path.join(this.storage, 'cli')
    if (!existsSync(root)) return null
    const candidates = []
    const walk = (directory, depth) => {
      const node = path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node')
      const main = path.join(directory, 'out', 'server-main.js')
      if (existsSync(node) && existsSync(main)) {
        const relative = path.relative(realpathSync(root), realpathSync(directory))
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) candidates.push({ node, main, updated: statSync(main).mtimeMs })
        return
      }
      if (depth >= 4) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.includes('.staging-')) walk(path.join(directory, entry.name), depth + 1)
      }
    }
    try { walk(root, 0) } catch { return null }
    return candidates.sort((a, b) => b.updated - a.updated)[0] ?? null
  }

  nxInstalled() {
    const directory = path.join(this.storage, 'data', 'extensions')
    try {
      return readdirSync(directory, { withFileTypes: true }).some(entry => {
        if (!entry.isDirectory() || !entry.name.startsWith('nrwl.angular-console-')) return false
        try {
          const manifest = JSON.parse(readFileSync(path.join(directory, entry.name, 'package.json'), 'utf8'))
          return manifest.publisher === 'nrwl' && manifest.name === 'angular-console'
        } catch { return false }
      })
    } catch { return false }
  }

  async installNx() {
    if (!this.child || !this.port) throw Object.assign(new Error('Start the extensions workspace first.'), { status: 409 })
    if (this.installing) return this.installing
    const runtime = this.findRuntime()
    if (!this.editorReady || !runtime) throw Object.assign(new Error('VS Code is still downloading. Wait for the editor to load, then install Nx Console.'), { status: 409 })
    this.installing = new Promise((resolve, reject) => {
      const child = this.launch(runtime.node, [runtime.main, '--server-data-dir', path.join(this.storage, 'data'),
        '--extensions-dir', path.join(this.storage, 'data', 'extensions'), '--install-extension', 'nrwl.angular-console',
        '--accept-server-license-terms', '--disable-telemetry', '--force'],
      { cwd: this.storage, windowsHide: true, shell: false, stdio: 'ignore' })
      this.installer = child
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Installing Nx Console timed out. Check your internet connection and retry.')) }, 180_000)
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Could not start the Nx Console installer.')) })
      child.once('exit', code => {
        clearTimeout(timeout)
        if (code === 0 && this.nxInstalled()) resolve({ installed: true, id: 'nrwl.angular-console' })
        else reject(new Error('Could not install Nx Console. Open the Extensions view inside VS Code for details.'))
      })
    }).finally(() => { this.installing = null; this.installer = null })
    return this.installing
  }

  proxy(request, response) {
    if (!trustedExtensionRequest(request)) throw Object.assign(new Error('Open the extensions workspace from Open Zero.'), { status: 403 })
    const target = this.target(request.url)
    const upstream = this.request(target, { method: request.method, headers: this.upstreamHeaders(request.headers) }, result => {
      const headers = { ...result.headers }
      if (headers.location) {
        const redirect = new URL(headers.location, target)
        if (redirect.origin === target.origin) {
          redirect.searchParams.delete('tkn')
          headers.location = `${redirect.pathname}${redirect.search}${redirect.hash}`
        }
      }
      // Preserve VS Code's same-origin embedding policy; no CSP weakening.
      response.writeHead(result.statusCode ?? 502, headers)
      result.pipe(response)
    })
    upstream.on('error', () => {
      if (!response.headersSent) { response.writeHead(502, { 'Content-Type': 'text/plain' }); response.end('The extensions workspace is unavailable. Reload or restart it.') }
      else response.destroy()
    })
    request.on('aborted', () => upstream.destroy())
    response.on('close', () => { if (!response.writableEnded) upstream.destroy() })
    request.pipe(upstream)
  }

  upgrade(request, socket, head) {
    if (!trustedExtensionRequest(request)) { socket.destroy(); return }
    let target
    try { target = this.target(request.url) } catch { socket.destroy(); return }
    const upstream = this.request(target, { headers: this.upstreamHeaders(request.headers) })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      this.connections.add(socket); this.connections.add(remote)
      const headers = response.rawHeaders.reduce((result, value, index, array) => index % 2 ? result : `${result}${value}: ${array[index + 1]}\r\n`, '')
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`)
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      socket.pipe(remote); remote.pipe(socket)
      const close = () => { this.connections.delete(socket); this.connections.delete(remote); socket.destroy(); remote.destroy() }
      socket.once('close', close); remote.once('close', close)
      socket.once('error', close); remote.once('error', close)
    })
    upstream.on('response', () => socket.destroy())
    upstream.on('error', () => socket.destroy())
    socket.once('close', () => upstream.destroy())
    upstream.end()
  }

  async stop() {
    this.editorReady = false; this.phase = 'stopped'; this.downloadPercent = null
    this.cancelReadiness()
    this.installer?.kill()
    const child = this.child
    this.child = null; this.port = null; this.token = null
    for (const socket of this.connections) socket.destroy()
    this.connections.clear()
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = this.launch('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
        killer.once('error', resolve); killer.once('exit', resolve)
      })
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }
    }
  }
}
