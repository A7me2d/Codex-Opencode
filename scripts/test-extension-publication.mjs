import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { publishExtension, installationMarker } from '../server/publish-extension.mjs'
import { installedExtensions } from '../server/extension-catalog.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-publication-test-'))
const directory = path.join(root, 'extensions')
const manifest = JSON.stringify({ publisher: 'example', name: 'tool', version: '1.0.0' })
const blocked = async () => { throw Object.assign(new Error('synthetic Windows lock'), { code: 'EPERM' }) }
const sleep = async () => {}
async function stage(name) {
  const location = path.join(root, name)
  await mkdir(location)
  await writeFile(path.join(location, 'package.json'), manifest)
  await writeFile(path.join(location, 'complete.txt'), 'complete contents')
  return location
}
try {
  await mkdir(directory)
  const source = await stage('retry-staging')
  const destination = path.join(directory, 'retry')
  let attempts = 0
  await publishExtension(source, destination, { extensionDirectory: directory, sleep, move: async (...args) => { if (++attempts < 3) return blocked(); return rename(...args) } })
  assert.equal(attempts, 3)
  assert.equal(await readFile(path.join(destination, 'complete.txt'), 'utf8'), 'complete contents')
  assert.equal(existsSync(source), false)
  await rm(destination, { recursive: true })

  const fallbackSource = await stage('fallback-staging')
  const fallbackDestination = path.join(directory, 'fallback')
  let checked = false
  await publishExtension(fallbackSource, fallbackDestination, { extensionDirectory: directory, sleep, move: blocked,
    write: async (file, contents) => {
      await writeFile(file, contents)
      if (path.basename(file) === 'package.json') {
        assert.equal(existsSync(path.join(fallbackDestination, installationMarker)), true)
        assert.equal(installedExtensions(directory).length, 0, 'even a complete manifest stays hidden until publication finishes')
        checked = true
      }
    } })
  assert.equal(checked, true)
  assert.equal(installedExtensions(directory).length, 1)
  assert.equal(await readFile(path.join(fallbackDestination, 'complete.txt'), 'utf8'), 'complete contents')
  assert.equal(existsSync(path.join(fallbackDestination, installationMarker)), false)
  await rm(fallbackDestination, { recursive: true })

  const failedSource = await stage('failed-staging')
  const failedDestination = path.join(directory, 'failed')
  await assert.rejects(publishExtension(failedSource, failedDestination, { extensionDirectory: directory, sleep, move: blocked,
    copy: async () => { throw Object.assign(new Error('synthetic copy failure'), { code: 'EIO' }) } }), /copy failure/)
  assert.equal(existsSync(failedDestination), false, 'failed fallback rolls back its own destination')
  assert.equal(installedExtensions(directory).length, 0)

  const existing = path.join(directory, 'existing')
  await mkdir(existing); await writeFile(path.join(existing, 'preserved.txt'), 'keep me')
  await assert.rejects(publishExtension(failedSource, existing, { extensionDirectory: directory, sleep, move: blocked }), error => error.code === 'EEXIST')
  assert.equal(await readFile(path.join(existing, 'preserved.txt'), 'utf8'), 'keep me', 'never removes an existing installation')
  await assert.rejects(publishExtension(failedSource, path.join(root, 'outside'), { extensionDirectory: directory }), /Invalid/)
  console.log('Passed: transient Windows rename retry, persistent lock copy fallback, hidden partial publication, copy rollback, preservation of existing installations and directory bounds. All locks/files were synthetic.')
} finally {
  if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('openzero-publication-test-')) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
