import { randomUUID } from 'node:crypto'

const idOf = message => message?.id ?? message?.info?.id
const roleOf = message => message?.type ?? message?.info?.role
const textOf = message => {
  const content = message?.text ?? message?.content ?? message?.parts ?? message?.message
  return typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : ''
}

/** Separate sessions, durable queue receipts, and only replies created by this send. */
export class SuperAgentOpenCode {
  constructor(api, complete, { interval = 2500, timeout = 600_000 } = {}) {
    this.api = api; this.complete = complete; this.interval = interval; this.timeout = timeout
    this.turns = new Map(); this.replies = new Map(); this.cache = new Map()
  }
  turn(id) { return this.turns.get(id) || { active: false } }
  async status(id, fresh = false) {
    if (fresh || !this.activeCache || Date.now() - this.activeCache.at > 2000) {
      const promise = this.api('GET', '/api/session/active')
      this.activeCache = { at: Date.now(), promise }
      void promise.catch(() => { this.activeCache = null })
    }
    const response = await this.activeCache.promise
    return { active: Boolean(response?.data?.[id]) || this.turn(id).active, externalActive: Boolean(response?.data?.[id]), error: this.turn(id).error || null }
  }
  async read(id, fresh = false) {
    const cached = this.cache.get(id)
    if (!fresh && cached && Date.now() - cached.at < 2000) return cached.promise
    const promise = Promise.all([
      this.api('GET', `/api/session/${id}/message`), this.api('GET', `/api/session/${id}/inbox`),
      this.status(id, fresh), this.api('GET', `/api/session/${id}/form`),
    ]).then(([messages, inbox, active, forms]) => ({ messages: messages?.data || [], inbox: inbox?.data || [], forms: forms?.data || [], active: active.externalActive }))
    this.cache.set(id, { at: Date.now(), promise })
    try { return await promise } catch (error) { this.cache.delete(id); throw error }
  }
  async prepare(id) {
    if (this.turn(id).active) throw new Error('OpenCode desk is already busy.')
    const snapshot = await this.read(id, true)
    if (snapshot.active || snapshot.inbox.length || snapshot.forms.length) throw new Error('Finish the current OpenCode task or question before sending.')
    return snapshot
  }
  async send(id, text, baseline) {
    if (this.turn(id).active) throw new Error('OpenCode desk is already busy.')
    const turn = { id: randomUUID(), turnId: null, active: true, status: 'running' }
    turn.turnId = turn.id; this.turns.set(id, turn)
    try {
      const response = await this.api('POST', `/api/session/${id}/prompt`, { text, delivery: 'queue' })
      const receipt = response?.data
      if (!receipt?.id || receipt.sessionID !== id || (receipt.delivery ?? response.delivery) !== 'queue') throw new Error('OpenCode did not confirm the queued task. Inspect its conversation before retrying.')
      this.cache.delete(id); this.activeCache = null
      void this.monitor(id, turn, baseline, text).catch(error => this.finish(id, turn, 'failed', error.message))
      return { turn: { id: turn.id, status: 'running' } }
    } catch (error) { this.finish(id, turn, 'failed', error.message); throw error }
  }
  async monitor(id, turn, baseline, expectedText) {
    const previous = new Set(baseline.messages.map(idOf)), deadline = Date.now() + this.timeout
    let settledReply = ''
    while (turn.active && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, this.interval))
      if (!turn.active) return
      const current = await this.read(id, true)
      const fresh = current.messages.filter(message => !previous.has(idOf(message)))
      const users = fresh.filter(message => roleOf(message) === 'user')
      if (users.length > 1) throw new Error('Another request entered this OpenCode session. Inspect its replies before continuing.')
      if (users.length === 1 && textOf(users[0]).trim() !== expectedText.trim()) throw new Error('The new OpenCode request does not match this task. Inspect its conversation.')
      if (current.forms.length) throw new Error('OpenCode needs an answer in its conversation before it can finish.')
      if (current.active || current.inbox.length || users.length !== 1) { settledReply = ''; continue }
      const userId = idOf(users[0]), owned = new Set([userId])
      const assistants = fresh.filter(message => roleOf(message) === 'assistant').reverse()
      const matching = assistants.filter(message => {
        const parent = message.parentID ?? message.info?.parentID
        if (parent && !owned.has(parent)) return false
        owned.add(idOf(message)); return true
      })
      const failure = matching.find(message => message.error || message.info?.error)
      if (failure) throw new Error('OpenCode reported a failed response. Inspect its conversation.')
      const reply = matching.map(textOf).filter(text => text.trim()).join('\n\n')
      if (!reply) continue
      if (settledReply !== reply) { settledReply = reply; continue }
      this.replies.set(`${id}:${turn.id}`, reply)
      if (this.replies.size > 300) this.replies.delete(this.replies.keys().next().value)
      this.finish(id, turn, 'completed'); return
    }
    if (turn.active) this.finish(id, turn, 'failed', 'OpenCode is still running after ten minutes. It was not interrupted; inspect its conversation.')
  }
  finish(id, turn, status, error) {
    if (this.turns.get(id) !== turn || !turn.active) return
    Object.assign(turn, { active: false, status, error })
    this.complete(id, { id: turn.id, status, ...(error ? { error: { message: error } } : {}) })
  }
  async stop(id) {
    await this.api('POST', `/api/session/${id}/interrupt`)
    const turn = this.turns.get(id)
    if (turn) this.finish(id, turn, 'interrupted', 'OpenCode was stopped by the operator.')
    this.cache.delete(id)
  }
}
