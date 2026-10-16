import { mkdir, readFile, realpath, stat, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { retryFileOperation } from './publish-extension.mjs'

const issue = message => Object.assign(new Error(message), { status: 400 })
const inside = (root, target) => { const relative = path.relative(root, target); return !relative.startsWith('..') && !path.isAbsolute(relative) }
const keyOf = root => createHash('sha256').update(root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()).digest('hex').slice(0, 24)
export class BrainMemory {
  constructor(stateDirectory) {
    this.config = path.join(stateDirectory, 'core-brain.json')
    this.writes = Promise.resolve()
  }
  async directory() {
    try { const config = JSON.parse(await readFile(this.config, 'utf8')); return config.directory || null }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async configure(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw issue('Choose an absolute Core-Brain folder.')
    const resolved = await realpath(directory)
    if (!(await stat(resolved)).isDirectory()) throw issue('Choose a Core-Brain folder.')
    const pending = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.config), { recursive: true })
      const temporary = `${this.config}.tmp`
      await writeFile(temporary, JSON.stringify({ directory: resolved }), 'utf8')
      await retryFileOperation(() => rename(temporary, this.config))
      return { directory: resolved }
    })
    this.writes = pending; return pending
  }
  async location(projectDirectory) {
    const directory = await this.directory()
    if (!directory) throw issue('Configure the local Core-Brain folder first.')
    const root = await realpath(directory)
    const project = await realpath(projectDirectory)
    const key = keyOf(project)
    const projects = path.join(root, 'projects')
    // Validate each existing component before reading or creating inside it.
    for (const target of [projects, path.join(projects, key)]) {
      try { if (!inside(root, await realpath(target))) throw issue('Core-Brain paths must stay inside its folder.') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const file = path.join(projects, key, 'memory.jsonl')
    try { if (!inside(root, await realpath(file))) throw issue('Core-Brain memory must stay inside its folder.') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    return { project, key, file }
  }
  async list(projectDirectory) {
    const location = await this.location(projectDirectory)
    let raw
    try { if ((await stat(location.file)).size > 2_000_000) throw issue('Archive this project’s memory before adding more entries (2 MB limit).'); raw = await readFile(location.file, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    return raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
      let entry
      try { entry = JSON.parse(line) } catch { throw issue(`Invalid Core-Brain JSON at line ${index + 1}.`) }
      if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string' || entry.text.length > 4000 || typeof entry.createdAt !== 'string' || !['proposed', 'approved', 'rejected'].includes(entry.status) || !entry.source || !Array.isArray(entry.evidence) || entry.evidence.length > 8 || entry.evidence.some(item => typeof item.file !== 'string' || typeof item.sha256 !== 'string')) throw issue(`Invalid Core-Brain entry at line ${index + 1}.`)
      return entry
    }).filter(entry => entry.projectKey === location.key)
  }
  change(projectDirectory, operation) {
    const pending = this.writes.catch(() => {}).then(async () => {
      const location = await this.location(projectDirectory)
      const entries = await this.list(projectDirectory)
      const result = await operation(entries, location)
      const raw = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
      if (Buffer.byteLength(raw) > 2_000_000) throw issue('Project memory reached its 2 MB limit. Archive old entries first.')
      await mkdir(path.dirname(location.file), { recursive: true })
      const temporary = `${location.file}.${randomUUID()}.tmp`
      await writeFile(temporary, raw, 'utf8')
      await retryFileOperation(() => rename(temporary, location.file))
      return result
    })
    this.writes = pending; return pending
  }
  propose(projectDirectory, input, source) {
    return this.change(projectDirectory, async (entries, location) => {
      if (!['decision', 'preference', 'architecture', 'lesson'].includes(input.kind) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) throw issue('Choose a memory kind and text of up to 4000 characters.')
      if (input.scope !== undefined && !['project', 'team'].includes(input.scope)) throw issue('Choose project or team memory.')
      if (input.scope === 'team' && source.slotId !== 'manager') throw issue('Only the manager project may propose shared team memory.')
      const evidence = []
      if (input.files !== undefined && (!Array.isArray(input.files) || input.files.length > 8)) throw issue('Supply at most eight evidence files.')
      for (const name of input.files || []) {
        if (typeof name !== 'string' || path.isAbsolute(name) || !inside(location.project, path.resolve(location.project, name))) throw issue('Evidence paths must be relative to this project.')
        const target = await realpath(path.resolve(location.project, name))
        if (!inside(location.project, target) || /(?:^|[\\/])(?:\.env(?:\..*)?|credentials[^\\/]*|auth\.json|license\.bin)$/i.test(name)) throw issue('Choose a project source file without credentials.')
        if ((await stat(target)).size > 1_000_000) throw issue('Evidence files must be smaller than 1 MB.')
        evidence.push({ file: name, sha256: createHash('sha256').update(await readFile(target)).digest('hex') })
      }
      const entry = { id: randomUUID(), projectKey: location.key, scope: input.scope || 'project', kind: input.kind, text: input.text.trim(), status: 'proposed', source: { threadId: source.threadId, slotId: source.slotId, origin: source.origin === 'operator' ? 'operator' : 'agent-report' }, evidence, createdAt: new Date().toISOString() }
      entries.push(entry); return entry
    })
  }
  review(projectDirectory, id, status) {
    return this.change(projectDirectory, entries => {
      if (!['approved', 'rejected'].includes(status)) throw issue('Approve or reject this memory entry.')
      const entry = entries.find(entry => entry.id === id)
      if (!entry) throw issue('Memory entry was not found.')
      entry.status = status; entry.reviewedAt = new Date().toISOString(); return entry
    })
  }
  async retrieve(projectDirectory, query = '', { teamOnly = false } = {}) {
    if (!await this.directory()) return []
    const location = await this.location(projectDirectory)
    const entries = (await this.list(projectDirectory)).filter(entry => entry.status === 'approved' && (!teamOnly || entry.scope === 'team'))
    const words = String(query).toLocaleLowerCase().split(/\s+/).filter(word => word.length > 2).slice(0, 24)
    const results = []
    for (const entry of entries.sort((a, b) => words.filter(word => b.text.toLocaleLowerCase().includes(word)).length - words.filter(word => a.text.toLocaleLowerCase().includes(word)).length || b.createdAt.localeCompare(a.createdAt)).slice(0, 24)) {
      let stale = false
      for (const evidence of entry.evidence || []) {
        try {
          const target = await realpath(path.resolve(location.project, evidence.file))
          if (!inside(location.project, target) || (await stat(target)).size > 1_000_000 || createHash('sha256').update(await readFile(target)).digest('hex') !== evidence.sha256) stale = true
        } catch { stale = true }
      }
      if (!stale) results.push({ id: entry.id, scope: entry.scope || 'project', kind: entry.kind, text: entry.text, source: entry.source, createdAt: entry.createdAt })
      if (results.length >= 8) break
    }
    return results
  }
}
