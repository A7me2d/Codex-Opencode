import { randomUUID } from 'node:crypto'

const idOf = message => message?.id ?? message?.info?.id
const roleOf = message => message?.type ?? message?.info?.role
const parentOf = message => message?.parentID ?? message?.info?.parentID
const textOf = message => {
  const content = message?.text ?? message?.content ?? message?.parts ?? message?.message
  return typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : ''
}

/** A turn that ended in error must never be stored as a successful reply. */
const erroredOf = message => Boolean(message?.error) || Boolean(message?.info?.error)

/**
 * The only normalization allowed when matching a task to the request it queued.
 *
 * OpenCode can hand the stored prompt back with platform line endings, so `\r\n`/`\r`
 * are folded to `\n` and the ends are trimmed. Nothing else is folded — no case,
 * no inner whitespace collapsing and no substring matching — because those would let a
 * different request pass for this one.
 */
const normalizeRequestText = value => String(value ?? '').replace(/\r\n?/g, '\n').trim()

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Separate sessions, durable queue receipts, and only replies created by this send.
 *
 * OpenCode's message endpoint is a bounded window (the observed install returned the
 * last 50 messages), so the turn is correlated by identity, not by re-reading text from
 * whatever happens to be visible on each poll:
 *  - the queued request is pinned to one user id chosen by exact text, and only when that
 *    text is unique. Several identical requests in one session are never merged, never
 *    resolved by "which one was answered" (that is not identity), and end as an honest
 *    tracking failure when no receipt-provable identity exists;
 *  - an assistant counts only when its `parentID` chain provably reaches the pinned
 *    request; a parentless assistant is never accepted as a reply;
 *  - a completion waits while a known, still-unresolved branch of the reply chain is
 *    expected, so a partial text is not recorded as the final answer;
 *  - the latest snapshot of every message first seen after queue time is kept, so a
 *    streaming assistant id is re-read (`''` -> partial -> final, plus parent/error) and
 *    an errored message can never become the successful reply, even if text arrives late;
 *  - while the native session is still working nothing is declared failed; when the
 *    relation cannot be confirmed the turn ends as a tracking failure and the live
 *    session is left running rather than blamed for a correlation problem.
 */
