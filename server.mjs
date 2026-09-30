import { createServer } from 'node:http'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = appDirectory
const distDirectory = path.join(appDirectory, 'dist')
const stateDirectory = path.join(appDirectory, '.relay-state')
const eventsPath = path.join(stateDirectory, 'events.json')
const codexStatePath = path.join(stateDirectory, 'codex.json')
const maxBodyBytes = 256 * 1024
const getTimeoutMs = 30_000
const postTimeoutMs = 15 * 60_000

/**
 * The model an OpenCode session runs on until the operator picks another one.
 * Kept as a `providerID/modelID` selector so it reads the same as the browser's
 * model list and as what OpenCode reports back on a session.
 */
const defaultOpenCodeModel = process.env.OPENCODE_MODEL ?? 'opencode/big-pickle'
/** OpenCode calls an unqualified model choice "default"; variants are opt-in. */
const defaultModelVariant = 'default'

/** `providerID/modelID` -> the shape OpenCode accepts on a session. */
function modelSelectorToPayload(selector) {
  const value = String(selector ?? '').trim()
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return null
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1), variant: defaultModelVariant }
}

/** The inverse: what OpenCode reports on a session -> `providerID/modelID`. */
function modelPayloadToSelector(model) {
  const providerID = typeof model?.providerID === 'string' ? model.providerID : ''
  const id = typeof model?.id === 'string' ? model.id : ''
  return providerID && id ? `${providerID}/${id}` : ''
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function resolveExistingDirectory(target) {
  const resolved = path.resolve(target)
  if (!existsSync(resolved)) {
    throw new Error(`The project root does not exist: ${resolved}`)
  }
  return resolved
}

const defaultRoot = path.resolve(appDirectory, '..', '..')
const watchRoot = resolveExistingDirectory(option('--root') ?? process.env.WATCH_ROOT ?? defaultRoot)
const requestedPort = Number(option('--port') ?? process.env.OPENCODE_OBSERVER_PORT ?? 4280)
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4280

function powerShellSingleQuoted(value) {
  return String(value).replaceAll("'", "''")
}

/**
 * Opens a folder in the OS file manager.
 *
 * Relay Room has two folders that are easy to confuse: the code it runs from
 * (`projectDirectory`) and the project the session actually works in
 * (`watchRoot`). Callers name which one they mean, and any session's own folder
 * can be opened too.
 */
function openDirectory(target) {
  if (process.platform !== 'win32') throw new HttpError(501, 'Opening a folder is currently available on Windows only.')

  const resolved = path.resolve(target)
  if (!existsSync(resolved)) throw new HttpError(404, `That folder does not exist: ${resolved}`)

  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', [resolved], {
      cwd: resolved,
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function selectProjectFile() {
  if (process.platform !== 'win32') throw new HttpError(501, 'Choosing a local project file is currently available on Windows only.')

  const initialDirectory = powerShellSingleQuoted(projectDirectory)
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    `$dialog.InitialDirectory = '${initialDirectory}'`,
    '$dialog.Filter = "All files (*.*)|*.*"',
    '$dialog.Multiselect = $false',
    '$dialog.CheckFileExists = $true',
    '$result = $dialog.ShowDialog()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($dialog.FileName) }',
  ].join('; ')

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      cwd: projectDirectory,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'The Windows file picker could not be opened.'))
        return
      }
      const selectedPath = stdout.trim()
      if (!selectedPath) {
        resolve(null)
        return
      }
      if (!isInside(projectDirectory, selectedPath)) {
        reject(new HttpError(400, 'Choose a file inside this Relay Room project.'))
        return
      }
      resolve(path.resolve(selectedPath))
    })
  })
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function safeSessionId(value) {
  return typeof value === 'string' && /^ses_[A-Za-z0-9]+$/.test(value) ? value : undefined
}

function safeCodexThreadId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,200}$/.test(value) ? value : undefined
}

function publicError(error) {
  if (error instanceof HttpError) return error.message
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').slice(0, 500)
  return 'An unexpected local error occurred.'
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(data))
}

function sendNoContent(response) {
  response.writeHead(204, { 'Cache-Control': 'no-store' })
  response.end()
}

async function readJson(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) throw new HttpError(413, 'Request body is too large.')
    chunks.push(chunk)
  }

  if (size === 0) return {}

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

// Resolve the real OpenCode binary instead of the npm shim (.ps1/.cmd), so the
// JSON body travels as one literal argv entry and is never re-parsed by a shell.
function openCodeExecutableCandidates() {
  const directories = [
    path.join(appDirectory, 'node_modules', '@opencode', 'cli', 'bin'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm', 'node_modules', '@opencode', 'cli', 'bin')] : []),
    ...(process.env.HOME ? [path.join(process.env.HOME, '.opencode', 'bin')] : []),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ]
  const suffixes = process.platform === 'win32' ? ['.exe', ''] : ['']
  const override = process.env.OPENCODE_EXE
  const candidates = override ? [override] : directories.map((directory) => path.join(directory, 'opencode'))
  const resolved = []

  for (const candidate of candidates) {
    for (const suffix of suffixes) {
      const filePath = suffix ? `${candidate}${suffix}` : candidate
      if (!resolved.includes(filePath)) resolved.push(filePath)
    }
  }

  return resolved
}

let cachedOpenCodeExecutable

function resolveOpenCodeExecutable() {
  if (cachedOpenCodeExecutable) return cachedOpenCodeExecutable

  const candidates = openCodeExecutableCandidates()
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        cachedOpenCodeExecutable = candidate
        return candidate
      }
    } catch {
      // Keep looking.
    }
  }

  throw new Error(
    `Relay Room could not find the OpenCode executable. Set OPENCODE_EXE to its absolute path. Checked: ${candidates.join(', ')}`,
  )
}

