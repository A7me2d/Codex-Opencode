import { randomUUID } from 'node:crypto'

const busyError = () => Object.assign(new Error('Cline is already working in this conversation.'), { status: 409 })
const terminalStatus = stopReason => stopReason === 'end_turn' ? 'completed' : stopReason === 'cancelled' ? 'interrupted' : 'failed'

/**
 * Super Agent desk adapter for local Cline conversations.
 * It reuses the existing ClineBridge (ACP child + local account) and never launches
 * the CLI, reconnects for reads, auto-approves permissions, or charges the license itself.
 *
 * A turn only succeeds on the bridge terminal record `lastTurn`, which links the user
 * messageId, the assistant responseId and the ACP stopReason. An old reply or a dropped
 * `active` flag never proves success, so this adapter consumes the bridge terminal record
 * instead of inferring completion from the transcript.
 */
export class SuperAgentCline {
  constructor(bridge, complete, { timeout = 600_000 } = {}) {
    this.bridge = bridge; this.complete = complete; this.timeout = timeout
    this.turns = new Map(); this.replies = new Map()
  }
  turn(id) { return this.turns.get(id) || { active: false } }
  async status(id) {
    const session = await this.bridge.get(id), turn = this.turn(id)
    return { active: Boolean(session.active || session.loading || session.preparing) || turn.active, waitingPermission: Boolean(session.permissions?.length), error: session.error || turn.error || null }
  }
  async read(id) {
    const snapshot = this.bridge.snapshot(await this.bridge.get(id)), turn = this.turn(id)
    // The desk turn is part of the readable state: a running or failed turn must stay
    // visible even while the session itself looks idle. Secrets and handles stay stripped.
    return { ...snapshot, active: Boolean(snapshot.active) || turn.active, error: turn.error || snapshot.error || null }
  }
  requireSendable(session) {
    if (session.archived) throw Object.assign(new Error('Restore the Cline conversation before sending a message.'), { status: 409 })
    if (session.active || session.loading || session.preparing || this.turn(session.id).active) throw busyError()
    if (session.permissions?.length) throw Object.assign(new Error('Answer the pending Cline permission before sending a new task.'), { status: 409 })
  }
  async prepare(id) {
    const session = await this.bridge.get(id)
    this.requireSendable(session)
    await this.bridge.connect(session)
    // Re-verify after connect, before the server charges this request.
    this.requireSendable(session)
    return this.bridge.snapshot(session)
  }
  async send(id, text, messageId, displayText = text) {
    if (this.turn(id).active) throw busyError()
    const session = await this.bridge.get(id)
    this.requireSendable(session)
    // A repeated messageId must never resend or resurrect an old reply.
    if (session.messages.some(message => message.id === messageId)) throw Object.assign(new Error('This Cline task was already sent. Inspect its conversation before retrying.'), { status: 409 })
    const previous = session.responseId
    const turn = { id: randomUUID(), turnId: null, active: true, status: 'running', error: null }
    turn.turnId = turn.id; this.turns.set(id, turn)
    try {
      // Charge is an async noop: the manager bills once in SuperAgentStore.
      const snapshot = await this.bridge.prompt(id, text, messageId, async () => {}, displayText)
      const responseId = snapshot?.responseId
      if (!responseId || responseId === previous || !snapshot.messages?.some(message => message.id === messageId)) throw new Error('Cline did not confirm the queued task. Inspect its conversation before retrying.')
      void this.monitor(id, turn, messageId, responseId).catch(error => this.finish(id, turn, 'failed', error.message))
      return { turn: { id: turn.id, status: 'running' } }
    } catch (error) { this.finish(id, turn, 'failed', error.message); throw error }
  }
  async monitor(id, turn, messageId, responseId) {
    const session = await this.bridge.get(id)
    // Wait for the terminal record, not for silence: the run promise settles only
    // after the bridge cleanup and local save, so the completion lands after saving.
    if (session.run) {
      let timer
      const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeout); timer.unref?.() })
      try { await Promise.race([Promise.resolve(session.run).catch(() => {}), expired]) }
      catch { this.finish(id, turn, 'failed', 'Cline is still running after ten minutes. It was not interrupted; inspect its conversation.'); return }
      finally { clearTimeout(timer) }
    }
    const last = session.lastTurn
    if (!last || last.messageId !== messageId || last.responseId !== responseId) {
      // No terminal record for this task (save failure or an unpatched bridge):
      // surface the real bridge error instead of guessing.
      if (!turn.stopping && !session.active && session.error) { this.finish(id, turn, 'failed', session.error); return }
      this.finish(id, turn, turn.stopping ? 'interrupted' : 'failed', turn.stopping ? 'Cline was stopped by the operator.' : 'Cline did not confirm that this task ended. Inspect its conversation before retrying.')
      return
    }
    if (last.error) { this.finish(id, turn, turn.stopping ? 'interrupted' : 'failed', turn.stopping ? 'Cline was stopped by the operator.' : last.error); return }
    const status = terminalStatus(last.stopReason)
    if (status === 'interrupted') { this.finish(id, turn, 'interrupted', turn.stopping ? 'Cline was stopped by the operator.' : 'Cline ended this task early.'); return }
    if (status === 'failed') {
      this.finish(id, turn, 'failed', last.stopReason === 'refusal' ? 'Cline refused this task. Inspect its conversation before retrying.' : `Cline ended the task with stop reason ${JSON.stringify(last.stopReason)}. Inspect its conversation before retrying.`)
      return
    }
    const text = (session.messages.find(message => message.id === responseId)?.text || '').trim()
    this.replies.set(`${id}:${turn.id}`, text)
    if (this.replies.size > 300) this.replies.delete(this.replies.keys().next().value)
    this.finish(id, turn, 'completed')
  }
  finish(id, turn, status, error) {
    if (this.turns.get(id) !== turn || !turn.active) return
    Object.assign(turn, { active: false, status, error: error || null })
    this.complete(id, { id: turn.id, status, ...(error ? { error: { message: error } } : {}) })
  }
  async stop(id) {
    const turn = this.turns.get(id)
    if (turn?.active) turn.stopping = true
    await this.bridge.cancel(id)
  }
  reply(id, turnId) { return this.replies.get(`${id}:${turnId}`) || '' }
}
