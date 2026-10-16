import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { retryFileOperation } from './publish-extension.mjs'

export const isSuperSlotId = id => id === 'manager' || /^worker-[1-9]\d*$/.test(id)
const problem = (message, status = 409) => Object.assign(new Error(message), { status })
export function superAgentInstructions(role) {
  return `You are the ${role === 'manager' ? 'manager coordinating plans and reviewing reports' : 'worker implementing the operator’s assigned subtask'} in Open Zero Super Agent. Each conversation has its own project directory. Preserve existing work. This is a manual, Codex-only workspace: do not launch other agents, delegate, or message other conversations. The operator transfers tasks and reports through the interface. Follow the operator’s task and report changes and verification honestly.`
}
export class SuperAgentStore {
  constructor(directory) {
    this.file = path.join(directory, 'super-agent.json')
    this.teams = []; this.writes = Promise.resolve(); this.sending = new Set()
    this.ready = this.restore(); void this.ready.catch(() => {})
  }
  async restore() {
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); if (!Array.isArray(saved.teams)) throw new Error('Invalid Super Agent data.'); this.teams = saved.teams.map(({ workerCount, ...team }) => team) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  async list() { await this.ready; return structuredClone(this.teams) }
  async get(id) { await this.ready; const team = this.teams.find(team => team.id === id); if (!team) throw problem('Super Agent team was not found.', 404); return structuredClone(team) }
  change(operation) {
    const next = this.writes.catch(() => {}).then(async () => {
      await this.ready
      const teams = structuredClone(this.teams)
      const result = await operation(teams)
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify({ teams }), 'utf8')
      await retryFileOperation(() => rename(temporary, this.file))
      this.teams = teams
      return structuredClone(result)
    })
    this.writes = next; return next
  }
  create(title) {
    return this.change(teams => {
      const team = { id: randomUUID(), title: String(title || '').trim().slice(0, 120) || 'Super Agent', archived: false, updatedAt: Date.now(), receipts: [], slots: [{ id: 'manager', label: '', thread: null }] }
      teams.unshift(team); return team
    })
  }
  update(id, input) {
    return this.change(teams => {
      const team = teams.find(team => team.id === id); if (!team) throw problem('Team was not found.', 404)
      if ('title' in input) { if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw problem('Enter a team name of up to 120 characters.', 400); team.title = input.title.trim() }
      if ('archived' in input) { if (typeof input.archived !== 'boolean') throw problem('Invalid archive state.', 400); team.archived = input.archived }
      team.updatedAt = Date.now(); return team
    })
  }
  addSlot(id) {
    return this.change(teams => {
      const team = teams.find(team => team.id === id)
      if (!team || team.archived) throw problem('Open an active team first.')
      const number = Math.max(0, ...team.slots.filter(slot => slot.id !== 'manager').map(slot => Number(slot.id.slice(7)))) + 1
      team.slots.push({ id: `worker-${number}`, label: '', thread: null })
      team.updatedAt = Date.now(); return team
    })
  }
  removeSlot(id, slotId, isBusy = () => false) {
    return this.change(teams => {
      const team = teams.find(team => team.id === id)
      if (!team || team.archived) throw problem('Open an active team first.')
      const slot = team.slots.find(slot => slot.id === slotId)
      if (!slot || slotId === 'manager') throw problem('Only worker desks can be removed.', 400)
      if (slot.thread && (this.sending.has(slot.thread.id) || isBusy(slot.thread.id))) throw problem('Wait for the current turn to finish before removing its desk.')
      team.slots = team.slots.filter(slot => slot.id !== slotId)
      team.updatedAt = Date.now(); return team
    })
  }
  bind(id, slotId, resolveThread, label) {
    return this.change(async teams => {
      const team = teams.find(team => team.id === id)
      if (!team || team.archived) throw problem('Open an active team first.')
      const slot = team.slots.find(slot => slot.id === slotId); if (!slot) throw problem('Invalid team slot.', 400)
      if (slot.thread && this.sending.has(slot.thread.id)) throw problem('Wait for the current send to finish.')
      const thread = await resolveThread(team)
      if (slot.thread && this.sending.has(slot.thread.id)) throw problem('Wait for the current send to finish.')
      if (thread && team.slots.some(item => item.id !== slotId && item.thread?.id === thread.id)) throw problem('This conversation is already assigned to another slot in this team.')
      slot.thread = structuredClone(thread); if (typeof label === 'string') slot.label = label.trim().slice(0, 120)
      team.updatedAt = Date.now(); return team
    })
  }
  async send(id, slotId, input, { requireEnabled, resolveThread, isBusy, charge, dispatch }) {
    const team = await this.get(id), slot = team.slots.find(slot => slot.id === slotId)
    if (team.archived || !slot?.thread) throw problem('Assign a conversation in an active team first.')
    if (!isSuperSlotId(slotId)) throw problem('Invalid team slot.', 400)
    if (input.threadId !== slot.thread.id) throw problem('The conversation changed. Review the destination and send again.')
    if (typeof input.messageId !== 'string' || input.messageId.length < 8 || input.messageId.length > 200) throw problem('A message identifier is required.', 400)
    const receipt = `${slotId}:${slot.thread.id}:${input.messageId}`
    if (team.receipts.includes(receipt)) return { accepted: true }
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100000) throw problem('Enter a message of up to 100000 characters.', 400)
    if (this.sending.has(slot.thread.id)) throw problem('A message is already being sent to this conversation.')
    this.sending.add(slot.thread.id)
    try {
      await requireEnabled()
      const thread = await resolveThread(slot.thread.id)
      if (thread.localWorkflow || thread.archived || !thread.directory) throw problem('Choose an active Codex conversation with a project folder.')
      if (isBusy(thread.id)) throw problem('Stop or finish the active turn before sending another message.')
      const latest = await this.get(id)
      if (latest.archived || latest.slots.find(item => item.id === slotId)?.thread?.id !== thread.id) throw problem('The destination changed. Review it and send again.')
      await charge()
      await dispatch(thread.id, input)
      await this.change(teams => { const current = teams.find(item => item.id === id); current.receipts = [...current.receipts.slice(-199), receipt]; current.updatedAt = Date.now(); return current })
      return { accepted: true }
    } finally { this.sending.delete(slot.thread.id) }
  }
}
