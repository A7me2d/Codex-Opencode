import { createServer } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const distDirectory = path.join(appDirectory, 'dist')
const stateDirectory = path.join(appDirectory, '.relay-state')
const eventsPath = path.join(stateDirectory, 'events.json')
const maxBodyBytes = 256 * 1024
const getTimeoutMs = 30_000
const postTimeoutMs = 15 * 60_000

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

    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const input = await readJson(request)
      const title = String(input.title ?? 'New Relay').trim().slice(0, 120) || 'New Relay'
      const created = await openCodeApi('POST', '/api/session', {
        title,
        model: { providerID: 'opencode', id: 'big-pickle', variant: 'default' },
        location: { directory: watchRoot },
      })
      const session = created.data
      if (!session?.id || !session?.location?.directory || !isInside(watchRoot, session.location.directory)) {
        throw new Error('OpenCode returned a session outside the selected project scope.')
      }
      await appendRelayEvent({
        role: 'system',
        kind: 'session-opened',
        message: `Opened “${title}” with OpenCode / Big Pickle.`,
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

server.listen(port, '127.0.0.1', () => {
  console.log(`Relay Room is listening at http://127.0.0.1:${port}`)
  console.log(`Project scope: ${watchRoot}`)
})
