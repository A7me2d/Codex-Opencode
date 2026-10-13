import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomInt } from 'node:crypto'

const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.scss', '.less', '.md', '.mdx', '.py', '.java', '.go', '.rs', '.cs', '.cpp', '.h', '.php', '.rb', '.swift', '.kt', '.vue', '.svelte', '.astro', '.sql', '.yaml', '.yml', '.toml'])
const excluded = new Set(['node_modules', 'dist', 'build', 'release', 'coverage', 'vendor'])
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }

/** Metadata-only candidate discovery for the explicitly enabled automatic preview. */
export async function projectPreviewFiles(directory, { maxResults = 300, maxEntries = 20000, timeoutMs = 4000 } = {}) {
  const root = await realpath(directory), queue = [root], files = []
  const deadline = Date.now() + timeoutMs
  let visited = 0
  while (queue.length && files.length < maxResults && visited < maxEntries && Date.now() < deadline) {
    const current = queue.shift()
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { continue }
    for (let i = entries.length - 1; i > 0; i--) { const j = randomInt(i + 1); [entries[i], entries[j]] = [entries[j], entries[i]] }
    for (const entry of entries) {
      if (++visited > maxEntries || files.length >= maxResults || Date.now() >= deadline) break
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || excluded.has(entry.name.toLowerCase())) continue
      if (/(?:^|[._-])(secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)/i.test(entry.name)) continue
      const candidate = path.join(current, entry.name)
      let target
      try { target = await realpath(candidate) } catch { continue }
      if (!inside(root, target)) continue
      if (entry.isDirectory()) { queue.push(target); continue }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue
      try { if ((await stat(target)).size > 512 * 1024) continue } catch { continue }
      files.push(path.relative(root, target).split(path.sep).join('/'))
    }
  }
  return { files }
}
