import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const settings = { tailwindCSS: { suggestions: true, validate: true, classAttributes: ['class', 'className', 'ngClass', 'class:list'],
  includeLanguages: {}, experimental: {}, lint: {}, hovers: true, codeActions: true, emmetCompletions: false }, editor: { tabSize: 2 } }

export class TailwindCompletions {
  constructor({ launch = spawn, executable = process.execPath, entrypoint } = {}) {
    this.launch = launch; this.executable = executable
    this.entrypoint = entrypoint || path.join(path.dirname(require.resolve('@tailwindcss/language-server/package.json')), 'bin', 'tailwindcss-language-server')
    this.child = null; this.root = null; this.pending = new Map(); this.sequence = 0; this.documents = new Map(); this.ready = null
  }
  send(message) {
    if (!this.child) throw new Error('Tailwind language server is unavailable.')
    const data = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
    this.child.stdin.write(`Content-Length: ${data.length}\r\n\r\n`); this.child.stdin.write(data)
  }
  request(method, params) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('Tailwind language server request timed out.')) }, 20_000)
      this.pending.set(id, { resolve, reject, timeout })
      try { this.send({ id, method, params }) } catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error) }
    })
  }
  async ensure(root) {
    if (this.child && this.root === root) return this.ready
    this.stop()
    this.root = root
    const child = this.launch(this.executable, [this.entrypoint, '--stdio'], { cwd: root, env: { ...process.env }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
    this.child = child
    let buffer = Buffer.alloc(0)
    child.stdout.on('data', data => {
      if (this.child !== child) return
      buffer = Buffer.concat([buffer, data])
      while (true) {
        const header = buffer.indexOf('\r\n\r\n'); if (header < 0) break
        const size = Number(buffer.subarray(0, header).toString().match(/Content-Length:\s*(\d+)/i)?.[1])
        if (!Number.isFinite(size) || size > 20_000_000) { this.stop(); break }
        if (buffer.length < header + 4 + size) break
        const body = buffer.subarray(header + 4, header + 4 + size); buffer = buffer.subarray(header + 4 + size)
        try { this.receive(JSON.parse(body.toString())) } catch { /* Ignore malformed protocol data; never log project contents. */ }
      }
    })
    child.stdin.on('error', () => { if (this.child === child) this.stop() })
    child.once('error', () => { if (this.child === child) this.stop() })
    child.once('exit', () => { if (this.child === child) this.stop() })
    const uri = pathToFileURL(root).href
    this.ready = this.request('initialize', { processId: process.pid, rootUri: uri, workspaceFolders: [{ uri, name: path.basename(root) }],
      capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { completion: { completionItem: { snippetSupport: true } } } },
      initializationOptions: { userLanguages: {}, configuration: settings } }).then(() => {
      this.send({ method: 'initialized', params: {} })
      this.send({ method: 'workspace/didChangeConfiguration', params: { settings } })
    })
    return this.ready
  }
  receive(message) {
    if (message.method && message.id != null) {
      let result = null
      if (message.method === 'workspace/configuration') result = (message.params?.items || []).map(item => {
        if (!item.section) return settings
        return item.section.split('.').reduce((value, key) => value?.[key], settings) ?? null
      })
      if (message.method === 'workspace/workspaceFolders') result = [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }]
      this.send({ id: message.id, result })
    } else if (message.id != null) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout); this.pending.delete(message.id)
      if (message.error) pending.reject(new Error('Tailwind language server could not complete the request.'))
      else pending.resolve(message.result)
    }
  }
  async complete(root, file, language, text, position) {
    await this.ensure(root)
    const uri = pathToFileURL(file).href
    const previous = this.documents.get(uri)
    if (!previous) {
      this.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: language, version: 1, text } } })
      this.documents.set(uri, { version: 1, text })
    } else if (previous.text !== text) {
      previous.version++; previous.text = text
      this.send({ method: 'textDocument/didChange', params: { textDocument: { uri, version: previous.version }, contentChanges: [{ text }] } })
    }
    const result = await this.request('textDocument/completion', { textDocument: { uri }, position, context: { triggerKind: 1 } })
    const items = Array.isArray(result) ? result : result?.items || []
    const prefix = text.split('\n')[position.line]?.slice(0, position.character).match(/[\w/.[\]#!%-]+$/)?.[0] || ''
    const filtered = prefix ? items.filter(item => item.label?.startsWith(prefix)) : items
    return filtered.slice(0, 400).map(item => ({ label: item.label, detail: item.detail, insertText: item.insertText,
      insertTextFormat: item.insertTextFormat, textEdit: item.textEdit }))
  }
  stop() {
    const child = this.child; this.child = null; this.ready = null; this.root = null; this.documents.clear()
    for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Tailwind language server stopped.')) }
    this.pending.clear(); child?.kill()
  }
}
