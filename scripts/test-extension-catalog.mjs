import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { installedExtensions, installedExtensionIcon, searchExtensions } from '../server/extension-catalog.mjs'
import { ExtensionWorkbench } from '../server/extension-workbench.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-catalog-test-'))
try {
  const host = new ExtensionWorkbench(root, { runtimeCaches: [], resolveCLI: () => null, resolveLocalNx: () => null })
  const extensions = path.join(host.storage, 'data', 'extensions')
  const packageAt = async (folder, version) => {
    await mkdir(path.join(extensions, folder), { recursive: true })
    await writeFile(path.join(extensions, folder, 'package.json'), JSON.stringify({ publisher: 'example', name: 'tool', displayName: 'Example Tool', version, icon: 'icon.png' }))
    await writeFile(path.join(extensions, folder, 'icon.png'), 'synthetic image')
  }
  await packageAt('example.tool-1.0.0', '1.0.0')
  await packageAt('example.tool-2.0.0', '2.0.0')
  await packageAt('example.tool-3.0.0', '3.0.0')
  await writeFile(path.join(extensions, '.obsolete'), JSON.stringify({ 'example.tool-3.0.0': true }))
  assert.equal(installedExtensions(extensions).length, 1)
  assert.equal(host.listExtensions()[0].version, '2.0.0')
  assert.match(host.listExtensions()[0].iconUrl, /^\/api\/extensions\/icon\?/)
  assert.equal(host.listExtensions()[0].packageDirectory, undefined, 'catalog never exposes filesystem paths')
  assert.equal(installedExtensionIcon(extensions, 'example.tool').contentType, 'image/png')
  assert.equal(installedExtensionIcon(extensions, '../../outside'), null)
  const manifestPath = path.join(extensions, 'example.tool-2.0.0', 'package.json')
  await writeFile(path.join(root, 'outside.png'), 'private synthetic file')
  await writeFile(manifestPath, JSON.stringify({ publisher: 'example', name: 'tool', version: '2.0.0', icon: path.join(root, 'outside.png') }))
  assert.equal(installedExtensionIcon(extensions, 'example.tool'), null, 'icons cannot escape the extension package')
  await packageAt('example.tool-2.0.0', '2.0.0')
  assert.deepEqual(installedExtensions(path.join(root, 'missing')), [])
  let body
  const result = await searchExtensions('Nx Console', 2, async (url, options) => {
    assert.equal(new URL(url).hostname, 'marketplace.visualstudio.com')
    body = JSON.parse(options.body)
    return { ok: true, json: async () => ({ results: [{ extensions: [
      { publisher: { publisherName: 'nrwl' }, extensionName: 'angular-console', displayName: 'Nx Console', shortDescription: 'Nx tools', versions: [{ version: '18.0.0', files: [{ assetType: 'Microsoft.VisualStudio.Services.Icons.Default', source: 'https://example.com/nx.png' }] }] },
      { publisher: { publisherName: '--invalid' }, extensionName: '../../unsafe' },
    ] }] }) }
  })
  assert.equal(body.filters[0].pageNumber, 2)
  assert.equal(body.filters[0].criteria[1].value, 'Nx Console')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'nrwl.angular-console')
  assert.equal(result.items[0].iconUrl, 'https://example.com/nx.png')
  const unsafe = await searchExtensions('test', 1, async () => ({ ok: true, json: async () => ({ results: [{ extensions: [{ publisher: { publisherName: 'example' }, extensionName: 'tool', versions: [{ files: [{ assetType: 'Microsoft.VisualStudio.Services.Icons.Default', source: 'javascript:alert(1)' }] }] }] }] }) }))
  assert.equal(unsafe.items[0].iconUrl, null)
  await assert.rejects(searchExtensions('', 1, async () => ({ ok: false })), /unavailable/)
  await assert.rejects(host.manageExtension('--bad', 'install'), /Invalid/)
  await assert.rejects(host.manageExtension('example.tool', 'delete'), /Invalid/)
  await assert.rejects(host.manageExtension('example.tool', 'install'), /Start/)
  host.findRuntime = () => ({ node: 'synthetic-node', main: 'synthetic-main' })
  host.child = {}; host.port = 1234; host.editorReady = true
  let args
  let process
  host.launch = (_executable, arguments_, options) => {
    args = arguments_
    assert.equal(options.shell, false)
    assert.equal(options.stdio, 'ignore', 'vendor output is not exposed')
    process = new EventEmitter()
    process.kill = () => process.emit('exit', 1)
    return process
  }
  const installing = host.manageExtension('example.tool', 'install')
  await assert.rejects(host.manageExtension('example.other', 'install'), /Wait/)
  assert.equal(args[args.indexOf('--extensions-dir') + 1], extensions)
  assert.equal(args.includes('--install-extension'), true)
  assert.equal(args.includes('--force'), true)
  process.emit('exit', 0)
  assert.equal((await installing).installed, true)
  const uninstalling = host.manageExtension('example.tool', 'uninstall')
  assert.equal(args.includes('--uninstall-extension'), true)
  await writeFile(path.join(extensions, '.obsolete'), JSON.stringify({ 'example.tool-1.0.0': true, 'example.tool-2.0.0': true, 'example.tool-3.0.0': true }))
  process.emit('exit', 0)
  assert.equal((await uninstalling).installed, false)
  assert.equal(host.listExtensions().length, 0)
  const failed = host.manageExtension('example.tool', 'install')
  process.emit('exit', 1)
  await assert.rejects(failed, /failed/)
  console.log('Passed: Marketplace query/mapping, isolated installed packages, obsolete/version filtering, identifier validation, setup gating, serialized install/uninstall, correct storage and failure handling. Network and processes were synthetic.')
} finally {
  if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('openzero-catalog-test-')) await rm(root, { recursive: true, force: true })
}
