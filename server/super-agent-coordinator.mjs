import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { retryFileOperation } from './publish-extension.mjs'
import { superExecution } from './super-agent.mjs'

const jobIdOf = (grant, slotId) => createHash('sha256').update(JSON.stringify([grant.teamId, grant.threadId, grant.messageId, slotId])).digest('hex')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export const superAgentTools = [{ type: 'namespace', name: 'super_agent', description: 'Open Zero project memory and manager-to-desk communication.', tools: [
  { type: 'function', name: 'dispatch_tasks', description: 'Manager only: send ONE batch to the specific worker desks requested by the user. In wait dispatch mode it returns their actual replies; in background dispatch mode it returns only an acknowledgement (a batchId and the queued jobs, not replies) and the saved results are read later with get_dispatch_reports. A task still running when the tool-call window closes is returned as running, waiting_input or queued — never as a failure, never resent — and its final result is saved for get_dispatch_reports. Omitted desks receive nothing. Do not ask the user to copy messages.', inputSchema: { type: 'object', properties: { tasks: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { slotId: { type: 'string', pattern: '^worker-[1-9][0-9]*$' }, text: { type: 'string', minLength: 1, maxLength: 50000 } }, required: ['slotId', 'text'], additionalProperties: false } } }, required: ['tasks'], additionalProperties: false } },
  { type: 'function', name: 'get_dispatch_reports', description: 'Manager only: read the saved results of a dispatched batch for this team, for example after a background dispatch acknowledged it. Reads storage only and never sends a new request to any desk.', inputSchema: { type: 'object', properties: { batchId: { type: 'string', maxLength: 200 } }, additionalProperties: false } },
  { type: 'function', name: 'recall_memory', description: 'Retrieve approved, current project knowledge from Core-Brain.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 1000 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'propose_memory', description: 'Propose a reusable fact for operator review. This does not approve it. Never store credentials or whole transcripts.', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'team'] }, kind: { type: 'string', enum: ['decision', 'preference', 'architecture', 'lesson'] }, text: { type: 'string', minLength: 1, maxLength: 4000 }, files: { type: 'array', maxItems: 8, items: { type: 'string' } } }, required: ['kind', 'text'], additionalProperties: false } },
] }]

