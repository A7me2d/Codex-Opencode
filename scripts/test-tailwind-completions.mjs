import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { TailwindCompletions } from '../server/tailwind-completions.mjs'

const messages = []
let child
const server = new TailwindCompletions({ entrypoint: 'synthetic-tailwind-server', launch: (_exe, args, options) => {
  assert.equal(args[1], '--stdio'); assert.equal(options.shell, false); assert.equal(options.windowsHide, true)
  child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => { child.killed = true }
  let buffer = Buffer.alloc(0)
  child.stdin.on('data', data => {
    buffer = Buffer.concat([buffer, data])
    const header = buffer.indexOf('\r\n\r\n'); if (header < 0) return
    const size = Number(buffer.subarray(0, header).toString().match(/Content-Length: (\d+)/)[1])
    if (buffer.length < header + 4 + size) return
    const message = JSON.parse(buffer.subarray(header + 4, header + 4 + size).toString()); buffer = buffer.subarray(header + 4 + size); messages.push(message)
    if (message.id && message.method) queueMicrotask(() => {
      const response = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize' ? { capabilities: {} } : { items: [{ label: 'flex', insertText: 'flex' }] } }))
      const frame = Buffer.concat([Buffer.from(`Content-Length: ${response.length}\r\n\r\n`), response])
      child.stdout.write(frame.subarray(0, 10)); child.stdout.write(frame.subarray(10))
    })
  })
  return child
} })
try {
  const root = process.cwd()
  const file = `${root}/synthetic.html`
  const first = await server.complete(root, file, 'html', '<div class="fl">', { line: 0, character: 14 })
  assert.equal(first[0].label, 'flex')
  assert.equal(messages.find(message => message.method === 'textDocument/didOpen').params.textDocument.text, '<div class="fl">')
  await server.complete(root, file, 'html', '<div class="fle">', { line: 0, character: 15 })
  assert.equal(messages.find(message => message.method === 'textDocument/didChange').params.contentChanges[0].text, '<div class="fle">', 'unsaved buffer is sent')
  assert.equal(messages.filter(message => message.method === 'initialize').length, 1, 'one server per workspace')
  server.receive({ id: 99, method: 'workspace/configuration', params: { items: [{ section: 'tailwindCSS.classAttributes' }] } })
  assert.ok(messages.find(message => message.id === 99).result[0].includes('className'))
  server.stop(); assert.equal(child.killed, true); assert.equal(server.documents.size, 0)
  console.log('Passed: framed/fragmented LSP, initialization/configuration, completion mapping, unsaved document updates, workspace reuse and cleanup. Language server and documents were synthetic.')
} finally { server.stop() }
