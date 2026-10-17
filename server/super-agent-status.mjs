import { superProvider } from './super-agent.mjs'

/** Job statuses that describe finished work; anything else is live coordination state. */
const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'interrupted', 'tracking_unknown']

/**
 * One truthful desk snapshot per team, from state Open Zero already holds.
 *
 * Evidence is read from the desk adapters, the connector activity flags and the
 * coordinator's job records — never invented from a missing task:
 *  - no bound conversation is `unassigned`, a disabled connector is `paused`
 *    (the provider is never contacted for either);
 *  - a desk the provider confirms active, with a live non-terminal job under its
 *    exact current binding, is `working`;
 *  - a question or permission waiting for the operator, or a task recorded
 *    `waiting_input`, is `waiting`;
 *  - a read that cannot be completed is honestly `unknown`, never a quiet "empty";
 *  - a task under an older binding or a terminal old job is ignored, so stale
 *    work never outweighs current provider state.
 */
export class SuperDeskStatus {
  constructor(deps, { ttl = 3000 } = {}) {
    this.deps = deps
    this.ttl = ttl
    // Concurrent requests share one build; a failed build clears itself so the
    // next poll retries at once instead of serving a cached error.
    this.cache = new Map()
  }

  snapshot(teamId) {
    const cached = this.cache.get(teamId)
    if (cached && Date.now() - cached.at < this.ttl) return cached.promise
    const promise = this.build(teamId).catch(error => {
      if (this.cache.get(teamId)?.promise === promise) this.cache.delete(teamId)
      throw error
    })
    this.cache.set(teamId, { at: Date.now(), promise })
    return promise
  }

  async build(teamId) {
    const team = await this.deps.getTeam(teamId)
    if (!team?.slots?.length) return { teamId, updatedAt: new Date().toISOString(), desks: [] }
    const managerId = team.slots.find(slot => slot.id === 'manager')?.thread?.id
    const jobs = this.deps.jobs().filter(job => job.teamId === teamId && job.managerThreadId === managerId)
    const activity = this.deps.activity?.snapshot?.()?.providers || {}
    const desks = await Promise.all(team.slots.map(slot => this.desk(slot, activity, jobs)))
    return { teamId, updatedAt: new Date().toISOString(), desks }
  }

  async desk(slot, activity, jobs) {
    const head = { id: slot.id, label: slot.label || '' }
    const thread = slot.thread
    if (!thread) return { ...head, provider: null, status: 'unassigned' }
    const provider = superProvider(thread)
    if (activity[provider] !== true) return { ...head, provider, status: 'paused' }
    // The desk's own latest task, but only under exactly the thread it is bound to now.
    const job = jobs.filter(item => item.slotId === slot.id && item.threadId === thread.id).slice(-1)[0]
    const live = job && !TERMINAL_JOB_STATUSES.includes(job.status) ? job : null
    try {
      if (provider === 'opencode') {
        // Reads the provider's global active map once for the whole team (cached 2s inside).
        const state = await this.deps.openCodeStatus(thread.id)
        if (!state || (state.status === 'tracking_unknown' && !state.active && !state.externalActive)) return { ...head, provider, status: 'unknown' }
        const waiting = Boolean(state?.waitingInput) || state?.status === 'waiting_input' || live?.status === 'waiting_input'
        const working = Boolean(state?.active || state?.externalActive) || Boolean(live && ['queued', 'dispatching', 'running'].includes(live.status))
        return { ...head, provider, status: waiting ? 'waiting' : working ? 'working' : 'idle' }
      }
      if (provider === 'cline') {
        const state = await this.deps.clineStatus(thread.id)
        const waiting = Boolean(state?.waitingPermission) || live?.status === 'waiting_input'
        const working = Boolean(state?.active) || Boolean(live && ['queued', 'dispatching', 'running'].includes(live.status))
        return { ...head, provider, status: waiting ? 'waiting' : working ? 'working' : 'idle' }
      }
      const turn = this.deps.codexTurn(thread.id)
      const working = Boolean(turn?.active) || Boolean(live && ['queued', 'dispatching', 'running'].includes(live.status))
      return { ...head, provider, status: working ? 'working' : 'idle' }
    } catch {
      return { ...head, provider, status: 'unknown' }
    }
  }
}
