import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { retryFileOperation } from './publish-extension.mjs'

const providers = [{ id: 'cline', name: 'Cline' }, { id: 'openrouter', name: 'OpenRouter' }, { id: 'anthropic', name: 'Anthropic' }]
export function findClineExecutable(env = process.env, platform = process.platform) {
  if (env.CLINE_BIN_PATH && existsSync(env.CLINE_BIN_PATH)) return env.CLINE_BIN_PATH
  if (platform === 'win32') {
    const npmFolders = [path.join(env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'npm'),
      ...(env.PATH || '').split(path.delimiter).filter(folder => folder && existsSync(path.join(folder, 'cline.cmd')))]
    for (const folder of npmFolders) {
      const npm = path.join(folder, 'node_modules', 'cline')
      for (const modules of [path.join(npm, 'node_modules'), path.join(folder, 'node_modules')]) {
        const candidate = path.join(modules, '@cline', `cli-windows-${process.arch}`, 'bin', 'cline.exe')
        if (existsSync(candidate)) return candidate
      }
      const cached = path.join(npm, 'bin', '.cline.exe')
      if (existsSync(cached)) return cached
    }
  }
  for (const folder of (env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(folder, platform === 'win32' ? 'cline.exe' : 'cline')
    if (existsSync(candidate)) return candidate
  }
  return null
}
export function clineCredentials(provider, file = path.join(homedir(), '.cline', 'data', 'settings', 'providers.json')) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    const settings = state.providers?.[provider]?.settings
    return { key: settings?.auth?.apiKey || settings?.auth?.accessToken || '', model: settings?.modelId || '' }
  } catch { return { key: '', model: '' } }
}
function failure(error) {
  if (error?.code === 'CLINE_MODEL_UNAVAILABLE') return 'The selected Cline model is no longer available. Choose another model in Settings for a new conversation.'
  if (error?.rpcCode === -32000) return 'Sign in to this provider using cline auth, then reconnect Cline.'
  // Do not expose agent diagnostics, environment values or credential-bearing URLs.
  return 'Cline could not complete this operation. Check provider authentication and model settings.'
}
function selectable(options = []) {
  return options.flatMap(option => Array.isArray(option.options) ? selectable(option.options) : typeof option.value === 'string' ? [option] : [])
}

