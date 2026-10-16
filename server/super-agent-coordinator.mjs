import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { retryFileOperation } from './publish-extension.mjs'

export const superAgentTools = [{ type: 'namespace', name: 'super_agent', description: 'Open Zero project memory and manager-to-desk communication.', tools: [
  { type: 'function', name: 'dispatch_tasks', description: 'Manager only: send ONE batch to the specific worker desks requested by the user and return their actual replies. Omitted desks receive nothing. Do not ask the user to copy messages.', inputSchema: { type: 'object', properties: { tasks: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { slotId: { type: 'string', pattern: '^worker-[1-9][0-9]*$' }, text: { type: 'string', minLength: 1, maxLength: 50000 } }, required: ['slotId', 'text'], additionalProperties: false } } }, required: ['tasks'], additionalProperties: false } },
  { type: 'function', name: 'recall_memory', description: 'Retrieve approved, current project knowledge from Core-Brain.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 1000 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'propose_memory', description: 'Propose a reusable fact for operator review. This does not approve it. Never store credentials or whole transcripts.', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'team'] }, kind: { type: 'string', enum: ['decision', 'preference', 'architecture', 'lesson'] }, text: { type: 'string', minLength: 1, maxLength: 4000 }, files: { type: 'array', maxItems: 8, items: { type: 'string' } } }, required: ['kind', 'text'], additionalProperties: false } },
] }]

