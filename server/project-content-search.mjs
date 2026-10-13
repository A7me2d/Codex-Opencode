import { open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'release', 'coverage', '.next', '.nuxt', '.turbo', '.relay-state'])
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }

/** Bounded literal text search over project files, with no subprocess or writes. */
export async function searchProjectContents(directory, query, { signal, maxResults = 1000, maxFiles = 20000, maxFileBytes = 2 * 1024 * 1024, timeoutMs = 8000 } = {}) {
  const matches = []
  if (!query.trim()) return { matches, truncated: false, skippedFiles: 0 }
  if (query.length > 500 || /[\r\n\0]/.test(query)) throw Object.assign(new Error('Enter a single-line search of at most 500 characters.'), { status: 400 })
  const root = await realpath(directory), queue = [root]
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const deadline = Date.now() + timeoutMs
  let visited = 0, skippedFiles = 0, scannedEntries = 0, truncated = false
  const stopped = () => signal?.aborted || Date.now() >= deadline || matches.length >= maxResults || visited >= maxFiles || scannedEntries >= 200000
  outer: while (queue.length) {
    if (stopped()) { truncated = true; break }
    const current = queue.shift()
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { continue }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (stopped()) { truncated = true; break outer }
      scannedEntries++
      if (entry.isSymbolicLink() || excluded.has(entry.name.toLowerCase())) continue
      const candidate = path.join(current, entry.name)
      let target
      try { target = await realpath(candidate) } catch { continue }
      if (!inside(root, target)) continue
      if (entry.isDirectory()) { queue.push(target); continue }
      if (!entry.isFile()) continue
      visited++
      let file, bytes
      try {
        file = await open(target, 'r')
        const size = (await file.stat()).size
        if (size > maxFileBytes) { skippedFiles++; continue }
        const buffer = Buffer.alloc(Math.min(size + 1, maxFileBytes + 1))
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > maxFileBytes) { skippedFiles++; continue }
        bytes = buffer.subarray(0, bytesRead)
      } catch { skippedFiles++; continue }
      finally { await file?.close() }
      if (bytes.includes(0)) { skippedFiles++; continue }
      let text
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { skippedFiles++; continue }
      const relative = path.relative(root, target).split(path.sep).join('/')
      const lines = text.split(/\r\n|\n|\r/)
      for (let line = 0; line < lines.length; line++) {
        if (stopped()) { truncated = true; break outer }
        const value = lines[line]
        for (const match of value.matchAll(pattern)) {
          const index = match.index, length = match[0].length
          const from = Math.max(0, index - 60), to = Math.min(value.length, index + length + 100)
          matches.push({ name: entry.name, path: relative, line: line + 1, column: index + 1,
            text: value.slice(from, to), matchStart: index - from, matchLength: length })
          if (stopped()) { truncated = true; break outer }
        }
      }
    }
  }
  return { matches, truncated, skippedFiles }
}
