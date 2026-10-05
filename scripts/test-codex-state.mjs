import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'

const stateDirectory = await mkdtemp(path.join(tmpdir(), 'relay-state-test-'))
const codexStatePath = path.join(stateDirectory, 'codex.json')
const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const context = vm.createContext({ stateDirectory, codexStatePath, mkdir, readFile, rename, writeFile, randomUUID })
vm.runInContext(source.slice(source.indexOf('function emptyCodexState('), source.indexOf('function shortThreadTitle(')), context)
try {
  await context.updateCodexState((state) => { state.links.original = { opencodeSessionId: 'ses_original' } })
  await Promise.all(Array.from({ length: 40 }, (_, index) => context.updateCodexState(async (state) => {
    await new Promise((resolve) => setTimeout(resolve, index % 3))
    state.threads[`thread-${index}`] = { id: `thread-${index}` }
  })))
  const state = JSON.parse(await readFile(codexStatePath, 'utf8'))
  assert.equal(Object.keys(state.threads).length, 40)
  assert.equal(state.links.original.opencodeSessionId, 'ses_original')
  await assert.rejects(context.updateCodexState(() => { throw new Error('test failure') }))
  await context.updateCodexState((next) => { next.threads.afterFailure = {} })
  await writeFile(codexStatePath, '{invalid', 'utf8')
  await assert.rejects(context.updateCodexState((next) => { next.links = {} }))
  assert.equal(await readFile(codexStatePath, 'utf8'), '{invalid')
  console.log('Passed: concurrent updates retain links and all threads; failed update does not block later writes; corrupt state is never overwritten.')
} finally {
  await rm(stateDirectory, { recursive: true, force: true })
}
