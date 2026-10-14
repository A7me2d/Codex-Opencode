import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { AgentExtensions } from '../server/agent-extensions.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-agent-extensions-'))
const archive = (id, extra = {}) => {
  const [publisher, name] = id.split('.')
  return zipSync({ 'extension/package.json': strToU8(JSON.stringify({ publisher, name, version: '1.0.0', contributes: { snippets: [{ language: 'html', path: './snippets.json' }] } })),
    'extension/snippets.json': strToU8('{ // comment\n "Test": {"prefix":"tw-card","body":["<div class=\"${1:flex}\">","  $0","</div>"]}}'), ...extra })
}
try {
  const bytes = archive('example.snippets')
  let calls = 0
  const manager = new AgentExtensions(root, { fetcher: async (_url, options) => {
    calls++
    if (options.method === 'POST') return Response.json({ results: [{ extensions: [{ publisher: { publisherName: 'example' }, extensionName: 'snippets', versions: [{ files: [{ assetType: 'Microsoft.VisualStudio.Services.VSIXPackage', source: 'https://example.test/package.vsix' }] }] }] }] })
    return new Response(bytes)
  } })
  assert.equal(manager.status(root).phase, 'ready', 'no VS Code setup gate')
  await manager.manageExtension('example.snippets', 'install')
  assert.equal(calls, 2, 'only gallery metadata and selected package are downloaded')
  assert.equal(manager.listExtensions()[0].support, 'snippets')
  assert.equal(manager.listExtensions()[0].enabled, true)
  assert.equal(manager.snippets().snippets[0].label, 'tw-card')
  assert.match(manager.snippets().snippets[0].body, /\$0/)
  await manager.manageExtension('example.snippets', 'disable')
  assert.equal(manager.snippets().snippets.length, 0)
  const restored = new AgentExtensions(root)
  assert.equal(restored.listExtensions()[0].enabled, false, 'disable persists')
  await restored.manageExtension('example.snippets', 'enable')
  assert.equal(restored.snippets().snippets.length, 1)
  await manager.installArchive('bradlc.vscode-tailwindcss', archive('bradlc.vscode-tailwindcss'))
  assert.equal(manager.snippets().tailwind, true)
  await manager.manageExtension('bradlc.vscode-tailwindcss', 'disable')
  assert.equal(manager.snippets().tailwind, false)
  const unsupported = zipSync({ 'extension/package.json': strToU8(JSON.stringify({ publisher: 'example', name: 'commands', version: '1.0.0', main: 'extension.js' })) })
  await manager.installArchive('example.commands', unsupported)
  assert.equal(manager.listExtensions().find(item => item.id === 'example.commands').enabled, false)
  await assert.rejects(manager.manageExtension('example.commands', 'enable'), /does not support/)
  const outside = path.join(root, 'preserved.txt')
  await writeFile(outside, 'preserve me')
  await assert.rejects(manager.installArchive('example.snippets', archive('example.snippets', { 'extension/../../preserved.txt': strToU8('overwrite') })), /Unsafe/)
  assert.equal(await readFile(outside, 'utf8'), 'preserve me')
  await assert.rejects(manager.installArchive('wrong.identity', bytes), /Invalid/)
  await manager.manageExtension('example.snippets', 'uninstall')
  assert.equal(manager.listExtensions().some(item => item.id === 'example.snippets'), false)
  assert.equal(await readFile(outside, 'utf8'), 'preserve me')
  console.log('Passed: direct VSIX install, JSONC snippets, persistent enable/disable, Tailwind gating, unsupported extensions, archive traversal and identity checks, isolated uninstall. Network and packages were synthetic.')
} finally {
  if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('openzero-agent-extensions-')) await rm(root, { recursive: true, force: true })
}