export class SuperAgentCoordinator {
  constructor(directory, deps, { responseDeadlineMs = 9 * 60_000, pollIntervalMs = 500 } = {}) {
    // `responseDeadlineMs` is the tool/HTTP call window only, kept below the MCP client's 660s
    // tool timeout so the call always returns. It is never the age limit of a task: a worker
    // still running when it closes is reported as running/waiting_input (not a failure) and is
    // followed in the background until it really settles. `pollIntervalMs` paces that follow.
    this.responseDeadlineMs = responseDeadlineMs; this.pollIntervalMs = pollIntervalMs
    this.file = path.join(directory, 'super-agent-tasks.json')
    this.deps = deps; this.grants = new Map(); this.results = new Map(); this.calls = new Map()
    this.reserved = new Set(); this.active = 0; this.waiters = []; this.jobs = []; this.writes = Promise.resolve()
    // Global ceiling across every batch, and a per-batch running count so a batch pinned with
    // `maxParallel` never exceeds its own limit while other batches keep their own.
    this.globalLimit = 8; this.batchRunning = new Map()
    this.ready = this.restore(); void this.ready.catch(() => {})
  }
  async restore() {
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); this.jobs = saved.jobs.map(job => ['queued', 'dispatching', 'running', 'waiting_input'].includes(job.status) ? { ...job, status: 'interrupted', error: 'Application restarted. Not resent automatically.' } : job) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  canAdmit(batchId, limit) { return this.active < this.globalLimit && (this.batchRunning.get(batchId) || 0) < limit }
  admit(batchId) { this.active += 1; this.batchRunning.set(batchId, (this.batchRunning.get(batchId) || 0) + 1) }
  acquire(batchId, limit) {
    return new Promise(resolve => {
      if (this.canAdmit(batchId, limit)) { this.admit(batchId); resolve(); return }
      this.waiters.push({ batchId, limit, resolve })
    })
  }
  release(batchId) {
    if (this.active > 0) this.active -= 1
    const running = (this.batchRunning.get(batchId) || 0) - 1
    if (running > 0) this.batchRunning.set(batchId, running); else this.batchRunning.delete(batchId)
    this.pump()
  }
  pump() {
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index]
      if (this.canAdmit(waiter.batchId, waiter.limit)) { this.waiters.splice(index, 1); this.admit(waiter.batchId); waiter.resolve() }
      else index += 1
    }
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
  arm(threadId, teamId, slotId, messageId) { const grant = { threadId, teamId, slotId, messageId, turnId: null, used: false, accepted: null }; this.grants.set(threadId, grant); return grant }
  bind(grant, turnId) { if (this.grants.get(grant.threadId) === grant) grant.turnId = turnId }
  complete(threadId, turn, provider = 'codex') {
    if (turn?.id) { this.results.set(`${provider}:${threadId}:${turn.id}`, { status: turn.status, error: turn.error?.message }); if (this.results.size > 300) this.results.delete(this.results.keys().next().value) }
    if (provider !== 'codex') return
    const grant = this.grants.get(threadId)
    // Settle the accepted batch only from the exact manager turn that accepted it, so a late
    // or unrelated completion callback can never authorize (or re-authorize) queued work.
    if (grant?.accepted && turn?.id && grant.accepted.turnId === turn.id) grant.accepted.outcome = { turnId: turn.id, status: turn.status ?? null }
    if (grant && (!grant.turnId || grant.turnId === turn?.id)) this.grants.delete(threadId)
  }
  current(grant) {
    const turn = this.deps.turn(grant.threadId)
    return this.grants.get(grant.threadId) === grant && turn.active && (!grant.turnId || turn.turnId === grant.turnId)
  }
  // A queued task normally needs the manager turn to still be current. The one narrow exception:
  // the batch was accepted by `tool` (every target validated) under this exact manager turn, and
  // that turn has since ended as a confirmed natural completion. An explicit stop, a failure, an
  // unconfirmed end or a new/replaced turn all keep the queued task unsent.
  mayRun(grant) {
    if (this.current(grant)) return true
    const batch = grant?.accepted
    if (!batch || batch.threadId !== grant.threadId || batch.messageId !== grant.messageId || batch.provider !== 'codex') return false
    if (batch.outcome?.status !== 'completed' || batch.outcome.turnId !== batch.turnId) return false
    const turn = this.deps.turn(batch.threadId)
    return !turn.active && (!turn.turnId || turn.turnId === batch.turnId)
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
    if (params.tool === 'get_dispatch_reports') {
      if (grant.slotId !== 'manager') throw new Error('Only the current manager may read dispatch reports.')
      return this.report(grant.teamId, params.arguments?.batchId)
    }
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
    // The batch's execution policy is read once, here, at the moment of acceptance, and pinned
    // to this batch. Later team edits never widen or shrink a batch that is already running.
    const execution = superExecution(team)
    const limit = Math.max(1, Math.min(this.globalLimit, execution.maxParallel))
    const batchId = createHash('sha256').update(JSON.stringify([grant.teamId, grant.threadId, grant.messageId])).digest('hex')
    grant.batchId = batchId; grant.limit = limit
    // The batch is accepted while this manager turn is provably current and every target of the
    // batch was validated above. Record that proof so queued tasks can be released by the natural
    // completion of this exact turn (see mayRun) without unlocking new MCP commands.
    if (params.turnId) grant.accepted = { threadId: grant.threadId, teamId: grant.teamId, messageId: grant.messageId, turnId: params.turnId, provider: 'codex', outcome: null }
    const pending = Promise.all(targets.map(target => this.run(grant, target)))
    // Background mode acknowledges the accepted batch and returns immediately; the jobs keep
    // running on the server, their finished reports are persisted, and the acknowledgement is
    // never presented as a worker reply.
    if (execution.dispatchMode === 'background') {
      pending.catch(() => {})
      const receipt = {
        status: 'accepted', dispatchMode: 'background', batchId, teamId: grant.teamId,
        jobs: targets.map(target => ({ slotId: target.slot.id, threadId: target.slot.thread.id, jobId: jobIdOf(grant, target.slot.id), status: 'queued' })),
        note: 'Acknowledged, not worker replies. The batch continues on the server; read the saved results with get_dispatch_reports when the user asks.',
      }
      this.calls.set(key, receipt)
      if (this.calls.size > 100) this.calls.delete(this.calls.keys().next().value)
      return receipt
    }
    this.calls.set(key, pending)
    try { return await pending } finally { if (this.calls.size > 100) this.calls.delete(this.calls.keys().next().value) }
  }
  /** Saved reports for one team (and optionally one batch). Storage only; no desk is contacted. */
  report(teamId, batchId) {
    if (batchId !== undefined && (typeof batchId !== 'string' || batchId.length > 200)) throw new Error('Invalid batch reference.')
    const scoped = this.jobs.filter(job => job.teamId === teamId && job.batchId)
    const target = batchId || (scoped.length ? scoped[scoped.length - 1].batchId : null)
    if (!target) return { status: 'empty', teamId, batchId: null, jobs: [] }
    const jobs = scoped.filter(job => job.batchId === target)
    if (!jobs.length) return { status: 'empty', teamId, batchId: target, jobs: [] }
    const running = jobs.some(job => ['queued', 'dispatching', 'running', 'waiting_input'].includes(job.status))
    const status = running ? 'running' : jobs.every(job => job.status === 'completed') ? 'completed' : 'ended'
    return { status, teamId, batchId: target, jobs: jobs.map(job => ({ slotId: job.slotId, provider: job.provider, status: job.status, reply: job.reply ?? null, error: job.error ?? null })) }
  }
  async run(grant, target) {
    const responseDeadlineAt = Date.now() + this.responseDeadlineMs
    const id = jobIdOf(grant, target.slot.id)
    const batchId = grant.batchId || grant.messageId
    const limit = Math.max(1, Math.min(this.globalLimit, grant.limit ?? 2))
    const job = { id, requestId: grant.messageId, batchId, teamId: grant.teamId, managerThreadId: grant.threadId, slotId: target.slot.id, threadId: target.slot.thread.id, provider: target.slot.thread.provider || 'codex', text: target.text, status: 'queued', createdAt: new Date().toISOString() }
    await this.record(job, {})
    const slot = this.acquire(batchId, limit)
    // The tool/HTTP call window is separate from the age of a task. A task still queued behind
    // the batch concurrency when that window closes is not failed and not resent: it keeps its
    // place in the background and is dispatched as soon as a slot frees (the batch is already
    // accepted, so a naturally completed manager turn still releases it).
    if (!await this.withinWindow(slot, responseDeadlineAt)) {
      slot.then(() => this.dispatch(grant, target, job, responseDeadlineAt)).catch(() => {})
      return { slotId: job.slotId, threadId: job.threadId, status: 'queued', note: 'Still queued behind this batch concurrency. It will be sent as soon as a slot frees; the final result is saved and can be read with get_dispatch_reports. Not a failure and not resent.' }
    }
    return await this.dispatch(grant, target, job, responseDeadlineAt)
  }
  /** True when `promise` settles inside the tool-call window, false when the window closes first. */
  withinWindow(promise, deadlineAt = Date.now() + this.responseDeadlineMs) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), Math.max(0, deadlineAt - Date.now()))
      promise.then(() => { clearTimeout(timer); resolve(true) }, () => { clearTimeout(timer); resolve(true) })
    })
  }
  /** Everything after a batch slot is held: checks, the send, then the background follow. */
  async dispatch(grant, target, job, responseDeadlineAt) {
    const batchId = job.batchId
    let reserved = false, handedOff = false
    try {
      if (!this.mayRun(grant)) throw new Error('Manager stopped. This queued task was not sent.')
      const team = await this.deps.team(grant.teamId)
      const current = team.slots.find(slot => slot.id === target.slot.id)?.thread
      if (team.archived || current?.id !== job.threadId || (current.provider || 'codex') !== job.provider || team.slots.find(slot => slot.id === 'manager')?.thread?.id !== grant.threadId) throw new Error('Team bindings changed. Task was not sent.')
      const reservation = `${job.provider}:${job.threadId}`
      if (this.reserved.has(reservation) || this.deps.turn(job.threadId, job.provider).active) throw new Error('Worker is already busy. Task was not sent.')
      this.reserved.add(reservation); reserved = true
      await this.deps.enabled()
      // Re-check the batch at the send boundary: an operator stop that lands during the awaits
      // above must not send this task after the stop was recorded.
      if (!this.mayRun(grant)) throw new Error('Manager stopped. This queued task was not sent.')
      await this.record(job, { status: 'dispatching' })
      // Final batch check: an operator stop that lands during the persisted dispatching write
      // must abort here. This check is synchronous and directly precedes the send call, so no
      // await sits between the decision to send and the send itself.
      if (!this.mayRun(grant)) throw new Error('Manager stopped. This queued task was not sent.')
      const response = await this.deps.send(grant, target, job.id)
      const turn = response?.turn
      if (!turn?.id) throw new Error('The provider did not confirm a worker turn. Inspect its conversation before retrying.')
      await this.record(job, { status: 'running', turnId: turn.id })
      // The follow outlives this call and owns the reservation and the batch slot until the
      // worker turn really settles, so a still-active session can never be entered by a second
      // send while this job is being followed. A background promise needs no manager turn.
      handedOff = true
      const follow = this.follow(job, turn, batchId, reservation)
      follow.catch(() => {})
      if (await this.withinWindow(follow, responseDeadlineAt)) return await follow
      // The worker is genuinely still busy at the end of the tool-call window: report that
      // state honestly instead of failing the task by age. Nothing is interrupted or resent.
      const state = this.deps.turn(job.threadId, job.provider)
      const status = state.status === 'waiting_input' || state.waitingInput ? 'waiting_input' : 'running'
      // follow() alone owns the persisted state after handoff. A late interim write here
      // could otherwise overwrite a completion recorded at the response deadline.
      return { slotId: job.slotId, threadId: job.threadId, turnId: turn.id, status, note: 'The desk is still working. This is not a failure and the task was not resent; the final result is saved and can be read with get_dispatch_reports.' }
    } catch (error) {
      const status = error.turnStatus === 'interrupted' ? 'interrupted' : error.turnStatus === 'tracking_unknown' ? 'tracking_unknown' : 'failed'
      await this.record(job, { status, error: error.message })
      return { slotId: job.slotId, status, error: error.message }
    } finally {
      if (!handedOff) {
        if (reserved) this.reserved.delete(`${job.provider}:${job.threadId}`)
        this.release(batchId)
      }
    }
  }
  /**
   * Background follow of one dispatched task. It records `waiting_input`/`running` transitions,
   * maps the provider's final outcome into the job record and owns the reservation and the batch
   * slot until the turn settles. It never interrupts the desk and never resends.
   */
  async follow(job, turn, batchId, reservation) {
    let waitingRecorded = false
    try {
      while (this.deps.turn(job.threadId, job.provider).active) {
        const state = this.deps.turn(job.threadId, job.provider)
        // A question waiting for an answer is not work and not a failure: it is recorded as
        // waiting_input with no deadline of its own, and the job returns to running once the
        // operator answers. The task is never resent for it.
        if (state.status === 'waiting_input' || state.waitingInput) {
          if (!waitingRecorded) { await this.record(job, { status: 'waiting_input' }); waitingRecorded = true }
        } else if (waitingRecorded) { await this.record(job, { status: 'running', turnId: turn.id }); waitingRecorded = false }
        await delay(this.pollIntervalMs)
      }
      const outcome = this.results.get(`${job.provider}:${job.threadId}:${turn.id}`) || turn
      if (outcome.status === 'completed') {
        const reply = await this.deps.reply(job.threadId, turn.id, job.provider)
        // A completed turn whose reply cannot be read is a follow loss, not an execution
        // failure: the session is left alone and the job is not marked failed.
        if (!reply) return await this.finishJob(job, 'tracking_unknown', 'The worker turn completed but no readable reply could be read for it. The session was not interrupted; inspect its conversation.')
        await this.record(job, { status: 'completed', turnId: turn.id, reply: reply.slice(0, 12000) })
        return { slotId: job.slotId, threadId: job.threadId, turnId: turn.id, status: 'completed', reply: reply.slice(0, 4000), truncated: reply.length > 4000 }
      }
      // An interrupted turn is an honest operator stop; a lost follow is tracking_unknown, never
      // a fabricated execution failure. Any other provider outcome keeps its own status/error.
      const status = outcome.status === 'interrupted' ? 'interrupted' : outcome.status === 'tracking_unknown' ? 'tracking_unknown' : 'failed'
      return await this.finishJob(job, status, outcome.error || `Worker turn ${outcome.status || 'ended without a confirmed completion'}.`)
    } catch (error) {
      return await this.finishJob(job, 'tracking_unknown', `Open Zero could not follow the worker result: ${error.message}`)
    } finally {
      if (reservation) this.reserved.delete(reservation)
      this.release(batchId)
    }
  }
  async finishJob(job, status, error) {
    await this.record(job, { status, error })
    return { slotId: job.slotId, status, error }
  }
}
