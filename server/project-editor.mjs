import path from 'node:path'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const maxBytes = 512 * 1024
function fail(status, message) { throw Object.assign(new Error(message), { status }) }
function inside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
async function resolveFile(workRoot, requestedRoot, relativePath) {
  const root = await realpath(workRoot)
  if (typeof requestedRoot !== 'string' || path.resolve(requestedRoot).toLowerCase() !== path.resolve(workRoot).toLowerCase()) fail(409, 'The project changed. Reopen the file in the current project.')
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) fail(400, 'Choose a file inside the current project.')
  const requested = path.resolve(root, relativePath)
  if (!inside(root, requested)) fail(403, 'The file is outside the current project.')
  const target = await realpath(requested)
  if (!inside(root, target)) fail(403, 'The file points outside the current project.')
  const info = await stat(target)
  if (!info.isFile()) fail(400, 'Choose a regular text file.')
  if (info.size > maxBytes) fail(413, 'The editor supports text files up to 512 KB.')
  return target
}
async function snapshot(target) {
  const bytes = await readFile(target)
  if (bytes.length > maxBytes) fail(413, 'The editor supports text files up to 512 KB.')
  if (bytes.includes(0)) fail(415, 'Binary files cannot be opened in the code editor.')
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { fail(415, 'The editor supports UTF-8 text files. This file has another encoding.') }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  return { content: text.replace(/\r\n?/g, '\n'), version: createHash('sha256').update(bytes).digest('hex'), bom, ending: text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n' }
}
export async function readProjectFile(workRoot, input) {
  const target = await resolveFile(workRoot, input.root, input.path)
  const { content, version } = await snapshot(target)
  return { path: input.path, content, version }
}
export async function saveProjectFile(workRoot, input) {
  if (typeof input.content !== 'string' || typeof input.version !== 'string') fail(400, 'File content and original version are required.')
  const target = await resolveFile(workRoot, input.root, input.path)
  const current = await snapshot(target)
  if (current.version !== input.version) fail(409, 'This file changed on disk. Reload it before saving to avoid overwriting another edit.')
  const text = (current.bom ? '\uFEFF' : '') + input.content.replace(/\r\n?/g, '\n').replace(/\n/g, current.ending)
  if (Buffer.byteLength(text, 'utf8') > maxBytes) fail(413, 'The editor supports text files up to 512 KB.')
  await writeFile(target, text, 'utf8')
  const { content, version } = await snapshot(target)
  return { path: input.path, content, version }
}