function invokeOpenCode(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    let executable
    try {
      executable = resolveOpenCodeExecutable()
    } catch (error) {
      reject(error)
      return
    }

    const args = ['api', method, apiPath]
    if (body !== undefined) args.push('--data', JSON.stringify(body))

    const child = spawn(executable, args, {
      cwd: watchRoot,
      env: process.env,
      windowsHide: true,
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timeoutMs = method === 'GET' ? getTimeoutMs : postTimeoutMs
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error(`OpenCode did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error((stderr || stdout || `OpenCode exited with code ${code}.`).trim()))
          return
        }
        resolve(stdout.trim())
      })
    })
  })
}

async function openCodeApi(method, apiPath, body) {
  const output = await invokeOpenCode(method, apiPath, body)
  const trimmed = output.trim()

  // Some OpenCode endpoints deliberately return HTTP 204 (for example, a form
  // reply). The CLI prints no JSON for those responses, which is still a valid
  // successful result.
  if (!trimmed) return null

  const candidates = [trimmed]
  const jsonStart = trimmed.indexOf('{')
  const jsonEnd = trimmed.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) candidates.push(trimmed.slice(jsonStart, jsonEnd + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next framing before giving up.
    }
  }

  throw new Error('OpenCode returned a response Relay Room could not read.')
}

function codexExecutableCandidates() {
  const candidates = []
  const override = process.env.CODEX_EXE
  if (override) candidates.push(override)

  const desktopBin = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    : undefined

  if (desktopBin) {
    try {
      for (const entry of readdirSync(desktopBin, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(desktopBin, entry.name, 'codex.exe'))
      }
    } catch {
      // The desktop installation is optional. Keep looking for an explicit CLI.
    }
  }

  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'codex.exe'))
  return [...new Set(candidates)]
}

let cachedCodexExecutable

function resolveCodexExecutable() {
  if (cachedCodexExecutable) return cachedCodexExecutable

  const candidates = codexExecutableCandidates()
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        cachedCodexExecutable = candidate
        return candidate
      }
    } catch {
      // Keep looking.
    }
  }

  throw new Error(
    `Relay Room could not find the Codex Desktop CLI. Set CODEX_EXE to its absolute path. Checked: ${candidates.join(', ') || 'no local candidates'}`,
  )
}

const relayCodexInstructions = [
  'You are Codex inside Relay Room: the architect, reasoner, and reviewer.',
  'Do not write or edit implementation code in this thread. Explain the plan, reason about tradeoffs, and review work.',
  'OpenCode is the implementer; it runs whichever model the operator selected for this conversation. You may call relay.delegate_to_opencode only when the latest user message explicitly contains $opencode.',
  'When it contains $opencode, call that tool immediately with the implementation request; do not inspect files or begin implementation yourself first.',
  'When the user asks to review linked OpenCode work, inspect git diff and run the most relevant existing tests, build, or lint command when the read-only environment permits it. Report evidence and delegate corrections through the same explicit $opencode route.',
  'Never claim a handoff, a test, or a code change unless the tool output or local command result confirmed it.',
].join('\n')

const relayDynamicTools = [
  {
    type: 'namespace',
    name: 'relay',
    description: 'Relay Room tools for explicitly delegated OpenCode implementation work.',
    tools: [
      {
        type: 'function',
        name: 'delegate_to_opencode',
        description: 'Queue the user\'s explicitly requested $opencode implementation task with OpenCode.',
        inputSchema: {
          type: 'object',
          properties: { task: { type: 'string', description: 'The implementation task from the user.' } },
          required: ['task'],
          additionalProperties: false,
        },
      },
    ],
  },
]

class CodexAppServerBridge {
  constructor() {
    this.child = null
    this.started = null
    this.nextId = 1
    this.pending = new Map()
    this.stdoutBuffer = ''
    this.stderr = ''
    this.liveMessages = new Map()
    this.delegationGrants = new Map()
    this.activeThreads = new Set()
    this.resumingThreads = new Map()
    this.runningTurns = new Map()
    this.completedTurns = new Map()
  }

  async ensureStarted() {
    if (!this.started) {
      this.started = this.start().catch((error) => {
        this.started = null
        throw error
      })
    }
    return this.started
  }

  async start() {
    const executable = resolveCodexExecutable()
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: watchRoot,
      env: process.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    this.stderr = ''
    this.activeThreads.clear()
    this.resumingThreads.clear()
    this.runningTurns.clear()
    this.completedTurns.clear()
    child.stdout.on('data', (chunk) => this.consumeStdout(chunk.toString()))
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000)
    })
    child.on('error', (error) => this.failAll(error))
    child.on('close', (code) => {
      if (this.child !== child) return
      this.child = null
      this.started = null
      this.runningTurns.clear()
      this.completedTurns.clear()
      this.failAll(new Error(`Codex app-server stopped${code === null ? '' : ` with code ${code}`}.`))
    })

    await this.requestRaw('initialize', {
      clientInfo: { name: 'relay-room', title: 'Relay Room', version: '1.1.0' },
      capabilities: { experimentalApi: true },
    }, 20_000)
    this.write({ jsonrpc: '2.0', method: 'initialized', params: {} })

    return { connected: true, identity: 'Codex Desktop local session' }
  }

  async call(method, params, timeoutMs = 30_000) {
    await this.ensureStarted()
    return this.requestRaw(method, params, timeoutMs)
  }

  requestRaw(method, params, timeoutMs) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error('Codex app-server is not available.'))
    }

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id))
        reject(new Error(`Codex app-server did not answer ${method} in time.`))
      }, timeoutMs)
      this.pending.set(String(id), { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is not available.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) {
        try {
          this.handlePacket(JSON.parse(line))
        } catch {
          // App-server diagnostics are not protocol packets. Keep the bridge alive.
        }
      }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  handlePacket(packet) {
    if (typeof packet?.method === 'string' && packet.id !== undefined) {
      void this.handleServerRequest(packet)
      return
    }

    if (typeof packet?.method === 'string') {
      this.handleNotification(packet)
      return
    }

    if (packet?.id === undefined) return
    const pending = this.pending.get(String(packet.id))
    if (!pending) return
    this.pending.delete(String(packet.id))
    clearTimeout(pending.timer)
    if (packet.error) {
      pending.reject(new Error(packet.error.message || 'Codex app-server returned an error.'))
      return
    }
    pending.resolve(packet.result)
  }

  async handleServerRequest(packet) {
    let result
    try {
      if (packet.method !== 'item/tool/call') throw new Error(`Unsupported Codex client request: ${packet.method}`)
      result = await handleCodexToolCall(packet.params)
    } catch (error) {
      result = {
        success: false,
        contentItems: [{ type: 'inputText', text: `Relay Room could not complete this request: ${publicError(error)}` }],
      }
    }

    try {
      this.write({ jsonrpc: '2.0', id: packet.id, result })
    } catch {
      // The process has already stopped; there is nothing left to respond to.
    }
  }

  handleNotification(packet) {
    const params = packet.params ?? {}
    if (packet.method === 'thread/realtime/item/started' || packet.method === 'thread/realtime/itemAdded') {
      this.recordLiveItem(params.threadId, params.item)
      return
    }

    if (packet.method === 'thread/realtime/item/transcript/delta') {
      this.appendLiveDelta(params.threadId, params.itemId, params.delta)
      return
    }

    if (packet.method === 'thread/realtime/item/completed') {
      this.recordLiveItem(params.threadId, params.item)
      this.removeLiveItem(params.threadId, params.item?.id)
      return
    }

    if (packet.method === 'turn/completed') {
      const turnId = params.turn?.id ?? params.turnId
      this.completeTurn(params.threadId, turnId)
      this.clearDelegationGrant(params.threadId, turnId)
    }
  }

  recordLiveItem(threadId, item) {
    if (!safeCodexThreadId(threadId) || !item?.id || item.type !== 'agentMessage') return
    const messages = this.liveMessages.get(threadId) ?? new Map()
    messages.set(item.id, { id: item.id, type: 'agentMessage', text: String(item.text ?? ''), live: true })
    this.liveMessages.set(threadId, messages)
  }

  appendLiveDelta(threadId, itemId, delta) {
    if (!safeCodexThreadId(threadId) || typeof itemId !== 'string' || typeof delta !== 'string') return
    const messages = this.liveMessages.get(threadId) ?? new Map()
    const previous = messages.get(itemId) ?? { id: itemId, type: 'agentMessage', text: '', live: true }
    previous.text += delta
    messages.set(itemId, previous)
    this.liveMessages.set(threadId, messages)
  }

  removeLiveItem(threadId, itemId) {
    const messages = this.liveMessages.get(threadId)
    if (!messages || typeof itemId !== 'string') return
    messages.delete(itemId)
    if (messages.size === 0) this.liveMessages.delete(threadId)
  }

  getLiveMessages(threadId) {
    return Array.from(this.liveMessages.get(threadId)?.values() ?? [])
  }

  markThreadActive(threadId) {
    if (safeCodexThreadId(threadId)) this.activeThreads.add(threadId)
  }

  markTurnRunning(threadId, turnId) {
    if (!safeCodexThreadId(threadId) || typeof turnId !== 'string' || !turnId) return
    const key = `${threadId}:${turnId}`
    const completedAt = this.completedTurns.get(key)
    if (completedAt && Date.now() - completedAt < 60_000) {
      this.completedTurns.delete(key)
      return
    }
    this.runningTurns.set(threadId, { turnId, startedAt: Date.now(), interruptRequested: false })
  }

  completeTurn(threadId, turnId) {
    if (!safeCodexThreadId(threadId)) return
    const current = this.runningTurns.get(threadId)
    if (!turnId || !current || current.turnId === turnId) this.runningTurns.delete(threadId)
    if (typeof turnId === 'string' && turnId) {
      this.completedTurns.set(`${threadId}:${turnId}`, Date.now())
      if (this.completedTurns.size > 100) {
        const oldestKey = this.completedTurns.keys().next().value
        if (oldestKey) this.completedTurns.delete(oldestKey)
      }
    }
  }

  getTurnState(threadId) {
    const turn = this.runningTurns.get(threadId)
    if (!turn) return { active: false }
    return {
      active: true,
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      stopping: turn.interruptRequested,
    }
  }

  async interruptTurn(threadId) {
    const turn = this.runningTurns.get(threadId)
    if (!turn) throw new HttpError(409, 'Codex is not currently running a turn in this session.')
    if (turn.interruptRequested) return this.getTurnState(threadId)

    turn.interruptRequested = true
    try {
      await this.call('turn/interrupt', { threadId, turnId: turn.turnId }, 10_000)
      return this.getTurnState(threadId)
    } catch (error) {
      turn.interruptRequested = false
      throw error
    }
  }

  async resumeThread(threadId, params) {
    if (this.activeThreads.has(threadId)) return
    const pending = this.resumingThreads.get(threadId)
    if (pending) return pending

    const resume = this.call('thread/resume', { threadId, ...params })
      .then((response) => {
        this.activeThreads.add(threadId)
        return response
      })
      .finally(() => this.resumingThreads.delete(threadId))
    this.resumingThreads.set(threadId, resume)
    return resume
  }

  allowDelegation(threadId, task) {
    this.delegationGrants.set(threadId, { task, turnId: null, expiresAt: Date.now() + 10 * 60_000, used: false })
  }

  bindDelegationTurn(threadId, turnId) {
    const grant = this.delegationGrants.get(threadId)
    if (grant && typeof turnId === 'string') grant.turnId = turnId
  }

  consumeDelegationGrant(threadId, turnId) {
    const grant = this.delegationGrants.get(threadId)
    if (!grant || grant.used || grant.expiresAt < Date.now()) return undefined
    if (grant.turnId && grant.turnId !== turnId) return undefined
    grant.used = true
    return grant
  }

  clearDelegationGrant(threadId, turnId) {
    const grant = this.delegationGrants.get(threadId)
    if (grant && (!turnId || !grant.turnId || grant.turnId === turnId)) this.delegationGrants.delete(threadId)
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  stop() {
    const child = this.child
    this.child = null
    this.started = null
    this.activeThreads.clear()
    this.resumingThreads.clear()
    this.runningTurns.clear()
    this.completedTurns.clear()
    this.failAll(new Error('Relay Room stopped the Codex app-server.'))
    if (child && !child.killed) child.kill()
  }
}

const codexBridge = new CodexAppServerBridge()

function emptyCodexState() {
  return { threads: {}, links: {} }
}

async function readCodexState() {
  try {
    const parsed = JSON.parse(await readFile(codexStatePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return emptyCodexState()
    return {
      threads: parsed.threads && typeof parsed.threads === 'object' ? parsed.threads : {},
      links: parsed.links && typeof parsed.links === 'object' ? parsed.links : {},
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyCodexState()
    return emptyCodexState()
  }
}

async function updateCodexState(change) {
  const state = await readCodexState()
  const result = await change(state)
  await mkdir(stateDirectory, { recursive: true })
  await writeFile(codexStatePath, JSON.stringify(state, null, 2), 'utf8')
  return result
}

function shortThreadTitle(value) {
  const title = String(value ?? '').replaceAll('\u0000', '').trim().replace(/\s+/g, ' ')
  return title.slice(0, 120) || 'محادثة جديدة'
}

async function registerRelayCodexThread(thread, title, directory) {
  const id = safeCodexThreadId(thread?.id)
  if (!id) throw new Error('Codex app-server did not return a usable thread id.')
  const saved = {
    id,
    title: shortThreadTitle(title ?? thread?.name ?? thread?.title),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    directory: typeof directory === 'string' ? directory : undefined,
  }
  await updateCodexState((state) => {
    state.threads[id] = { ...state.threads[id], ...saved }
  })
  return saved
}

/**
 * Every session on the machine, indexed by id, for adoption lookups.
 *
 * Reading the list is one call but adoption can happen for several routes in a
 * row (status, messages, handoff), so the result is cached briefly to avoid a
 * burst of identical calls from one screen opening.
 */
let adoptedLookupCache
const adoptedLookupMaxAgeMs = 5_000

async function sessionLookup() {
  if (adoptedLookupCache && Date.now() - adoptedLookupCache.at < adoptedLookupMaxAgeMs) {
    return adoptedLookupCache.byId
  }
  const response = await codexBridge.call('thread/list', { limit: 200, sortKey: 'updated_at', sortDirection: 'desc' })
  const remote = Array.isArray(response?.data) ? response.data : []
  const byId = new Map(remote.filter((thread) => safeCodexThreadId(thread?.id)).map((thread) => [thread.id, thread]))
  adoptedLookupCache = { at: Date.now(), byId }
  return byId
}

/**
 * The thread record, adopting it first if Relay Room has not seen it yet.
 *
 * Sessions started outside Relay Room are openable on purpose: rather than
 * refusing them, the first touch records the session and the folder it lives
 * in, so the rail can show it and the folder button can reach it.
 */
async function requireRelayCodexThread(threadId) {
  const id = safeCodexThreadId(threadId)
  if (!id) throw new HttpError(400, 'Invalid Codex thread id.')
  const state = await readCodexState()
  if (state.threads[id]) {
    // Backfill the folder for sessions recorded before folders were stored.
    if (!state.threads[id].directory) {
      const live = (await sessionLookup()).get(id)
      if (live?.cwd) {
        const directory = String(live.cwd)
        await updateCodexState((next) => {
          if (next.threads[id]) next.threads[id].directory = directory
        })
        return { id, saved: { ...state.threads[id], directory } }
      }
    }
    return { id, saved: state.threads[id] }
  }

  const live = (await sessionLookup()).get(id)
  if (!live) throw new HttpError(404, 'This Codex session does not belong to Relay Room.')

  const saved = await registerRelayCodexThread(live, live.name ?? live.title, live.cwd)
  return { id, saved }
}

async function ensureRelayCodexThreadLoaded(threadId) {
  const { saved } = await requireRelayCodexThread(threadId)
  // Resume in the folder the session belongs to. A session opened from another
  // project must not be re-rooted into this one.
  const cwd = typeof saved.directory === 'string' && saved.directory ? saved.directory : watchRoot
  try {
    await codexBridge.resumeThread(threadId, {
      cwd,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      developerInstructions: relayCodexInstructions,
      excludeTurns: true,
    })
  } catch (error) {
    if (publicError(error).includes('no rollout found')) {
      throw new HttpError(409, 'This empty Codex session was not persisted before Relay Room restarted. Start a new conversation.')
    }
    throw error
  }
}

/** True when `directory` is the project this Relay Room instance works in. */
function isWorkRoot(directory) {
  try {
    return path.resolve(String(directory)) === path.resolve(watchRoot)
  } catch {
    return false
  }
}

/**
 * Every Codex session on this machine, not only the ones Relay Room created.
 *
 * `thread/list` used to be called with `cwd: watchRoot`, which hid every
 * conversation started elsewhere. Listing without a scope returns them all, and
 * each one carries the folder it belongs to so the reader can tell projects
 * apart. Sessions Relay Room does not own yet are still openable: resuming one
 * registers it here, which is why `needsRegistration` is reported.
 */
async function listAllCodexThreads() {
  const state = await readCodexState()

  const response = await codexBridge.call('thread/list', {
    limit: 200,
    sortKey: 'updated_at',
    sortDirection: 'desc',
  })
  const remote = Array.isArray(response?.data) ? response.data : []
  adoptedLookupCache = { at: Date.now(), byId: new Map(remote.map((thread) => [thread?.id, thread])) }

  return remote
    .filter((thread) => safeCodexThreadId(thread?.id))
    .map((thread) => {
      const saved = state.threads[thread.id]
      // A rollout that has been moved or deleted cannot be opened; keep it out
      // unless the bridge is holding it open right now.
      if (thread?.path && !existsSync(thread.path) && !codexBridge.activeThreads.has(thread.id)) return null
      const directory = typeof thread.cwd === 'string' && thread.cwd ? thread.cwd : (saved?.directory ?? '')
      return {
        id: thread.id,
        // Prefer the name given in Relay Room; the app-server's derived title
        // can lag behind or fall back to a console code-page.
        title: saved?.title ?? thread.name ?? thread.title ?? 'محادثة جديدة',
        directory,
        updatedAt: thread.updatedAt ?? thread.updated_at ?? saved?.updatedAt,
        createdAt: saved?.createdAt ?? thread.createdAt ?? thread.created_at,
        /** The folder this instance works in. */
        inProject: isWorkRoot(directory),
        /** Still running here, so its state is live rather than read from disk. */
        active: codexBridge.activeThreads.has(thread.id),
        /** Relay Room has not recorded this session yet; opening it will. */
        needsRegistration: !saved,
        openCodeModel: saved?.openCodeModel,
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      // The project at hand first, then newest activity.
      if (left.inProject !== right.inProject) return left.inProject ? -1 : 1
      return Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0)
    })
}

async function createRelayCodexThread(input) {
  const title = shortThreadTitle(input?.title)
  const response = await codexBridge.call('thread/start', {
    cwd: watchRoot,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    developerInstructions: relayCodexInstructions,
    dynamicTools: relayDynamicTools,
    threadSource: 'appServer',
  })
  const thread = response?.thread ?? response?.data ?? response
  const saved = await registerRelayCodexThread(thread, title, thread?.cwd ?? watchRoot)
  codexBridge.markThreadActive(saved.id)

  try {
    await codexBridge.call('thread/name/set', { threadId: saved.id, name: title })
  } catch {
    // Naming is presentation-only; the session remains usable if an older CLI lacks this method.
  }

  return { ...thread, ...saved, id: saved.id, title }
}

function textFromCodexInput(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

async function listRelayCodexMessages(threadId) {
  await ensureRelayCodexThreadLoaded(threadId)
  let response
  try {
    response = await codexBridge.call('thread/items/list', { threadId, limit: 200, sortDirection: 'asc' })
  } catch (error) {
    // Fresh empty app-server threads do not have a rollout file yet. The current
    // Codex app-server reports that condition as an error instead of an empty list.
    if (publicError(error).includes('missing source rollout')) return []
    throw error
  }
  const entries = Array.isArray(response?.data) ? response.data : []
  const items = entries.map((entry) => entry?.item).filter(Boolean)
  const knownIds = new Set(items.map((item) => item.id))
  const live = codexBridge.getLiveMessages(threadId).filter((item) => !knownIds.has(item.id))
  return [...items, ...live]
}

function extractOpenCodeTask(text) {
  const hasExplicitTag = /(?:^|\s)\$opencode\b/i.test(text)
  if (!hasExplicitTag) return { hasExplicitTag: false, task: '' }
  return { hasExplicitTag: true, task: text.replace(/\$opencode\b/gi, '').trim() }
}

async function sendRelayCodexMessage(threadId, input) {
  await ensureRelayCodexThreadLoaded(threadId)
  const text = String(input?.text ?? '').replaceAll('\u0000', '').trim()
  if (!text) throw new HttpError(400, 'Write a message to Codex first.')
  if (text.length > 100_000) throw new HttpError(413, 'The Codex message is too long.')

  const delegation = extractOpenCodeTask(text)
  if (delegation.hasExplicitTag && !delegation.task) {
    throw new HttpError(400, 'Write the OpenCode request after $opencode.')
  }
  if (delegation.hasExplicitTag) codexBridge.allowDelegation(threadId, delegation.task)

  try {
    const response = await codexBridge.call('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
    })
    const turnId = response?.turn?.id ?? response?.id
    if (response?.turn?.status !== 'completed') codexBridge.markTurnRunning(threadId, turnId)
    if (delegation.hasExplicitTag) codexBridge.bindDelegationTurn(threadId, turnId)
    await updateCodexState((state) => {
      if (state.threads[threadId]) state.threads[threadId].updatedAt = Date.now()
    })
    return response
  } catch (error) {
    codexBridge.clearDelegationGrant(threadId)
    throw error
  }
}

async function ensureOpenCodeLink(codexThreadId, task) {
  const state = await readCodexState()
  let link = state.links[codexThreadId]

  if (link?.opencodeSessionId) {
    try {
      await requireScopedSession(link.opencodeSessionId)
      return link
    } catch {
      link = undefined
    }
  }

  const title = shortThreadTitle(`Codex · ${task}`)
  const model = state.threads[codexThreadId]?.openCodeModel ?? defaultOpenCodeModel
  const created = await openCodeApi('POST', '/api/session', {
    title,
    model: modelSelectorToPayload(model) ?? modelSelectorToPayload(defaultOpenCodeModel),
    location: { directory: watchRoot },
  })
  const session = created?.data
  if (!session?.id || !session?.location?.directory || !isInside(watchRoot, session.location.directory)) {
    throw new Error('OpenCode returned a session outside the selected project scope.')
  }

  link = {
    codexThreadId,
    opencodeSessionId: session.id,
    title,
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await updateCodexState((next) => {
    next.links[codexThreadId] = link
  })
  return link
}

async function delegateToOpenCode(codexThreadId, task) {
  const link = await ensureOpenCodeLink(codexThreadId, task)
  const response = await openCodeApi('POST', `/api/session/${link.opencodeSessionId}/prompt`, { text: task, delivery: 'queue' })
  const receipt = response?.data
  const delivery = receipt?.delivery ?? response?.delivery
  if (!receipt?.id || receipt.sessionID !== link.opencodeSessionId || delivery !== 'queue') {
    throw new Error('OpenCode did not confirm that it durably queued this request.')
  }

  await updateCodexState((state) => {
    if (state.links[codexThreadId]) state.links[codexThreadId].updatedAt = Date.now()
  })
  await appendRelayEvent({
    role: 'codex',
    kind: 'handoff-sent',
    message: task,
    sessionId: link.opencodeSessionId,
    codexThreadId,
  })
  return link
}

async function handleCodexToolCall(params) {
  if (params?.namespace !== 'relay' || params?.tool !== 'delegate_to_opencode') {
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: 'This Relay Room tool is not available for that request.' }],
    }
  }

  const grant = codexBridge.consumeDelegationGrant(params.threadId, params.turnId)
  if (!grant) {
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: 'OpenCode delegation is allowed only for a current user message that explicitly includes $opencode.' }],
    }
  }

  try {
    const link = await delegateToOpenCode(params.threadId, grant.task)
    return {
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: `OpenCode confirmed the queued handoff in session ${link.opencodeSessionId}. Relay Room is showing its live messages in the handoff rail.`,
        },
      ],
    }
  } catch (error) {
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: `OpenCode handoff failed: ${publicError(error)}` }],
    }
  }
}

function asOpenCodeRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function compactOpenCodeDetail(value, max = 180) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : undefined
}

function firstOpenCodeDetail(input, keys) {
  for (const key of keys) {
    const detail = compactOpenCodeDetail(input?.[key])
    if (detail) return detail
  }
  return undefined
}

function describeOpenCodeTool(part) {
  const toolName = String(part?.name ?? '').trim()
  const normalizedName = toolName.toLowerCase()
  const state = asOpenCodeRecord(part?.state)
  const input = asOpenCodeRecord(state?.input)
  const filePath = firstOpenCodeDetail(input, ['filePath', 'file_path', 'path', 'file', 'filename', 'target'])
  const command = firstOpenCodeDetail(input, ['command', 'cmd', 'script'])
  const query = firstOpenCodeDetail(input, ['query', 'pattern', 'search'])
  const time = asOpenCodeRecord(part?.time)
  const updatedAt = typeof time?.ran === 'number' ? time.ran : typeof time?.created === 'number' ? time.created : undefined

  if (/edit|write|patch|apply/.test(normalizedName)) {
    return { kind: 'edit', label: 'يعدّل ملفًا', detail: filePath, toolName, updatedAt }
  }
  if (/bash|shell|command|terminal|exec/.test(normalizedName)) {
    return { kind: 'command', label: 'يشغّل أمرًا', detail: command ?? filePath, toolName, updatedAt }
  }
  if (/read|glob|grep|find|search|list/.test(normalizedName)) {
    return { kind: 'inspect', label: 'يفحص ملفات المشروع', detail: filePath ?? query, toolName, updatedAt }
  }
  return { kind: 'tool', label: toolName ? `ينفّذ ${toolName}` : 'ينفّذ خطوة', detail: filePath ?? command ?? query, toolName, updatedAt }
}

function describeOpenCodeActivity(messages, active) {
  if (!active) return { active: false, kind: 'idle', label: 'لا توجد عملية OpenCode نشطة' }

  const runningTools = []
  for (const message of messages) {
    const record = asOpenCodeRecord(message)
    if (record?.type !== 'assistant' || !Array.isArray(record.content)) continue
    for (const part of record.content) {
      const partRecord = asOpenCodeRecord(part)
      const state = asOpenCodeRecord(partRecord?.state)
      if (partRecord?.type === 'tool' && (state?.status === 'running' || state?.status === 'streaming')) {
        runningTools.push(describeOpenCodeTool(partRecord))
      }
    }
  }

  if (runningTools.length > 0) {
    runningTools.sort((left, right) => Number(left.updatedAt ?? 0) - Number(right.updatedAt ?? 0))
    return { active: true, ...runningTools[runningTools.length - 1] }
  }

  return { active: true, kind: 'thinking', label: 'OpenCode يفكّر في الخطوة التالية' }
}

function isOpenCodeSessionActive(activeResponse, sessionId) {
  const activeData = activeResponse?.data
  return Boolean(activeData && typeof activeData === 'object' && activeData[sessionId])
}

async function requireOpenCodeLink(codexThreadId) {
  await requireRelayCodexThread(codexThreadId)
  const state = await readCodexState()
  const link = state.links[codexThreadId]
  if (!link?.opencodeSessionId || !safeSessionId(link.opencodeSessionId)) {
    throw new HttpError(409, 'OpenCode has not been linked to this Codex session yet.')
  }
  await requireScopedSession(link.opencodeSessionId)
  return link
}

/**
 * Every model the local OpenCode install can run, in the shape the browser
 * expects. Models that cannot run tool loops stay in the list so they are still
 * selectable information, but the UI filters them out as implementers.
 */
async function listOpenCodeModels() {
  const response = await openCodeApi('GET', '/api/model')
  const models = Array.isArray(response?.data) ? response.data : []
  return models
    .map((model) => {
      const id = modelPayloadToSelector(model)
      if (!id) return null
      const variants = Array.isArray(model?.variants)
        ? model.variants.map((variant) => variant?.id).filter((variant) => typeof variant === 'string')
        : []
      return {
        id,
        providerID: String(model.providerID),
        name: typeof model?.name === 'string' && model.name.trim() ? model.name : id,
        variants,
        tools: Boolean(model?.capabilities?.tools),
      }
    })
    .filter(Boolean)
}

/** The model this Codex conversation runs OpenCode on. */
async function readThreadOpenCodeModel(codexThreadId) {
  const { saved } = await requireRelayCodexThread(codexThreadId)
  return typeof saved.openCodeModel === 'string' && saved.openCodeModel ? saved.openCodeModel : defaultOpenCodeModel
}

/**
 * Point one conversation at a different OpenCode model.
 *
 * The choice is written to the thread first so it survives a restart, then
 * pushed to the live session. An idle session switches immediately; OpenCode
 * refuses mid-turn, and so do we rather than silently queueing the change.
 */
async function setThreadOpenCodeModel(codexThreadId, input) {
  const { id } = await requireRelayCodexThread(codexThreadId)
  const selector = String(input?.model ?? '').trim()
  const payload = modelSelectorToPayload(selector)
  if (!payload) throw new HttpError(400, 'Send a model as providerID/modelID.')

  const state = await readCodexState()
  const link = state.links[id]
  const linkedSessionId = link?.opencodeSessionId && safeSessionId(link.opencodeSessionId)
    ? link.opencodeSessionId
    : null

  // Order matters for diagnosis. An out-of-scope session and an unknown model
  // are different problems, and both used to surface to the operator as
  // "that model is not available" — which sends them looking in the wrong place.
  if (linkedSessionId) {
    await requireScopedSession(linkedSessionId)
    const activeResponse = await openCodeApi('GET', '/api/session/active')
    if (isOpenCodeSessionActive(activeResponse, linkedSessionId)) {
      throw new HttpError(409, 'OpenCode is working right now — switch the model when the current run ends.')
    }
  }

  let models
  try {
    models = await listOpenCodeModels()
  } catch (error) {
    throw new HttpError(502, `Relay Room could not read the model list from OpenCode (${publicError(error)}).`)
  }
  if (models.length === 0) {
    throw new HttpError(502, 'OpenCode returned an empty model list, so the model cannot be changed yet. Try again in a moment.')
  }

  const chosen = models.find((model) => model.id === selector)
  if (!chosen) throw new HttpError(404, 'That model is not available in this OpenCode install.')
  if (!chosen.tools) throw new HttpError(409, 'That model cannot run tool loops, so it cannot implement work here.')

  // A conversation with no OpenCode session yet can still choose: the choice is
  // stored now and used when the first handoff creates that session.
  if (linkedSessionId) {
    await openCodeApi('POST', `/api/session/${linkedSessionId}/model`, { model: payload })
    const live = modelPayloadToSelector((await requireScopedSession(linkedSessionId))?.model)
    if (live !== selector) throw new Error('OpenCode did not confirm the model change.')
  }

  await updateCodexState((next) => {
    next.threads[id] = { ...next.threads[id], openCodeModel: selector, updatedAt: Date.now() }
    if (next.links[id]) next.links[id].model = selector
  })
  await appendRelayEvent({
    role: 'operator',
    kind: 'opencode-model-changed',
    message: selector,
    sessionId: link?.opencodeSessionId ?? '',
    codexThreadId: id,
  })
  return { model: selector, name: chosen.name }
}

async function sendOperatorOpenCodeMessage(codexThreadId, input) {
  const text = String(input?.text ?? '').replaceAll('\u0000', '').trim()
  if (!text) throw new HttpError(400, 'Write a message to OpenCode first.')
  if (text.length > 100_000) throw new HttpError(413, 'The OpenCode message is too long.')

  const link = await requireOpenCodeLink(codexThreadId)
  const activeResponse = await openCodeApi('GET', '/api/session/active')
  const delivery = isOpenCodeSessionActive(activeResponse, link.opencodeSessionId) ? 'steer' : 'queue'
  const response = await openCodeApi('POST', `/api/session/${link.opencodeSessionId}/prompt`, { text, delivery })
  const receipt = response?.data
  if (!receipt?.id || receipt.sessionID !== link.opencodeSessionId || receipt.delivery !== delivery) {
    throw new Error('OpenCode did not confirm that it accepted this message.')
  }

  await updateCodexState((state) => {
    if (state.links[codexThreadId]) state.links[codexThreadId].updatedAt = Date.now()
  })
  await appendRelayEvent({
    role: 'operator',
    kind: 'opencode-message-sent',
    message: text,
    sessionId: link.opencodeSessionId,
    codexThreadId,
  })
  return { delivery, receipt }
}

async function interruptOpenCodeSession(codexThreadId) {
  const link = await requireOpenCodeLink(codexThreadId)
  const activeResponse = await openCodeApi('GET', '/api/session/active')
  if (!isOpenCodeSessionActive(activeResponse, link.opencodeSessionId)) {
    throw new HttpError(409, 'OpenCode is not currently running in this session.')
  }

  await openCodeApi('POST', `/api/session/${link.opencodeSessionId}/interrupt`)
  await appendRelayEvent({
    role: 'operator',
    kind: 'opencode-stop-requested',
    message: 'Requested an immediate OpenCode stop.',
    sessionId: link.opencodeSessionId,
    codexThreadId,
  })
  return { sessionId: link.opencodeSessionId }
}

async function readOpenCodeHandoff(codexThreadId) {
  await requireRelayCodexThread(codexThreadId)
  const state = await readCodexState()
  const link = state.links[codexThreadId]
  // The chosen model is a property of the conversation, not of the OpenCode
  // session, so it is reported even before a session exists for this thread.
  const chosen = state.threads[codexThreadId]?.openCodeModel ?? defaultOpenCodeModel
  if (!link?.opencodeSessionId) {
    return { link: null, model: chosen, messages: [], forms: [], inbox: [], active: false, activity: describeOpenCodeActivity([], false) }
  }

  let session
  try {
    session = await requireScopedSession(link.opencodeSessionId)
  } catch {
    return { link: null, model: chosen, messages: [], forms: [], inbox: [], active: false, activity: describeOpenCodeActivity([], false) }
  }

  // A session can be pointed elsewhere from outside Relay Room, so the rail
  // reports what the session is really running, and falls back to the choice
  // only when OpenCode does not say.
  const model = modelPayloadToSelector(session?.model) || chosen

  const sessionId = link.opencodeSessionId
  const [messagesResponse, formsResponse, inboxResponse, activeResponse] = await Promise.all([
    openCodeApi('GET', `/api/session/${sessionId}/message`),
    openCodeApi('GET', `/api/session/${sessionId}/form`),
    openCodeApi('GET', `/api/session/${sessionId}/inbox`),
    openCodeApi('GET', '/api/session/active'),
  ])
  const active = isOpenCodeSessionActive(activeResponse, sessionId)
  const messages = Array.isArray(messagesResponse?.data) ? messagesResponse.data : []
  return {
    link,
    model,
    messages,
    forms: Array.isArray(formsResponse?.data) ? formsResponse.data : [],
    inbox: Array.isArray(inboxResponse?.data) ? inboxResponse.data : [],
    active,
    activity: describeOpenCodeActivity(messages, active),
  }
}

function safeFormId(value) {
  return typeof value === 'string' && /^frm_[A-Za-z0-9]+$/.test(value) ? value : undefined
}

function isFormAnswer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((answer) => {
    if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') return true
    return Array.isArray(answer) && answer.every((entry) => typeof entry === 'string')
  })
}

async function listScopedSessions() {
  const params = new URLSearchParams({ directory: watchRoot, limit: '100', order: 'desc' })
  const response = await openCodeApi('GET', `/api/session?${params.toString()}`)
  const sessions = Array.isArray(response.data) ? response.data : []

  return sessions.filter((session) => {
    const directory = session?.location?.directory
    return typeof directory === 'string' && isInside(watchRoot, directory)
  })
}

async function requireScopedSession(sessionId) {
  const id = safeSessionId(sessionId)
  if (!id) throw new HttpError(400, 'Invalid session id.')

  const session = (await listScopedSessions()).find((candidate) => candidate.id === id)
  if (!session) throw new HttpError(404, 'This session is not in the selected project scope.')
  return session
}

/**
 * The OpenCode sessions that belong to this project, plus any session a
 * conversation is already linked to.
 *
 * Both halves matter. Filtering strictly by folder would hide the sessions
 * currently in use whenever a conversation was linked while Relay Room watched
 * a different root, and that looks exactly like losing work.
 */
async function listProjectOpenCodeSessions() {
  const state = await readCodexState()
  const linkedBy = new Map()
  for (const [codexThreadId, link] of Object.entries(state.links)) {
    if (link?.opencodeSessionId) linkedBy.set(link.opencodeSessionId, codexThreadId)
  }
  const chosenModels = new Map(
    Object.entries(state.threads).map(([threadId, thread]) => [threadId, thread?.openCodeModel]),
  )

  const response = await openCodeApi('GET', '/api/session?limit=200&order=desc')
  const sessions = Array.isArray(response?.data) ? response.data : []

  let activeIds = new Set()
  try {
    const activeResponse = await openCodeApi('GET', '/api/session/active')
    const activeData = activeResponse?.data
    if (activeData && typeof activeData === 'object') activeIds = new Set(Object.keys(activeData))
  } catch {
    // Liveness is a bonus detail; the list is still useful without it.
  }

  return sessions
    .filter((session) => {
      const directory = session?.location?.directory
      const inScope = typeof directory === 'string' && isInside(watchRoot, directory)
      return inScope || linkedBy.has(session.id)
    })
    .map((session) => {
      const directory = typeof session?.location?.directory === 'string' ? session.location.directory : ''
      const codexThreadId = linkedBy.get(session.id) ?? null
      return {
        id: session.id,
        title: typeof session.title === 'string' && session.title.trim() ? session.title : session.id,
        directory,
        model: modelPayloadToSelector(session?.model),
        updatedAt: session?.time?.updated ?? session?.time?.created,
        createdAt: session?.time?.created,
        active: activeIds.has(session.id),
        inProject: directory ? isInside(watchRoot, directory) : false,
        /** The conversation this session is doing work for, if any. */
        codexThreadId,
        /** Kept so the rail can show which model this conversation settled on. */
        codexThreadModel: codexThreadId ? (chosenModels.get(codexThreadId) ?? null) : null,
      }
    })
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1
      return Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0)
    })
}

/** Stop a running OpenCode session by its own id, linked or not. */
async function interruptOpenCodeSessionById(sessionId) {
  const id = safeSessionId(sessionId)
  if (!id) throw new HttpError(400, 'Invalid session id.')

  const known = (await listProjectOpenCodeSessions()).find((session) => session.id === id)
  if (!known) throw new HttpError(404, 'This session is not in the selected project scope.')

  const activeResponse = await openCodeApi('GET', '/api/session/active')
  if (!isOpenCodeSessionActive(activeResponse, id)) {
    throw new HttpError(409, 'That OpenCode session is not running right now.')
  }

  await openCodeApi('POST', `/api/session/${id}/interrupt`)
  await appendRelayEvent({
    role: 'operator',
    kind: 'opencode-stop-requested',
    message: 'Requested an immediate OpenCode stop.',
    sessionId: id,
    ...(known.codexThreadId ? { codexThreadId: known.codexThreadId } : {}),
  })
  return { sessionId: id }
}

async function readRelayEvents() {
  try {
    const parsed = JSON.parse(await readFile(eventsPath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    return []
  }
}

async function appendRelayEvent(input) {
  const roles = new Set(['codex', 'opencode', 'operator', 'system'])
  const role = roles.has(input.role) ? input.role : 'system'
  const message = String(input.message ?? '').replaceAll('\u0000', '').trim().slice(0, 5000)
  if (!message) throw new HttpError(400, 'A relay note needs a message.')

  const event = {
    id: randomUUID(),
    timestamp: Date.now(),
    role,
    kind: String(input.kind ?? 'note').trim().slice(0, 64) || 'note',
    message,
    sessionId: safeSessionId(input.sessionId),
    codexThreadId: safeCodexThreadId(input.codexThreadId),
  }
  const events = await readRelayEvents()
  await mkdir(stateDirectory, { recursive: true })
  await writeFile(eventsPath, JSON.stringify([...events.slice(-199), event], null, 2), 'utf8')
  return event
}

async function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }
  return types[extension] ?? 'application/octet-stream'
}

async function serveStatic(request, response, url) {
  if (!existsSync(distDirectory)) {
    sendJson(response, 503, { error: 'Build not found. Run npm run build before starting Relay Room.' })
    return
  }

  const requestedPath = decodeURIComponent(url.pathname)
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '')
  let filePath = path.resolve(distDirectory, relativePath)

  if (!isInside(distDirectory, filePath)) {
    sendJson(response, 403, { error: 'Invalid file path.' })
    return
  }

  try {
    if (!(await stat(filePath)).isFile()) throw new Error('not a file')
  } catch {
    filePath = path.join(distDirectory, 'index.html')
  }

  try {
    const content = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': await mimeType(filePath),
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    })
    response.end(content)
  } catch {
    sendJson(response, 404, { error: 'The requested dashboard file was not found.' })
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  try {
    if (request.method === 'GET' && url.pathname === '/api/project') {
      sendJson(response, 200, { data: { directory: projectDirectory, workRoot: watchRoot } })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/project/open') {
      await openDirectory(projectDirectory)
      sendJson(response, 202, { data: { directory: projectDirectory } })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/project/open-work-root') {
      await openDirectory(watchRoot)
      sendJson(response, 202, { data: { directory: watchRoot } })
      return
    }

    // Open the folder a specific session belongs to, which may be another project.
    const openThreadFolderMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/open-folder$/)
    if (openThreadFolderMatch) {
      if (request.method !== 'POST') throw new HttpError(405, 'Only POST is supported for opening a session folder.')
      const { id, saved } = await requireRelayCodexThread(openThreadFolderMatch[1])
      const directory = String(saved.directory ?? '')
      if (!directory) throw new HttpError(409, 'This session has no folder recorded, so there is nothing to open.')
      await openDirectory(directory)
      sendJson(response, 202, { data: { threadId: id, directory } })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/project/select-file') {
      const selectedPath = await selectProjectFile()
      sendJson(response, 200, { data: selectedPath ? { path: selectedPath } : null })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/codex/status') {
      try {
        const status = await codexBridge.ensureStarted()
        sendJson(response, 200, { connected: true, ...status, root: watchRoot })
      } catch (error) {
        sendJson(response, 200, { connected: false, root: watchRoot, error: publicError(error) })
      }
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/codex/threads') {
      sendJson(response, 200, { data: await listAllCodexThreads() })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/codex/threads') {
      const input = await readJson(request)
      const thread = await createRelayCodexThread(input)
      sendJson(response, 201, { data: thread })
      return
    }

    const codexHandoffMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/handoff$/)
    if (request.method === 'GET' && codexHandoffMatch) {
      const [, threadId] = codexHandoffMatch
      sendJson(response, 200, { data: await readOpenCodeHandoff(threadId) })
      return
    }

    const codexOpenCodeMessagesMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/opencode\/messages$/)
    if (codexOpenCodeMessagesMatch) {
      if (request.method !== 'POST') throw new HttpError(405, 'Only POST is supported for OpenCode messages.')
      const [, threadId] = codexOpenCodeMessagesMatch
      const input = await readJson(request)
      sendJson(response, 202, { data: await sendOperatorOpenCodeMessage(threadId, input) })
      return
    }

    const codexOpenCodeStopMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/opencode\/stop$/)
    if (codexOpenCodeStopMatch) {
      if (request.method !== 'POST') throw new HttpError(405, 'Only POST is supported for stopping OpenCode.')
      const [, threadId] = codexOpenCodeStopMatch
      sendJson(response, 202, { data: await interruptOpenCodeSession(threadId) })
      return
    }

    const codexOpenCodeModelMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/opencode\/model$/)
    if (codexOpenCodeModelMatch) {
      const [, threadId] = codexOpenCodeModelMatch
      if (request.method === 'GET') {
        sendJson(response, 200, { data: { model: await readThreadOpenCodeModel(threadId) } })
        return
      }
      if (request.method === 'POST') {
        const input = await readJson(request)
        sendJson(response, 200, { data: await setThreadOpenCodeModel(threadId, input) })
        return
      }
      throw new HttpError(405, 'Only GET and POST are supported for the OpenCode model.')
    }

    const codexTurnStatusMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/status$/)
    if (request.method === 'GET' && codexTurnStatusMatch) {
      const { id } = await requireRelayCodexThread(codexTurnStatusMatch[1])
      sendJson(response, 200, { data: codexBridge.getTurnState(id) })
      return
    }

    const codexTurnStopMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/stop$/)
    if (request.method === 'POST' && codexTurnStopMatch) {
      const { id } = await requireRelayCodexThread(codexTurnStopMatch[1])
      sendJson(response, 202, { data: await codexBridge.interruptTurn(id) })
      return
    }

    const codexMessagesMatch = url.pathname.match(/^\/api\/codex\/threads\/([A-Za-z0-9_-]{6,200})\/messages$/)
    if (codexMessagesMatch) {
      const [, threadId] = codexMessagesMatch
      if (request.method === 'GET') {
        sendJson(response, 200, { data: await listRelayCodexMessages(threadId) })
        return
      }
      if (request.method === 'POST') {
        const input = await readJson(request)
        const turn = await sendRelayCodexMessage(threadId, input)
        sendJson(response, 202, { data: turn })
        return
      }
      throw new HttpError(405, 'Only GET and POST are supported for Codex messages.')
    }

    if (request.method === 'GET' && url.pathname === '/api/models') {
      sendJson(response, 200, { data: await listOpenCodeModels() })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      try {
        const sessions = await listScopedSessions()
        sendJson(response, 200, { online: true, root: watchRoot, sessionCount: sessions.length })
      } catch (error) {
        sendJson(response, 200, { online: false, root: watchRoot, error: publicError(error) })
      }
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/sessions') {
      sendJson(response, 200, { data: await listScopedSessions() })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/opencode/sessions') {
      sendJson(response, 200, { data: await listProjectOpenCodeSessions() })
      return
    }

    const openCodeSessionFolderMatch = url.pathname.match(/^\/api\/opencode\/sessions\/(ses_[A-Za-z0-9]+)\/open-folder$/)
    if (openCodeSessionFolderMatch) {
      if (request.method !== 'POST') throw new HttpError(405, 'Only POST is supported for opening a session folder.')
      const sessionId = openCodeSessionFolderMatch[1]
      const known = (await listProjectOpenCodeSessions()).find((session) => session.id === sessionId)
      if (!known) throw new HttpError(404, 'This session is not in the selected project scope.')
      if (!known.directory) throw new HttpError(409, 'This session has no folder recorded.')
      await openDirectory(known.directory)
      sendJson(response, 202, { data: { sessionId, directory: known.directory } })
      return
    }

    const openCodeSessionStopMatch = url.pathname.match(/^\/api\/opencode\/sessions\/(ses_[A-Za-z0-9]+)\/stop$/)
    if (openCodeSessionStopMatch) {
      if (request.method !== 'POST') throw new HttpError(405, 'Only POST is supported for stopping a session.')
      sendJson(response, 202, { data: await interruptOpenCodeSessionById(openCodeSessionStopMatch[1]) })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const input = await readJson(request)
      const title = String(input.title ?? 'New Relay').trim().slice(0, 120) || 'New Relay'
      const created = await openCodeApi('POST', '/api/session', {
        title,
        model: modelSelectorToPayload(defaultOpenCodeModel),
        location: { directory: watchRoot },
      })
      const session = created.data
      if (!session?.id || !session?.location?.directory || !isInside(watchRoot, session.location.directory)) {
        throw new Error('OpenCode returned a session outside the selected project scope.')
      }
      await appendRelayEvent({
        role: 'system',
        kind: 'session-opened',
        message: `Opened “${title}” with OpenCode.`,
        sessionId: session.id,
      })
      sendJson(response, 201, { data: session })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/relay-events') {
      sendJson(response, 200, { data: await readRelayEvents() })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/relay-events') {
      const input = await readJson(request)
      const sessionId = safeSessionId(input.sessionId)
      if (sessionId) await requireScopedSession(sessionId)
      const event = await appendRelayEvent(input)
      sendJson(response, 201, { data: event })
      return
    }

    const formReplyMatch = url.pathname.match(/^\/api\/sessions\/(ses_[A-Za-z0-9]+)\/forms\/(frm_[A-Za-z0-9]+)\/reply$/)
    if (formReplyMatch) {
      const [, sessionId, formId] = formReplyMatch
      await requireScopedSession(sessionId)
      const safeId = safeFormId(formId)
      if (!safeId) throw new HttpError(400, 'Invalid OpenCode form id.')

      if (request.method !== 'POST') throw new HttpError(405, 'Only POST can answer an OpenCode question.')
      const input = await readJson(request)
      if (!isFormAnswer(input.answer)) throw new HttpError(400, 'An OpenCode answer must be an object of simple field values.')

      await openCodeApi('POST', `/api/session/${sessionId}/form/${safeId}/reply`, { answer: input.answer })
      await appendRelayEvent({
        role: 'operator',
        kind: 'clarification-sent',
        message: 'Sent your clarification to OpenCode.',
        sessionId,
      })
      sendNoContent(response)
      return
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/(ses_[A-Za-z0-9]+)\/(messages|diff|prompt|control)$/)
    if (sessionMatch) {
      const [, sessionId, action] = sessionMatch
      await requireScopedSession(sessionId)

      if (request.method === 'GET' && action === 'messages') {
        const data = await openCodeApi('GET', `/api/session/${sessionId}/message`)
        sendJson(response, 200, data)
        return
      }

      if (request.method === 'GET' && action === 'diff') {
        const data = await openCodeApi('GET', `/api/session/${sessionId}/diff?context=3`)
        sendJson(response, 200, data)
        return
      }

      if (request.method === 'GET' && action === 'control') {
        const [formsResponse, inboxResponse, activeResponse] = await Promise.all([
          openCodeApi('GET', `/api/session/${sessionId}/form`),
          openCodeApi('GET', `/api/session/${sessionId}/inbox`),
          openCodeApi('GET', '/api/session/active'),
        ])
        const forms = Array.isArray(formsResponse?.data) ? formsResponse.data : []
        const inbox = Array.isArray(inboxResponse?.data) ? inboxResponse.data : []
        const activeData = activeResponse?.data
        const active = Boolean(activeData && typeof activeData === 'object' && activeData[sessionId])
        sendJson(response, 200, { data: { forms, inbox, active } })
        return
      }

      if (request.method === 'POST' && action === 'prompt') {
        const input = await readJson(request)
        const text = String(input.text ?? '').replaceAll('\u0000', '').trim()
        if (!text) throw new HttpError(400, 'Write a message before delegating.')
        if (text.length > 100_000) throw new HttpError(413, 'The delegation message is too long.')

        // Queueing is deliberately explicit. The previous default "steer"
        // response could interrupt an in-progress turn without creating a
        // durable user message, while Relay Room still claimed the task had
        // been sent. A queue receipt is a real, observable acknowledgement.
        const data = await openCodeApi('POST', `/api/session/${sessionId}/prompt`, { text, delivery: 'queue' })
        const receipt = data?.data
        const delivery = receipt?.delivery ?? data?.delivery
        if (!receipt?.id || receipt.sessionID !== sessionId || delivery !== 'queue') {
          throw new Error('OpenCode did not confirm that it durably queued this task.')
        }
        await appendRelayEvent({
          role: 'operator',
          kind: 'delegated',
          message: `OpenCode confirmed this task is queued: ${text.slice(0, 240)}`,
          sessionId,
        })
        sendJson(response, 202, { data: receipt, delivery, acknowledged: true })
        return
      }
    }

    if (url.pathname.startsWith('/api/')) {
      throw new HttpError(404, 'Unknown Relay Room endpoint.')
    }

    await serveStatic(request, response, url)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502
    sendJson(response, status, { error: publicError(error) })
  }
})

server.on('close', () => codexBridge.stop())

server.listen(port, '127.0.0.1', () => {
  console.log(`Relay Room is listening at http://127.0.0.1:${port}`)
  console.log(`Project scope: ${watchRoot}`)
})