export class SuperAgentCoordinator {
  constructor(directory, deps) {
    this.file = path.join(directory, 'super-agent-tasks.json')
    this.deps = deps; this.grants = new Map(); this.results = new Map(); this.calls = new Map()
    this.reserved = new Set(); this.active = 0; this.waiters = []; this.jobs = []; this.writes = Promise.resolve()
    this.ready = this.restore(); void this.ready.catch(() => {})
  }
  async restore() {
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); this.jobs = saved.jobs.map(job => ['queued', 'dispatching', 'running'].includes(job.status) ? { ...job, status: 'interrupted', error: 'Application restarted. Not resent automatically.' } : job) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  async record(job, patch) {
    const operation = this.writes.catch(() => {}).then(async () => {
      await this.ready
      const jobs = structuredClone(this.jobs)
      const current = jobs.find(item => item.id === job.id)
      if (current) Object.assign(current, patch, { updatedAt: new Date().toISOString() }); else jobs.push({ ...job, ...patch, updatedAt: new Date().toISOString() })
      const retained = jobs.slice(-300)
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, JSON.stringify({ jobs: retained }), 'utf8')
      await retryFileOperation(() => rename(temporary, this.file)); this.jobs = retained
    })
    this.writes = operation; return operation
  }
  arm(threadId, teamId, slotId, messageId) { const grant = { threadId, teamId, slotId, messageId, turnId: null, used: false }; this.grants.set(threadId, grant); return grant }
  bind(grant, turnId) { if (this.grants.get(grant.threadId) === grant) grant.turnId = turnId }
  complete(threadId, turn, provider = 'codex') {
    if (turn?.id) { this.results.set(`${provider}:${threadId}:${turn.id}`, { status: turn.status, error: turn.error?.message }); if (this.results.size > 300) this.results.delete(this.results.keys().next().value) }
    if (provider !== 'codex') return
    const grant = this.grants.get(threadId)
    if (grant && (!grant.turnId || grant.turnId === turn?.id)) this.grants.delete(threadId)
  }
  current(grant) {
    const turn = this.deps.turn(grant.threadId)
    return this.grants.get(grant.threadId) === grant && turn.active && (!grant.turnId || turn.turnId === grant.turnId)
  }
  async tool(params) {
    const grant = this.grants.get(params.threadId)
    if (!grant || !this.current(grant) || params.turnId !== this.deps.turn(params.threadId).turnId || (grant.turnId && params.turnId !== grant.turnId)) throw new Error('This tool needs a current Super Agent request in this conversation.')
    const team = await this.deps.team(grant.teamId)
    const slot = team.slots.find(slot => slot.id === grant.slotId)
    if (team.archived || slot?.thread?.id !== params.threadId) throw new Error('The team or conversation binding changed.')
    await this.deps.enabled()
    if (params.tool === 'recall_memory') return this.deps.recall(team, slot.id, params.arguments?.query)
    if (params.tool === 'propose_memory') return this.deps.memory.propose(slot.thread.directory, params.arguments || {}, { threadId: params.threadId, slotId: slot.id })
    if (params.tool !== 'dispatch_tasks' || grant.slotId !== 'manager') throw new Error('Only the current manager may dispatch worker tasks.')
    const tasks = params.arguments?.tasks
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 32) throw new Error('Supply one batch of 1 to 32 worker tasks.')
    const seen = new Set()
    const targets = tasks.map(task => {
      const target = team.slots.find(slot => slot.id === task.slotId && slot.id !== 'manager')
      if (!target?.thread || seen.has(task.slotId) || typeof task.text !== 'string' || !task.text.trim() || task.text.length > 50000) throw new Error('Use distinct, assigned worker desks with nonempty messages.')
      seen.add(task.slotId); return { slot: target, text: task.text.trim() }
    })
    const key = JSON.stringify([grant.teamId, grant.threadId, grant.messageId, params.callId || params.itemId || tasks])
    if (this.calls.has(key)) return this.calls.get(key)
    if (grant.used) throw new Error('A batch was already dispatched for this user message. Use its returned results; another batch requires a new user request.')
    grant.used = true
    const pending = Promise.all(targets.map(target => this.run(grant, target)))
    this.calls.set(key, pending)
    try { return await pending } finally { if (this.calls.size > 100) this.calls.delete(this.calls.keys().next().value) }
  }
  async run(grant, target) {
    const id = createHash('sha256').update(JSON.stringify([grant.teamId, grant.threadId, grant.messageId, target.slot.id])).digest('hex')
    const job = { id, requestId: grant.messageId, teamId: grant.teamId, managerThreadId: grant.threadId, slotId: target.slot.id, threadId: target.slot.thread.id, provider: target.slot.thread.provider || 'codex', text: target.text, status: 'queued', createdAt: new Date().toISOString() }
    let acquired = false, reserved = false
    try {
      await this.record(job, {})
      await new Promise(resolve => { if (this.active < 2) { this.active++; resolve() } else this.waiters.push(resolve) }); acquired = true
      if (!this.current(grant)) throw new Error('Manager stopped. This queued task was not sent.')
      const team = await this.deps.team(grant.teamId)
      const current = team.slots.find(slot => slot.id === target.slot.id)?.thread
      if (team.archived || current?.id !== job.threadId || (current.provider || 'codex') !== job.provider || team.slots.find(slot => slot.id === 'manager')?.thread?.id !== grant.threadId) throw new Error('Team bindings changed. Task was not sent.')
      const reservation = `${job.provider}:${job.threadId}`
      if (this.reserved.has(reservation) || this.deps.turn(job.threadId, job.provider).active) throw new Error('Worker is already busy. Task was not sent.')
      this.reserved.add(reservation); reserved = true
      await this.deps.enabled()
      await this.record(job, { status: 'dispatching' })
      const response = await this.deps.send(grant, target, job.id)
      const turn = response?.turn
      if (!turn?.id) throw new Error('The provider did not confirm a worker turn. Inspect its conversation before retrying.')
      await this.record(job, { status: 'running', turnId: turn.id })
      const deadline = Date.now() + 10 * 60_000
      while (this.deps.turn(job.threadId, job.provider).active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500))
      if (this.deps.turn(job.threadId, job.provider).active) throw new Error('Worker is still running or waiting for permission after ten minutes. It has not been interrupted; inspect its conversation.')
      const outcome = this.results.get(`${job.provider}:${job.threadId}:${turn.id}`) || turn
      if (outcome.status !== 'completed') throw Object.assign(new Error(outcome.error || `Worker turn ${outcome.status || 'ended without a confirmed completion'}.`), { turnStatus: outcome.status })
      const reply = await this.deps.reply(job.threadId, turn.id, job.provider)
      if (!reply) throw new Error('Worker completed without a readable reply for this turn.')
      await this.record(job, { status: 'completed', turnId: turn.id, reply: reply.slice(0, 12000) })
      return { slotId: job.slotId, threadId: job.threadId, turnId: turn.id, status: 'completed', reply: reply.slice(0, 4000), truncated: reply.length > 4000 }
    } catch (error) {
      const status = error.turnStatus === 'interrupted' ? 'interrupted' : 'failed'
      await this.record(job, { status, error: error.message })
      return { slotId: job.slotId, status, error: error.message }
    } finally {
      if (reserved) this.reserved.delete(`${job.provider}:${job.threadId}`)
      if (acquired) { const next = this.waiters.shift(); if (next) next(); else this.active-- }
    }
  }
}
