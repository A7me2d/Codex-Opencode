import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { SuperAgentStore, superAgentInstructions } from '../server/super-agent.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-super-agent-'))
try {
  const store = new SuperAgentStore(root)
  const team = await store.create('Team A')
  assert.equal(team.slots.length, 1)
  assert.equal(team.slots[0].id, 'manager')
  assert.ok(team.slots.every(slot => slot.thread === null))
  await Promise.all(Array.from({ length: 10 }, () => store.addSlot(team.id)))
  assert.equal((await store.get(team.id)).slots.length, 11)
  assert.equal(new Set((await store.get(team.id)).slots.map(slot => slot.id)).size, 11)
  const original = { id: 'existing-a', directory: 'D:/project-a', workflowRole: 'executor', codexSandbox: 'read-only' }
  const snapshot = structuredClone(original)
  await store.bind(team.id, 'manager', async () => original, 'Lead')
  assert.deepEqual(original, snapshot)
  await assert.rejects(store.bind(team.id, 'worker-1', async () => original), /already assigned/)
  const worker = { id: 'existing-b', directory: 'D:/project-b' }
  await store.bind(team.id, 'worker-1', async () => worker)
  await Promise.all([store.update(team.id, { title: 'Renamed' }), store.create('Team B')])
  const reopened = new SuperAgentStore(root)
  assert.equal((await reopened.list()).length, 2)
  assert.equal((await reopened.get(team.id)).title, 'Renamed')
  assert.equal((await reopened.get(team.id)).slots[0].thread.directory, original.directory)
  let charges = 0, sends = []
  const dependencies = {
    requireEnabled: () => {}, resolveThread: async id => ({ ...original, id }), isBusy: () => false,
    charge: async () => { charges++ }, dispatch: async (id, input) => { sends.push({ id, input }) },
  }
  const input = { threadId: original.id, text: 'Synthetic task only', messageId: 'message-0001' }
  await assert.rejects(store.send(team.id, 'manager', { ...input, threadId: worker.id }, dependencies), /conversation changed/)
  await assert.rejects(store.send(team.id, 'manager', input, { ...dependencies, isBusy: () => true }), /active turn/)
  await assert.rejects(store.send(team.id, 'manager', input, { ...dependencies, requireEnabled: () => { throw new Error('disabled') } }), /disabled/)
  await assert.rejects(store.send(team.id, 'manager', input, { ...dependencies, charge: async () => { throw new Error('no balance') } }), /no balance/)
  assert.equal(charges, 0)
  assert.equal(sends.length, 0)
  await store.send(team.id, 'manager', input, dependencies)
  await store.send(team.id, 'manager', input, dependencies)
  assert.equal(charges, 1)
  assert.deepEqual(sends.map(item => item.id), [original.id])
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const held = new Promise(resolve => { release = resolve })
  const concurrentInput = { ...input, messageId: 'message-0002' }
  const inFlight = store.send(team.id, 'manager', concurrentInput, { ...dependencies, dispatch: async () => { started(); await held } })
  await ready
  await assert.rejects(store.send(team.id, 'manager', concurrentInput, dependencies), /already being sent/)
  await assert.rejects(store.bind(team.id, 'manager', async () => worker), /current send/)
  release(); await inFlight
  assert.equal(charges, 2)
  await store.bind(team.id, 'worker-10', async () => ({ ...worker, id: 'tenth-thread' }))
  await store.send(team.id, 'worker-10', { ...input, threadId: 'tenth-thread' }, dependencies)
  assert.equal(sends.at(-1).id, 'tenth-thread')
  await assert.rejects(store.removeSlot(team.id, 'manager'), /Only worker/)
  await assert.rejects(store.removeSlot(team.id, 'worker-10', () => true), /current turn/)
  await store.removeSlot(team.id, 'worker-10')
  await assert.rejects(store.send(team.id, 'worker-10', { ...input, threadId: 'tenth-thread' }, dependencies), /Assign a conversation/)
  assert.equal(worker.directory, 'D:/project-b')
  await store.update(team.id, { archived: true })
  await assert.rejects(store.send(team.id, 'manager', { ...input, messageId: 'message-0003' }, dependencies), /active team/)
  await assert.rejects(store.addSlot(team.id), /active team/)
  await store.update(team.id, { archived: false })
  assert.equal((await store.get(team.id)).slots.find(slot => slot.id === 'worker-1').thread.id, worker.id)
  const legacy = { ...await store.get(team.id), workerCount: 2 }
  const legacyDirectory = path.join(root, 'legacy')
  await mkdir(legacyDirectory)
  await writeFile(path.join(legacyDirectory, 'super-agent.json'), JSON.stringify({ teams: [legacy] }))
  const restoredLegacy = await new SuperAgentStore(legacyDirectory).get(team.id)
  assert.deepEqual(restoredLegacy.slots, legacy.slots)
  assert.equal('workerCount' in restoredLegacy, false)
  const count = charges
  await assert.rejects(store.send(team.id, 'manager', { ...input, messageId: 'message-0004' }, {
    ...dependencies, resolveThread: async () => { await store.update(team.id, { archived: true }); return original },
  }), /destination changed/)
  assert.equal(charges, count)
  console.log('Passed: manager-only teams, ten dynamic desks, concurrent additions, legacy team preservation, safe removal, exact destination, persistence, provider/busy/license guards, deduplication and archive.')

  // Execute the real turn-start function with a fake transport. No CLI or API calls.
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const calls = [], metadata = { threads: { [original.id]: structuredClone(original) } }
  const bridge = {
    getTurnState: () => ({ active: false }),
    call: async (method, params) => { calls.push({ method, params }); return { turn: { id: 'fake-turn', status: 'completed' } } },
    markTurnRunning: () => {}, clearDelegationGrant: () => {},
    allowDelegation: () => { throw new Error('Super Agent must not delegate') },
  }
  const context = vm.createContext({
    codexBridge: bridge, HttpError: class extends Error {},
    ensureRelayCodexThreadLoaded: async () => {}, requireRelayCodexThread: async () => ({ saved: original }),
    readableAttachments: () => [], updateCodexState: async operation => operation(metadata), Date,
    extractOpenCodeTask: () => { throw new Error('Super Agent must not parse delegation') },
  })
  vm.runInContext(source.slice(source.indexOf('async function sendRelayCodexMessage('), source.indexOf('async function createCodexExecutorThread(')), context)
  await context.sendRelayCodexMessage(original.id, { text: '$opencode synthetic literal text' }, { codexOnly: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.threadId, original.id)
  assert.equal(calls[0].params.input[0].text, '$opencode synthetic literal text')
  assert.equal('sandboxPolicy' in calls[0].params, false)
  assert.equal(bridge.messageStarts.size, 0)
  assert.equal(bridge.manualThreads.size, 0)
  let relayed = 0
  bridge.manualThreads.add(original.id)
  Object.assign(context, { readCodexState: async () => metadata, relayCodexExecutorReplyToPlanner: async () => { relayed++ } })
  vm.runInContext(source.slice(source.indexOf('codexBridge.onTurnCompleted ='), source.indexOf('const server = createServer')), context)
  await bridge.onTurnCompleted(original.id)
  assert.equal(relayed, 0)
  await bridge.onTurnCompleted(original.id)
  assert.equal(relayed, 1)
  assert.match(superAgentInstructions('manager'), /manager coordinating/)
  assert.match(superAgentInstructions('worker'), /worker implementing/)
  console.log('Passed: real turn-start routes only the chosen thread, preserves permissions, ignores delegation tags, and suppresses automatic executor return for manual Super Agent turns.')
} finally {
  const resolved = path.resolve(root)
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()))
  assert.ok(path.basename(resolved).startsWith('openzero-super-agent-'))
  await rm(resolved, { recursive: true, force: true })
}
