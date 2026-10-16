import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrainMemory } from '../server/brain-memory.mjs'
import { SuperAgentCoordinator } from '../server/super-agent-coordinator.mjs'
import { CoreBrainMcp } from '../server/core-brain-mcp.mjs'
import { createServer } from 'node:http'
import vm from 'node:vm'
import { superAgentInstructions, superProvider } from '../server/super-agent.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-core-brain-'))
try {
  const repository = path.join(root, 'Core-Brain'), project = path.join(root, 'project'), other = path.join(root, 'other')
  await Promise.all([repository, project, other].map(directory => mkdir(directory)))
  await writeFile(path.join(project, 'app.ts'), 'export const version = 1')
  const memory = new BrainMemory(path.join(root, 'state'))
  assert.deepEqual(await memory.retrieve(project), [])
  await memory.configure(repository)
  const source = { threadId: 'manager', slotId: 'manager' }
  const entry = await memory.propose(project, { kind: 'architecture', text: 'Version one of the app', files: ['app.ts'] }, source)
  assert.deepEqual(await memory.retrieve(project), [], 'unreviewed agent claims are excluded')
  await memory.review(project, entry.id, 'approved')
  assert.equal((await memory.retrieve(project))[0].id, entry.id)
  assert.equal((await new BrainMemory(path.join(root, 'state')).retrieve(project))[0].id, entry.id, 'knowledge survives a fresh instance')
  assert.deepEqual(await memory.retrieve(other), [], 'project facts do not leak')
  await writeFile(path.join(project, 'app.ts'), 'export const version = 2')
  assert.deepEqual(await memory.retrieve(project), [], 'changed evidence invalidates automatic recall')
  const shared = await memory.propose(project, { kind: 'preference', text: 'Use English UI labels', scope: 'team' }, source)
  await memory.review(project, shared.id, 'approved')
  assert.equal((await memory.retrieve(project, '', { teamOnly: true })).length, 1)
  await assert.rejects(memory.propose(other, { kind: 'decision', text: 'Wrong scope', scope: 'team' }, { slotId: 'worker-1' }), /Only the manager/)
  await memory.review(project, shared.id, 'rejected')
  assert.deepEqual(await memory.retrieve(project), [])
  await assert.rejects(memory.propose(project, { kind: 'lesson', text: 'Invalid evidence', files: ['../outside'] }, source), /relative/)
  await assert.rejects(memory.propose(project, { kind: 'lesson', text: 'Invalid data', files: Array(9).fill('app.ts') }, source), /eight/)
  await Promise.all(Array.from({ length: 6 }, (_, index) => memory.propose(project, { kind: 'decision', text: `Concurrent decision ${index}` }, source)))
  assert.equal((await memory.list(project)).length, 8)
  console.log('Passed: separate JSONL knowledge, restart recall, human review, project isolation, shared scope, stale evidence rejection, path limits and concurrent writes.')

  let coordinator, active = 0, peak = 0, sends = []
  const managerTurn = { active: true, turnId: 'manager-turn' }
  const team = { id: 'team-a', archived: false, slots: [{ id: 'manager', thread: { id: 'manager', directory: project } }, ...Array.from({ length: 4 }, (_, index) => ({ id: `worker-${index + 1}`, thread: { id: `thread-${index + 1}`, directory: other } }))] }
  const deps = {
    team: async () => structuredClone(team), enabled: async () => {}, memory,
    turn: id => id === 'manager' ? managerTurn : { active: false },
    recall: (team, slot, query) => memory.retrieve(project, query),
    send: async (grant, target) => { sends.push(target.slot.id); peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 15)); active--; return { turn: { id: `turn-${target.slot.id}`, status: 'completed' } } },
    reply: async (thread, turnId) => `${turnId}: ${ { 'thread-1': 14, 'thread-2': 42, 'thread-3': 312 }[thread] }`,
  }
  coordinator = new SuperAgentCoordinator(path.join(root, 'jobs'), deps)
  const grant = coordinator.arm('manager', team.id, 'manager', 'request-00001')
  coordinator.bind(grant, 'manager-turn')
  const params = { namespace: 'super_agent', tool: 'dispatch_tasks', threadId: 'manager', turnId: 'manager-turn', callId: 'call-a', arguments: { tasks: [{ slotId: 'worker-1', text: '5+9' }, { slotId: 'worker-2', text: '6*7' }, { slotId: 'worker-3', text: '156+156' }] } }
  const results = await coordinator.tool(params)
  assert.deepEqual(sends, ['worker-1', 'worker-2', 'worker-3'])
  assert.ok(!sends.includes('worker-4'), 'the unselected desk gets nothing')
  assert.equal(peak, 2)
  assert.deepEqual(results.map(item => item.reply), ['turn-worker-1: 14', 'turn-worker-2: 42', 'turn-worker-3: 312'])
  await coordinator.tool(params)
  assert.equal(sends.length, 3, 'replayed tool call does not resend')
  await assert.rejects(coordinator.tool({ ...params, callId: 'different-call' }), /already dispatched/)
  await assert.rejects(coordinator.tool({ ...params, turnId: 'wrong-turn' }), /current Super Agent/)
  const fresh = coordinator.arm('manager', team.id, 'manager', 'request-00002'); coordinator.bind(fresh, 'manager-turn')
  await assert.rejects(coordinator.tool({ ...params, callId: 'invalid', arguments: { tasks: [{ slotId: 'worker-1', text: 'hello' }, { slotId: 'worker-99', text: 'wrong' }] } }), /distinct/)
  assert.equal(sends.length, 3, 'invalid batch rejected before any sends')
  team.archived = true
  await assert.rejects(coordinator.tool(params), /binding changed/)
  team.archived = false
  const workerGrant = coordinator.arm('thread-1', team.id, 'worker-1', 'worker-request')
  const previousTurn = deps.turn
  deps.turn = id => id === 'thread-1' ? { active: true, turnId: 'worker-turn' } : previousTurn(id)
  coordinator.bind(workerGrant, 'worker-turn')
  await assert.rejects(coordinator.tool({ ...params, threadId: 'thread-1', turnId: 'worker-turn' }), /Only the current manager/)
  const saved = JSON.parse(await readFile(path.join(root, 'jobs', 'super-agent-tasks.json'), 'utf8'))
  assert.ok(saved.jobs.every(job => job.status === 'completed'))
  saved.jobs[0].status = 'running'
  await writeFile(path.join(root, 'jobs', 'super-agent-tasks.json'), JSON.stringify(saved))
  const restored = new SuperAgentCoordinator(path.join(root, 'jobs'), deps)
  await restored.ready
  assert.equal(restored.jobs[0].status, 'interrupted')
  assert.equal(sends.length, 3, 'restart never automatically replays an uncertain dispatch')
  console.log('Passed: real coordinator sends only to desks 1/2/3, returns scoped results, leaves desk 4 untouched, caps concurrency at two, rejects wrong turns/workers/archive/invalid batches, persists jobs and avoids replay after restart. All agents, replies and transports were synthetic.')

  let mcpInvocation
  const mcp = new CoreBrainMcp({ tool: async params => { mcpInvocation = params; return { confirmed: true } } }, () => ({ active: true, turnId: 'native-turn' }))
  const managerConfig = mcp.config('manager', 'manager', 'http://127.0.0.1:1')
  const workerConfig = mcp.config('thread-1', 'worker', 'http://127.0.0.1:1')
  const server = createServer(async (request, response) => {
    await mcp.handle(request, response, async stream => { let raw = ''; for await (const chunk of stream) raw += chunk; return JSON.parse(raw) }, (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`
    const call = (method, token, params = {}) => fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    assert.equal((await call('tools/list', 'incorrect')).status, 401)
    const initialized = await (await call('initialize', managerConfig.token, { protocolVersion: '2025-06-18' })).json()
    assert.equal(initialized.result.protocolVersion, '2025-06-18')
    const managerTools = await (await call('tools/list', managerConfig.token)).json()
    assert.ok(managerTools.result.tools.some(tool => tool.name === 'dispatch_tasks'))
    const workerTools = await (await call('tools/list', workerConfig.token)).json()
    assert.ok(!workerTools.result.tools.some(tool => tool.name === 'dispatch_tasks'))
    const called = await (await call('tools/call', managerConfig.token, { name: 'recall_memory', arguments: { query: 'test' } })).json()
    assert.equal(called.result.isError, false)
    assert.equal(mcpInvocation.threadId, 'manager'); assert.equal(mcpInvocation.turnId, 'native-turn')
    mcp.config('thread-1', 'manager', endpoint)
    assert.equal((await call('tools/list', workerConfig.token)).status, 401, 'old role credential is revoked')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }

  const sourceCode = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const instructions = superAgentInstructions('manager')
  let resumes = 0
  const fixture = { saved: { id: 'new-thread', directory: project, superAgentRole: 'manager', superAgentProtocol: 2 } }
  const context = vm.createContext({
    requireRelayCodexThread: async () => fixture, threadInstructionSelection: () => ({ text: instructions }), superAgentInstructions, superProvider,
    superAgentKnowledge: async () => [], codexBridge: { activeThreads: new Set(['new-thread']), threadInstructions: new Map([['new-thread', instructions]]), resumeThread: async (id, params) => { resumes++; assert.ok(params.config['mcp_servers.openzero_core_brain']); assert.equal('dynamicTools' in params, false); assert.equal('sandbox' in params, false); return {} } },
    coreBrainMcp: { config: () => managerConfig }, server: { address: () => ({ port: 1 }) }, watchRoot: project,
  })
  const start = sourceCode.indexOf('async function ensureRelayCodexThreadLoaded(')
  const end = sourceCode.indexOf('\nasync function ', start + 1)
  vm.runInContext(sourceCode.slice(start, end), context)
  const superContext = { team, slotId: 'manager' }
  assert.ok((await context.ensureRelayCodexThreadLoaded('new-thread', superContext)).initialContext)
  assert.equal(resumes, 0, 'fresh empty thread never cold-resumes a nonexistent rollout')
  fixture.saved.lastMessageAt = 1
  await context.ensureRelayCodexThreadLoaded('new-thread', superContext)
  assert.equal(resumes, 1)
  console.log('Passed: real local MCP HTTP handshake, credential rejection, manager-only tool visibility, correct caller identity, revoked role credentials, fresh-thread protection, and existing-session resume with MCP config while preserving permissions. No AI calls were made.')
} finally {
  const resolved = path.resolve(root)
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()))
  assert.ok(path.basename(resolved).startsWith('openzero-core-brain-'))
  await rm(resolved, { recursive: true, force: true })
}
