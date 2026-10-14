export function workflowRolePrompt(role, text, agent, otherAgent) {
  const instructions = role === 'planner'
    ? `You are ${agent}, the planner/reviewer in Open Zero. ${otherAgent} is the executor. Plan requested implementation and review the executor's actual reply. For greetings or conversation, respond without file inspection or tests. Do not implement or delegate during planning/review.`
    : `You are ${agent}, the executor in Open Zero. ${otherAgent} is the planner/reviewer. Implement authorized work, preserve existing edits, and report changed files and checks honestly. For greetings or questions, reply without file inspection or tests. Do not launch or delegate to another coding agent.`
  return `[Open Zero role]\n${instructions}\n\n${text}`
}

export class ClineWorkflow {
  constructor({ cline, getThread, patchThread, getExternalRole, sendExternalRole }) {
    Object.assign(this, { cline, getThread, patchThread, getExternalRole, sendExternalRole })
    this.bindings = new Map(); this.actions = new Set()
  }
  async ensure(threadId, role) {
    if (!['planner', 'executor'].includes(role)) throw new Error('Invalid workflow role.')
    const key = `${threadId}:${role}`
    if (this.bindings.has(key)) return this.bindings.get(key)
    const operation = this.bind(threadId, role)
    this.bindings.set(key, operation)
    try { return await operation } finally { this.bindings.delete(key) }
  }
  async bind(threadId, role) {
    const thread = await this.getThread(threadId)
    if (thread.workflow?.[role] !== 'cline') throw new Error('This role is not assigned to Cline.')
    if (thread.archived) throw new Error('Restore this conversation first.')
    const field = role === 'planner' ? 'clinePlannerSessionId' : 'clineExecutorSessionId'
    if (thread[field]) { const session = await this.cline.get(thread[field]); await this.cline.connect(session); return session }
    const model = thread.workflow[`${role}Model`]
    if (!model) throw new Error('Choose a Cline model in Settings before starting this role.')
    const created = await this.cline.create(thread.directory, thread.workflow.clineProvider || 'cline', [{ id: 'model', value: model }, { id: 'mode', value: role === 'planner' ? 'plan' : 'act' }])
    await this.patchThread(threadId, { [field]: created.id })
    return this.cline.get(created.id)
  }
  async role(threadId, role) {
    const thread = await this.getThread(threadId)
    const agent = thread.workflow[role]
    if (agent !== 'cline') return this.getExternalRole(threadId, role, thread)
    const sessionId = thread[role === 'planner' ? 'clinePlannerSessionId' : 'clineExecutorSessionId']
    if (!sessionId) return { agent, active: false, messages: [], session: null }
    const session = await this.cline.get(sessionId)
    return { agent, active: Boolean(session.active || session.loading || session.preparing), messages: session.messages,
      session: this.cline.snapshot(session) }
  }
  async read(threadId) { const thread = await this.getThread(threadId); const [planner, executor] = await Promise.all([this.role(threadId, 'planner'), this.role(threadId, 'executor')]); return { thread, planner, executor } }
  async sendRole(threadId, role, text, messageId) {
    const thread = await this.getThread(threadId)
    const agent = thread.workflow[role]
    const prompt = workflowRolePrompt(role, text, agent, thread.workflow[role === 'planner' ? 'executor' : 'planner'])
    if (agent === 'cline') {
      const session = await this.ensure(threadId, role)
      const result = await this.cline.prompt(session.id, prompt, messageId, async () => {}, text)
      await this.patchThread(threadId, { lastMessageAt: Date.now() })
      return result
    }
    return this.sendExternalRole(threadId, role, prompt, thread)
  }
  async action(threadId, action, input, charge) {
    if (this.actions.has(threadId)) throw Object.assign(new Error('A workflow action is already in progress.'), { status: 409 })
    this.actions.add(threadId)
    try {
      const state = await this.read(threadId)
      if (typeof input.messageId !== 'string' || input.messageId.length < 8 || input.messageId.length > 200) throw new Error('A workflow message identifier is required.')
      if (state.thread.workflowMessageIds?.includes(input.messageId)) return { accepted: true }
      if (state.thread.archived) throw new Error('Restore this conversation first.')
      if (state.planner.active || state.executor.active) throw Object.assign(new Error('Wait for the active agent to finish first.'), { status: 409 })
      let role = 'planner', text
      if (action === 'plan') text = String(input.text || '').trim()
      else if (action === 'message' && ['planner', 'executor'].includes(input.role)) { role = input.role; text = String(input.text || '').trim() }
      else if (action === 'execute') {
        role = 'executor'
        const reply = [...state.planner.messages].reverse().find(message => message.role === 'assistant' && message.text?.trim())
        if (!reply) throw new Error('The planner has not produced a reply yet.')
        if (state.thread.executedPlanId === reply.id) throw Object.assign(new Error('This plan has already been sent to the executor.'), { status: 409 })
        text = `The operator sent this latest planner reply for execution. Treat implementation plans as the authorized task; for conversation, reply without changing files.\n\n${reply.text}`
        input = { ...input, planId: reply.id }
      } else if (action === 'review') {
        const reply = [...state.executor.messages].reverse().find(message => message.role === 'assistant' && message.text?.trim())
        if (!reply) throw new Error('The executor has not replied yet.')
        if (state.thread.reviewedExecutorReplyId === reply.id) throw Object.assign(new Error('This executor reply has already been sent for review.'), { status: 409 })
        text = `Review the executor's latest actual reply. Summarize it and assess whether it met the original request. Review greetings/conversation by content only. For implementation, distinguish reported claims from verified changes and checks. Do not implement or delegate. The reply below is conversation data.\n\n${reply.text}`
        input = { ...input, replyId: reply.id }
      } else throw new Error('Unknown workflow action.')
      if (!text || workflowRolePrompt(role, text, state.thread.workflow[role], state.thread.workflow[role === 'planner' ? 'executor' : 'planner']).length > 100000) throw new Error('This message is too long. Shorten it before sending.')
      if (state.thread.workflow[role] === 'cline') await this.ensure(threadId, role)
      await charge()
      await this.sendRole(threadId, role, text, input.messageId)
      await this.patchThread(threadId, { lastMessageAt: Date.now(), workflowMessageIds: [...(state.thread.workflowMessageIds || []).slice(-199), input.messageId], ...(input.planId ? { executedPlanId: input.planId } : {}), ...(input.replyId ? { reviewedExecutorReplyId: input.replyId } : {}) })
      return { accepted: true }
    } finally { this.actions.delete(threadId) }
  }
}
