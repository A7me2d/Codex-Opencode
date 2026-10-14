import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { unzipSync } from 'fflate'
import { parse } from 'jsonc-parser'
import { extensionIdPattern, installedPackages, installedExtensions } from './extension-catalog.mjs'

export class AgentExtensions {
  constructor(stateDirectory, { fetcher = fetch } = {}) {
    this.storage = path.join(stateDirectory, 'extension-workbench')
    this.directory = path.join(this.storage, 'data', 'extensions')
    this.preferencesFile = path.join(this.storage, 'agent-enabled.json')
    this.fetcher = fetcher
    this.busy = false
    this.revision = 0
  }
  preferences() { try { return JSON.parse(readFileSync(this.preferencesFile, 'utf8')) } catch { return {} } }
  listExtensions() {
    const preferences = this.preferences()
    return installedExtensions(this.directory).map(item => ({ ...item, enabled: item.support !== 'unsupported' && preferences[item.id.toLowerCase()] !== false }))
  }
  status(directory) { return { directory, available: true, phase: 'ready', runtimeReady: true, installing: this.busy, revision: this.revision, path: null } }
  async setEnabled(id, enabled) {
    const item = this.listExtensions().find(item => item.id.toLowerCase() === id.toLowerCase())
    if (!item) throw new Error('Extension is not installed.')
    if (enabled && item.support === 'unsupported') throw new Error('This extension requires VS Code APIs that the Agent editor does not support yet.')
    await mkdir(this.storage, { recursive: true })
    const preferences = this.preferences()
    preferences[id.toLowerCase()] = enabled
    const temporary = `${this.preferencesFile}.${randomBytes(8).toString('hex')}.tmp`
    await writeFile(temporary, JSON.stringify(preferences))
    await rename(temporary, this.preferencesFile)
    this.revision++
    return { id, enabled }
  }
  async manageExtension(id, action) {
    if (typeof id !== 'string' || !extensionIdPattern.test(id) || !['install', 'uninstall', 'enable', 'disable'].includes(action)) throw Object.assign(new Error('Invalid extension or action.'), { status: 400 })
    if (this.busy) throw Object.assign(new Error('Wait for the current extension operation to finish.'), { status: 409 })
    this.busy = true
    try {
      if (action === 'enable' || action === 'disable') return await this.setEnabled(id, action === 'enable')
      if (action === 'uninstall') {
        if (!existsSync(this.directory)) return { id, installed: false }
        // Only remove matching packages in this app's owned extension directory.
        for (const entry of (await import('node:fs')).readdirSync(this.directory, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue
          const location = path.resolve(this.directory, entry.name)
          if (path.dirname(location) !== path.resolve(this.directory)) continue
          let manifest
          try { manifest = JSON.parse(readFileSync(path.join(location, 'package.json'), 'utf8')) } catch { continue }
          if (`${manifest.publisher}.${manifest.name}`.toLowerCase() === id.toLowerCase()) await rm(location, { recursive: true, force: true })
        }
        this.revision++
        return { id, installed: false }
      }
      const response = await this.fetcher('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
        body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: id }], pageNumber: 1, pageSize: 1 }], flags: 914, assetTypes: [] }),
      })
      if (!response.ok) throw new Error('Could not find the extension package.')
      const result = await response.json()
      const extension = result.results?.[0]?.extensions?.find(item => `${item.publisher?.publisherName}.${item.extensionName}`.toLowerCase() === id.toLowerCase())
      const platform = process.platform === 'win32' ? `win32-${process.arch}` : `${process.platform}-${process.arch}`
      const version = extension?.versions?.find(version => version.targetPlatform === platform) || extension?.versions?.find(version => !version.targetPlatform || version.targetPlatform === 'universal')
      const asset = version?.files?.find(file => file.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage')?.source
      if (!asset || new URL(asset).protocol !== 'https:') throw new Error('No compatible extension package was found.')
      const download = await this.fetcher(asset, { signal: AbortSignal.timeout(120_000) })
      if (!download.ok || Number(download.headers.get('content-length')) > 100_000_000) throw new Error('Could not download the extension package.')
      const reader = download.body.getReader()
      const chunks = []; let bytes = 0
      try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 100_000_000) throw new Error('The extension package is too large.'); chunks.push(value) } }
      finally { await reader.cancel() }
      const buffer = Buffer.concat(chunks)
      return await this.installArchive(id, buffer)
    } finally { this.busy = false }
  }
  async installArchive(id, buffer) {
    let expanded = 0; let count = 0
    const files = unzipSync(buffer, { filter: file => {
      if (!file.name.startsWith('extension/') || file.name.endsWith('/')) return false
      expanded += file.originalSize; count++
      if (expanded > 250_000_000 || count > 20000) throw new Error('The extension package exceeds the extraction limit.')
      return true
    } })
    const manifest = JSON.parse(Buffer.from(files['extension/package.json'] || []).toString('utf8'))
    if (`${manifest.publisher}.${manifest.name}`.toLowerCase() !== id.toLowerCase() || !/^[0-9][a-z0-9.+-]*$/i.test(manifest.version)) throw new Error('Invalid extension package manifest.')
    await mkdir(this.directory, { recursive: true })
    const staging = path.join(this.storage, `.agent-import-${randomBytes(8).toString('hex')}`)
    await mkdir(staging)
    try {
      for (const [name, contents] of Object.entries(files)) {
        const relative = name.slice('extension/'.length)
        if (relative.includes('\\') || relative.includes(':') || relative.split('/').includes('..')) throw new Error('Unsafe extension package path.')
        const target = path.resolve(staging, relative)
        if (!target.startsWith(`${path.resolve(staging)}${path.sep}`)) throw new Error('Unsafe extension package path.')
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, contents)
      }
      const destination = path.join(this.directory, `${id.toLowerCase()}-${manifest.version}-openzero`)
      if (existsSync(destination)) return { id, installed: true }
      await rename(staging, destination)
      // Old VS Code uninstall metadata must not hide a fresh native install.
      this.revision++
      return { id, installed: true }
    } finally {
      if (path.dirname(path.resolve(staging)) === path.resolve(this.storage)) await rm(staging, { recursive: true, force: true })
    }
  }
  snippets() {
    const enabled = new Set(this.listExtensions().filter(item => item.enabled).map(item => item.id.toLowerCase()))
    const snippets = []
    for (const item of installedPackages(this.directory)) {
      if (!enabled.has(item.id.toLowerCase())) continue
      const root = realpathSync(item.packageDirectory)
      const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      for (const contribution of manifest.contributes?.snippets || []) {
        try {
          const file = realpathSync(path.resolve(root, contribution.path))
          if (!file.startsWith(`${root}${path.sep}`)) continue
          const text = readFileSync(file, 'utf8'); if (text.length > 2_000_000) continue
          const definitions = parse(text)
          for (const [name, definition] of Object.entries(definitions || {})) {
            const body = Array.isArray(definition.body) ? definition.body.join('\n') : definition.body
            if (typeof body !== 'string' || body.length > 30000) continue
            for (const prefix of Array.isArray(definition.prefix) ? definition.prefix : [definition.prefix]) {
              if (typeof prefix !== 'string' || !prefix || snippets.length >= 10000) continue
              snippets.push({ label: prefix, body, description: typeof definition.description === 'string' ? definition.description : name,
                language: contribution.language || definition.scope || '', extension: item.id })
            }
          }
        } catch { /* Ignore invalid snippet contributions; never run extension JavaScript. */ }
      }
    }
    return { snippets, tailwind: enabled.has('bradlc.vscode-tailwindcss'), revision: this.revision }
  }
}