export class ClineBridge {
  constructor(stateDirectory, { launch = spawn, resolveExecutable = findClineExecutable, credentials = clineCredentials } = {}) {
    this.storage = path.join(stateDirectory, 'cline')
    this.file = path.join(this.storage, 'sessions.json')
    this.launch = launch; this.resolveExecutable = resolveExecutable; this.credentials = credentials
    this.sessions = new Map(); this.connections = new Map(); this.saves = Promise.resolve()
    this.ready = this.restore()
  }
  async restore() {
    try {
      const stored = JSON.parse(await readFile(this.file, 'utf8'))
      for (const session of stored.sessions || []) if (typeof session.id === 'string' && typeof session.directory === 'string') this.sessions.set(session.id, { ...session, active: false, loading: false, preparing: false, permissions: [], error: null, run: null })
    } catch { /* First launch or no local Cline sessions. */ }
  }
  save() {
    const snapshot = JSON.stringify({ sessions: [...this.sessions.values()].map(({ run, cancelTimer, permissions, active, loading, ...session }) => session) })
    this.saves = this.saves.catch(() => {}).then(async () => {
      await mkdir(this.storage, { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, snapshot)
      await retryFileOperation(() => rename(temporary, this.file))
    })
    return this.saves
  }
  status() {
    return { available: Boolean(this.resolveExecutable()), providers: providers.map(provider => ({ ...provider, configured: Boolean(this.credentials(provider.id).key) })) }
  }
  async models(provider = 'cline') {
    if (!providers.some(item => item.id === provider)) throw new Error('Choose a supported Cline provider.')
    let directory = path.dirname(this.resolveExecutable() || '')
    for (let depth = 0; depth < 8; depth++) {
      try {
        const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
        if (manifest.name === 'cline') {
          const catalog = await import(pathToFileURL(path.join(directory, 'node_modules', '@cline', 'llms', 'dist', 'index.js')).href)
          const models = await catalog.getModelsForProvider(provider, { filter: 'chat' })
          return Object.entries(models).map(([id, item]) => ({ id, name: item.name || id, free: item.pricing?.input === 0 && item.pricing?.output === 0 }))
            .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name))
        }
      } catch { /* Try an ancestor package; never expose provider settings. */ }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent
    }
    throw new Error('Could not read the model catalog from the installed Cline CLI package.')
  }
  snapshot(session) {
    const { run, cancelTimer, ...data } = session
    return data
  }
  async list(directory) {
    await this.ready
    return [...this.sessions.values()].filter(session => path.resolve(session.directory).toLowerCase() === path.resolve(directory).toLowerCase())
      .sort((a, b) => b.updatedAt - a.updatedAt).map(session => ({ id: session.id, title: session.title, provider: session.provider, active: session.active, archived: session.archived, updatedAt: session.updatedAt }))
  }
  async get(id) { await this.ready; const session = this.sessions.get(id); if (!session) throw Object.assign(new Error('Cline conversation was not found.'), { status: 404 }); return session }
  async connect(session) {
    if (this.connections.has(session.id)) return this.connections.get(session.id).ready
    const executable = this.resolveExecutable()
    if (!executable) throw Object.assign(new Error('Install Cline CLI with npm i -g cline first.'), { status: 503 })
    const credentials = this.credentials(session.provider)
    if (!credentials.key) throw Object.assign(new Error(`Configure ${session.provider} using cline auth before connecting.`), { status: 401 })
    const env = { ...process.env, CLINE_PROVIDER: session.provider, CLINE_API_KEY: credentials.key, CLINE_SESSION_BACKEND_MODE: 'local' }
    delete env.ELECTRON_RUN_AS_NODE
    const model = session.savedOptions?.find(option => option.id === 'model')?.value || credentials.model
    if (typeof model === 'string' && model) env.CLINE_MODEL = model
    else delete env.CLINE_MODEL
    const child = this.launch(executable, ['--acp', '--auto-approve', 'false'], { cwd: session.directory, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
    const connection = { child, sequence: 0, pending: new Map(), ready: null, closed: false }
    this.connections.set(session.id, connection)
    let buffer = ''
    const close = () => {
      if (connection.closed) return
      connection.closed = true
      for (const request of connection.pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Cline connection closed.')) }
      connection.pending.clear(); this.connections.delete(session.id)
      session.active = false; session.loading = false; session.permissions = []; session.error = 'Cline disconnected. Reconnect to continue.'
      void this.save().catch(() => {})
    }
    connection.close = close
    child.once('error', close); child.once('exit', close); child.stdin.on('error', close)
    child.stdout.setEncoding?.('utf8')
    child.stdout.on('data', chunk => {
      if (connection.closed) return
      buffer += String(chunk)
      if (buffer.length > 8_000_000) { close(); child.kill(); return }
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue
        try { this.receive(session, connection, JSON.parse(line)) } catch { /* Never log raw protocol/credential data. */ }
      }
    })
    connection.ready = (async () => {
      const initialized = await this.request(connection, 'initialize', { protocolVersion: 1, clientInfo: { name: 'open-zero', version: '1.0.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
      if (initialized.protocolVersion !== 1) throw new Error('Unsupported Cline ACP protocol version.')
      session.loading = true
      try {
        let result
        if (session.remoteId && session.messages.some(message => message.role === 'user')) {
          if (!initialized.agentCapabilities?.loadSession) throw new Error('Cline does not support resuming this conversation.')
          // Ignore replay duplicates: the app already has a durable local transcript.
          connection.replaying = true
          try { result = await this.request(connection, 'session/load', { sessionId: session.remoteId, cwd: session.directory, mcpServers: [] }, 90_000) }
          finally { connection.replaying = false }
        } else {
          result = await this.request(connection, 'session/new', { cwd: session.directory, mcpServers: [] }, 90_000)
          if (!result.sessionId) throw new Error('Cline did not return a conversation identifier.')
          session.remoteId = result.sessionId
        }
        this.applyConfig(session, result)
        // Provider/model preferences belong to this conversation, not global Cline defaults.
        for (const saved of session.savedOptions || []) {
          if (saved.id === 'provider') continue
          const option = session.configOptions.find(option => option.id === saved.id)
          const valid = option && (option.type === 'boolean' ? typeof saved.value === 'boolean' : selectable(option.options).some(item => item.value === saved.value))
          if (!valid && saved.id === 'model') throw Object.assign(new Error('Cline model unavailable.'), { code: 'CLINE_MODEL_UNAVAILABLE' })
          if (valid) this.applyConfig(session, await this.request(connection, 'session/set_config_option', { sessionId: session.remoteId, configId: saved.id, value: saved.value }))
        }
        session.error = null
        await this.save()
      } finally { session.loading = false }
    })().catch(error => { if (this.connections.get(session.id) === connection) { close(); child.kill() } session.error = failure(error); throw Object.assign(new Error(failure(error)), { status: 503 }) })
    return connection.ready
  }
  request(connection, method, params, timeoutMs = 30_000) {
    const id = ++connection.sequence
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs ? setTimeout(() => { connection.pending.delete(id); reject(new Error('Cline request timed out.')) }, timeoutMs) : null
      connection.pending.set(id, { resolve, reject, timeout })
      try { this.send(connection, { id, method, params }) } catch (error) { clearTimeout(timeout); connection.pending.delete(id); reject(error) }
    })
  }
  send(connection, message) { if (connection.closed) throw new Error('Cline connection closed.'); connection.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`) }
  applyConfig(session, result) {
    if (Array.isArray(result.configOptions)) session.configOptions = result.configOptions.filter(option => ['select', 'boolean'].includes(option.type) && option.id !== 'provider')
    if (!session.configOptions.length && result.models) session.configOptions = [{ id: 'model', type: 'select', name: 'Model', currentValue: result.models.currentModelId, options: (result.models.availableModels || []).map(item => ({ value: item.modelId, name: item.name })) }]
  }
  receive(session, connection, message) {
    if (message.method === 'session/request_permission' && message.id != null) {
      if (!session.active || message.params?.sessionId !== session.remoteId) { this.send(connection, { id: message.id, result: { outcome: { outcome: 'cancelled' } } }); return }
      session.permissions.push({ id: String(message.id), title: String(message.params.toolCall?.title || 'Tool permission'),
        options: (message.params.options || []).map(option => ({ id: option.optionId, name: option.name, kind: option.kind })), rpcId: message.id })
    } else if (message.method === 'session/update') {
      if (message.params?.sessionId !== session.remoteId || connection.replaying) return
      const update = message.params.update
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        const message = session.messages.find(item => item.id === session.responseId)
        if (message) message.text += update.content.text
      } else if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
        const tool = session.tools.find(tool => tool.id === update.toolCallId)
        if (tool) { tool.title = update.title || tool.title; tool.status = update.status || tool.status }
        else session.tools.push({ id: update.toolCallId || randomUUID(), title: update.title || 'Tool', status: update.status || 'pending' })
        session.tools = session.tools.slice(-30)
      } else if (update?.sessionUpdate === 'config_option_update') this.applyConfig(session, { configOptions: update.configOptions })
      session.updatedAt = Date.now()
    } else if (message.method && message.id != null) this.send(connection, { id: message.id, error: { code: -32601, message: 'Client method is not supported.' } })
    else if (message.id != null) {
      const pending = connection.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout); connection.pending.delete(message.id)
      if (message.error) pending.reject(Object.assign(new Error('Cline RPC failed.'), { rpcCode: message.error.code }))
      else pending.resolve(message.result || {})
    }
  }
  async create(directory, provider, savedOptions = []) {
    await this.ready
    if (!providers.some(item => item.id === provider)) throw new Error('Choose a supported Cline provider.')
    const session = { id: randomUUID(), remoteId: null, directory, provider, title: 'New Cline conversation', messages: [], tools: [], configOptions: [], savedOptions, active: false, loading: false, archived: false, updatedAt: Date.now(), permissions: [], error: null, run: null }
    this.sessions.set(session.id, session)
    try { await this.connect(session); return this.snapshot(session) }
    catch (error) { this.sessions.delete(session.id); await this.save(); throw error }
  }
  async configure(id, configId, value) {
    const session = await this.get(id)
    if (session.active || session.loading || session.preparing) throw Object.assign(new Error('Wait for Cline to finish before changing settings.'), { status: 409 })
    await this.connect(session)
    const option = session.configOptions.find(option => option.id === configId)
    if (!option || !(option.type === 'boolean' ? typeof value === 'boolean' : selectable(option.options).some(item => item.value === value))) throw new Error('Choose an available Cline setting value.')
    this.applyConfig(session, await this.request(this.connections.get(id), 'session/set_config_option', { sessionId: session.remoteId, configId, value }))
    session.savedOptions = [...session.savedOptions.filter(option => option.id !== configId), { id: configId, value }]
    await this.save(); return this.snapshot(session)
  }
  async reconnect(id) {
    const session = await this.get(id)
    if (session.active || session.loading || session.preparing) throw Object.assign(new Error('Wait for Cline to finish before reconnecting.'), { status: 409 })
    const connection = this.connections.get(id)
    if (connection) { connection.close(); connection.child.kill() }
    await this.connect(session)
    return this.snapshot(session)
  }
  async prompt(id, text, messageId, charge, displayText = text) {
    const session = await this.get(id)
    if (session.messages.some(message => message.id === messageId)) return this.snapshot(session)
    if (session.archived) throw Object.assign(new Error('Restore the Cline conversation before sending a message.'), { status: 409 })
    if (session.active || session.loading || session.preparing) throw Object.assign(new Error('Cline is already working in this conversation.'), { status: 409 })
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('Enter a message of up to 100,000 characters.')
    session.preparing = true
    try {
      await this.connect(session)
      await charge()
      session.active = true; session.error = null; session.tools = []; session.permissions = []
      session.responseId = randomUUID()
      session.messages.push({ id: messageId, role: 'user', text: displayText.trim() }, { id: session.responseId, role: 'assistant', text: '' })
      if (session.messages.filter(message => message.role === 'user').length === 1) session.title = displayText.trim().slice(0, 70)
      session.updatedAt = Date.now()
      await this.save()
      session.run = this.request(this.connections.get(id), 'session/prompt', { sessionId: session.remoteId, prompt: [{ type: 'text', text: text.trim() }] }, 0)
        .catch(error => { session.error = failure(error) }).finally(async () => { clearTimeout(session.cancelTimer); session.cancelTimer = null; session.active = false; session.permissions = []; session.run = null; session.updatedAt = Date.now(); await this.save() }).catch(() => { session.error = 'Could not save the Cline conversation locally.' })
      return this.snapshot(session)
    } finally { session.preparing = false }
  }
  async permission(id, permissionId, optionId) {
    const session = await this.get(id)
    const request = session.permissions.find(permission => permission.id === permissionId)
    if (!request || !request.options.some(option => option.id === optionId)) throw new Error('Permission request is no longer available.')
    this.send(this.connections.get(id), { id: request.rpcId, result: { outcome: { outcome: 'selected', optionId } } })
    session.permissions = session.permissions.filter(permission => permission !== request)
  }
  async cancel(id) {
    const session = await this.get(id), connection = this.connections.get(id)
    if (connection && session.active) {
      for (const request of session.permissions) this.send(connection, { id: request.rpcId, result: { outcome: { outcome: 'cancelled' } } })
      session.permissions = []
      this.send(connection, { method: 'session/cancel', params: { sessionId: session.remoteId } })
      clearTimeout(session.cancelTimer)
      session.cancelTimer = setTimeout(() => { if (session.active && this.connections.get(id) === connection) { connection.close(); connection.child.kill() } }, 15_000)
      session.cancelTimer.unref?.()
    }
  }
  async metadata(id, input) {
    const session = await this.get(id)
    if (session.active || session.loading || session.preparing) throw new Error('Wait for the conversation to finish.')
    if (typeof input.title === 'string' && input.title.trim()) session.title = input.title.trim().slice(0, 120)
    if (typeof input.archived === 'boolean') session.archived = input.archived
    await this.save(); return this.snapshot(session)
  }
  async stop() {
    const runs = [...this.sessions.values()].map(session => session.run).filter(Boolean)
    for (const connection of [...this.connections.values()]) { connection.close(); connection.child.kill() }
    this.connections.clear()
    await Promise.allSettled(runs)
    await this.saves.catch(() => {})
  }
}
