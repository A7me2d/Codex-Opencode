import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export const extensionIdPattern = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i

export function installedPackages(directory) {
  if (!existsSync(directory)) return []
  let obsolete = {}
  try { obsolete = JSON.parse(readFileSync(path.join(directory, '.obsolete'), 'utf8')) } catch { /* optional vendor metadata */ }
  const packages = new Map()
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || obsolete[entry.name]) continue
    try {
      const manifest = JSON.parse(readFileSync(path.join(directory, entry.name, 'package.json'), 'utf8'))
      const id = `${manifest.publisher}.${manifest.name}`
      if (!extensionIdPattern.test(id) || typeof manifest.version !== 'string') continue
      const item = { id, name: manifest.displayName || manifest.name, publisher: manifest.publisher,
        description: manifest.description || '', version: manifest.version, installed: true,
        packageDirectory: path.join(directory, entry.name), icon: typeof manifest.icon === 'string' ? manifest.icon : null }
      item.support = id.toLowerCase() === 'bradlc.vscode-tailwindcss' ? 'tailwind' : Array.isArray(manifest.contributes?.snippets) && manifest.contributes.snippets.length ? 'snippets' : 'unsupported'
      const previous = packages.get(id.toLowerCase())
      if (!previous || item.version.localeCompare(previous.version, 'en', { numeric: true }) > 0) packages.set(id.toLowerCase(), item)
    } catch { /* Ignore incomplete packages without exposing their contents. */ }
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function installedExtensions(directory) {
  return installedPackages(directory).map(({ packageDirectory, icon, ...item }) => ({ ...item,
    iconUrl: icon ? `/api/extensions/icon?${new URLSearchParams({ id: item.id, version: item.version })}` : null }))
}

export function installedExtensionIcon(directory, id) {
  if (typeof id !== 'string' || !extensionIdPattern.test(id)) return null
  const item = installedPackages(directory).find(item => item.id.toLowerCase() === id.toLowerCase())
  if (!item?.icon) return null
  try {
    const root = realpathSync(item.packageDirectory)
    const file = realpathSync(path.resolve(root, item.icon))
    const relative = path.relative(root, file)
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
    const contentType = types[path.extname(file).toLowerCase()]
    const info = statSync(file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !contentType || !info.isFile() || info.size > 2_000_000) return null
    return { file, contentType }
  } catch { return null }
}

function marketplaceIcon(extension) {
  const source = extension.versions?.[0]?.files?.find(file => file.assetType === 'Microsoft.VisualStudio.Services.Icons.Default')?.source
  if (typeof source !== 'string') return null
  try { const url = new URL(source); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}

export async function searchExtensions(query, page = 1, fetcher = fetch) {
  const text = String(query || '').trim().slice(0, 200)
  const pageNumber = Math.floor(Math.max(1, Math.min(100, Number(page) || 1)))
  const response = await fetcher('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 8, value: 'Microsoft.VisualStudio.Code' },
      ...(text ? [{ filterType: 10, value: text }] : [])], pageNumber, pageSize: 24, sortBy: text ? 0 : 4, sortOrder: 0 }], assetTypes: [], flags: 914 }),
  })
  if (!response.ok) throw new Error('The extension marketplace is unavailable. Try again later.')
  const payload = await response.json()
  const items = (payload.results?.[0]?.extensions || []).flatMap(extension => {
    const id = `${extension.publisher?.publisherName}.${extension.extensionName}`
    if (!extensionIdPattern.test(id)) return []
    return [{ id, name: extension.displayName || extension.extensionName, publisher: extension.publisher.publisherName,
      description: extension.shortDescription || '', version: extension.versions?.[0]?.version || '', installed: false, iconUrl: marketplaceIcon(extension) }]
  })
  return { items, page: pageNumber, hasMore: items.length === 24 }
}
