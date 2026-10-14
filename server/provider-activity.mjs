import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { retryFileOperation } from './publish-extension.mjs'

export const providerIds = ['codex', 'opencode', 'cline']
/** Containers, local settings and thread lists do not contact a provider. */
export function requestProvider(pathname) {
  if (pathname.startsWith('/api/cline/')) return 'cline'
  if (pathname === '/api/health' || pathname === '/api/models' || /^\/api\/(opencode|sessions)(?:\/|$)/.test(pathname) || /\/opencode\/(messages|stop|model)$/.test(pathname) || /\/handoff$/.test(pathname) || pathname === '/api/opencode/mcp') return 'opencode'
  if (/^\/api\/codex\/(status|models|weekly-quota|mcp)$/.test(pathname) || /^\/api\/codex\/threads\/[^/]+\/(messages|stop|changes\/accept)$/.test(pathname) || pathname === '/api/source-control/commit-message') return 'codex'
  return null
}
export class ProviderActivity {
  constructor(directory) {
    this.file = path.join(directory, 'provider-activity.json')
    this.providers = Object.fromEntries(providerIds.map(id => [id, true]))
    this.codexLists = new Map()
    this.writes = Promise.resolve(); this.ready = this.restore()
    void this.ready.catch(() => {})
  }
  async restore() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      for (const id of providerIds) if (typeof saved.providers?.[id] === 'boolean') this.providers[id] = saved.providers[id]
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  enabled(id) { return this.providers[id] === true }
  snapshot() { return { providers: { ...this.providers } } }
  async require(id) {
    await this.ready
    if (!this.enabled(id)) throw Object.assign(new Error(`${id === 'opencode' ? 'OpenCode' : id === 'cline' ? 'Cline' : 'Codex'} is disabled. Enable it in Connections & updates.`), { status: 409 })
  }
  set(id, enabled, { beforeDisable = async () => {}, afterDisable = async () => {} } = {}) {
    if (!providerIds.includes(id) || typeof enabled !== 'boolean') return Promise.reject(Object.assign(new Error('Choose a valid provider and activity state.'), { status: 400 }))
    const operation = this.writes.catch(() => {}).then(async () => {
      await this.ready
      if (this.enabled(id) === enabled) return this.snapshot()
      if (!enabled) await beforeDisable()
      const next = { ...this.providers, [id]: enabled }
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify({ providers: next }), 'utf8')
      await retryFileOperation(() => rename(temporary, this.file))
      this.providers = next
      if (!enabled) await afterDisable()
      return this.snapshot()
    })
    this.writes = operation
    return operation
  }
}