export class SuperAgentOpenCode {
  constructor(api, complete, { interval = 2500, timeout = 600_000, idleGracePolls = 6 } = {}) {
    this.api = api; this.complete = complete; this.interval = interval; this.timeout = timeout
    this.idleGracePolls = idleGracePolls
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
      // `receipt.id` is the queue receipt, not the user message id OpenCode stores later,
      // so it can never bind this task to one of several look-alike user messages.
      const receipt = response?.data
      if (!receipt?.id || receipt.sessionID !== id || (receipt.delivery ?? response.delivery) !== 'queue') throw new Error('OpenCode did not confirm the queued task. Inspect its conversation before retrying.')
      this.cache.delete(id); this.activeCache = null
      void this.monitor(id, turn, baseline, text).catch(error => this.finish(id, turn, 'failed', error.message))
      return { turn: { id: turn.id, status: 'running' } }
    } catch (error) { this.finish(id, turn, 'failed', error.message); throw error }
  }
  async monitor(id, turn, baseline, expectedText) {
    const expected = normalizeRequestText(expectedText)
    const deadline = Date.now() + this.timeout
    // Ids seen at queue time: they are the conversation this task was added to, never this task.
    const seen = new Set()
    for (const message of baseline?.messages ?? []) { const id = idOf(message); if (id) seen.add(id) }
    // Bounded, turn-local state kept outside the 50-message window.
    const observed = new Map()   // id -> latest snapshot of a message first seen after queue time
    const pending = new Map()    // fresh user id -> latest text (may still be registering)
    const owned = new Set()      // ids proven to belong to this request (request + linked reply chain)
    const linked = new Map()     // assistant id -> text, in first-seen order
    const erroredIds = new Set() // sticky: an id that ever carried an error is never a success
    let requestId = null         // pinned request user id, set once and never re-derived
    let settled = '', idleStreak = 0, idleWithoutReply = 0, chainWait = 0, ambiguousStreak = 0

    // Reply linkage is recomputed from scratch each poll so a decision never depends on a
    // stale window: an assistant counts only when walking `parentID` reaches an id this
    // request already owns. A parentless assistant has no chain to prove ownership and is
    // never accepted, so an unrelated message can never stand in for a reply.
    const rebuild = () => {
      owned.clear(); linked.clear()
      if (!requestId) return
      owned.add(requestId)
      let changed = true
      while (changed) {
        changed = false
        for (const [id, message] of observed) {
          if (owned.has(id) || roleOf(message) !== 'assistant') continue
          const parent = parentOf(message)
          if (!parent || !owned.has(parent)) continue
          owned.add(id); changed = true
          if (erroredIds.has(id)) continue
          const text = textOf(message).trim()
          if (text) linked.set(id, text)
        }
      }
    }

    // A branch whose parent is not owned yet may still become ours once the missing link
    // arrives in a later poll, so completion waits for it (bounded by idleGracePolls).
    const hasUnresolvedChain = () => {
      if (!requestId) return false
      for (const [id, message] of observed) {
        if (owned.has(id) || roleOf(message) !== 'assistant') continue
        const parent = parentOf(message)
        if (parent && !owned.has(parent)) return true
      }
      return false
    }

    while (turn.active && Date.now() < deadline) {
      await delay(this.interval)
      if (!turn.active) return
      const current = await this.read(id, true)
      const freshUsers = []
      // First sight of a post-baseline id.
      for (const message of current.messages) {
        const messageId = idOf(message); if (!messageId || seen.has(messageId)) continue
        seen.add(messageId)
        if (observed.size < 4000) observed.set(messageId, message)
        if (roleOf(message) === 'user') { pending.set(messageId, textOf(message)); freshUsers.push(messageId) }
      }
      // Same id again: text, parent and error can all change while a message registers.
      for (const message of current.messages) {
        const messageId = idOf(message); if (!messageId) continue
        if (observed.has(messageId)) { observed.set(messageId, message); if (erroredOf(message)) erroredIds.add(messageId) }
        if (pending.has(messageId)) pending.set(messageId, textOf(message))
      }
      if (current.forms.length) throw new Error('OpenCode needs an answer in its conversation before it can finish.')

      const candidates = new Set()
      for (const [userId, text] of pending) if (normalizeRequestText(text) === expected) candidates.add(userId)
      // Pin only a unique identical-text request. Reply-parent evidence cannot prove which
      // of two look-alike user ids is ours, so several candidates are never merged and never
      // resolved by who was answered.
      if (!requestId && candidates.size === 1) requestId = [...candidates][0]
      if (requestId) pending.delete(requestId)
      // A different-text request observed next to ours is genuine mixing; an identical-text
      // one is never merged into this task but is also not treated as a failure.
      if (requestId && freshUsers.some(userId => userId !== requestId && !candidates.has(userId))) throw new Error('Another request entered this OpenCode session. Inspect its replies before continuing.')

      rebuild()

      if (current.active || current.inbox.length) { settled = ''; idleStreak = 0; idleWithoutReply = 0; chainWait = 0; ambiguousStreak = 0; continue }
      idleStreak += 1
      if (requestId) ambiguousStreak = 0
      else if (candidates.size > 1) ambiguousStreak += 1
      else ambiguousStreak = 0

      const reply = [...linked.values()].join('\n\n')
      if (reply) {
        idleWithoutReply = 0
        if (settled !== reply) { settled = reply; chainWait = 0; continue }
        if (hasUnresolvedChain() && chainWait < this.idleGracePolls) { chainWait += 1; continue }
        this.replies.set(`${id}:${turn.id}`, reply)
        if (this.replies.size > 300) this.replies.delete(this.replies.keys().next().value)
        this.finish(id, turn, 'completed'); return
      }
      chainWait = 0
      idleWithoutReply += 1
      // An errored reply for this request is a failed turn, never a success with text.
      if (idleStreak >= 2 && [...owned].some(ownedId => erroredIds.has(ownedId))) throw new Error('OpenCode reported an error for this turn. No reply was recorded and the task was not resent.')
      // Several identical requests and no identity evidence: never merged, never resent.
      if (!requestId && ambiguousStreak >= this.idleGracePolls) throw new Error('Several identical requests are present in this OpenCode session and this task cannot be told apart without identity evidence. The task was not resent and the session was not interrupted.')
      // Only a pinned request can prove the relation is lost; an unconfirmed turn keeps
      // waiting (the queue may still deliver it) until the timeout reports it honestly.
      if (requestId && idleWithoutReply >= this.idleGracePolls) throw new Error('OpenCode ended this turn without a reply linked to this task. The request/reply relation was not confirmed and the task was not resent.')
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
