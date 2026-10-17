import { createHash } from 'node:crypto'
import path from 'node:path'
import { superProvider } from '../super-agent.mjs'
import { MochiStore } from './store.mjs'
import { MochiRuntime } from './runtime.mjs'
import { MochiOpenCodeModel, redactSecrets } from './opencode-model.mjs'
import { MochiClineModel, CLINE_BRAIN_OBSTACLE } from './cline-model.mjs'
import { planQuestion, questionIsSensitive } from './questions.mjs'
import { planRecovery, applyRecovery } from './recovery.mjs'
import { validateConfig, brainModel, DEFAULT_MOCHI_CONFIG } from './policy.mjs'
import { applyMochiProposal } from './actions.mjs'

export const MOCHI_DEFAULT_CONFIG = DEFAULT_MOCHI_CONFIG
const problem = (message, status = 409) => Object.assign(new Error(message), { status })
const iso = value => new Date(value || Date.now()).toISOString()
const dataList = response => Array.isArray(response?.data) ? response.data : []
const short = value => redactSecrets(typeof value === 'string' ? value : '').slice(0, 500)
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)

/**
 * The brain a config selects, normalized. The brain is Mochi's own mind and is
 * independent of the desks it watches; its model selector only ever goes to the
 * provider it names, never to the other one.
 */
const brainStamp = (config, revision = 0) => ({
  provider: config?.brainProvider === 'cline' ? 'cline' : 'opencode',
  model: String(brainModel(config) || ''),
  account: config?.brainProvider === 'cline' ? config.clineProvider || 'cline' : '',
  revision,
})
const sameBrain = (left, right) => left.provider === right.provider && left.model === right.model && left.account === right.account && left.revision === right.revision

// Match the IDs and fallback keys used by src/lib/forms.ts. Retain exact option
// values; neither the model nor a stale proposal may invent a different choice.
export function readMochiForm(raw) {
  if (!raw || !/^frm_[A-Za-z0-9]+$/.test(raw.id || '')) return null
  const inputs = raw.fields ?? raw.questions ?? raw.input
  const fields = (Array.isArray(inputs) ? inputs : []).map((input, index) => {
    const item = input && typeof input === 'object' ? input : {}
    const options = (Array.isArray(item.options) ? item.options : []).flatMap(option => {
      const value = typeof option?.value === 'string' ? option.value : typeof option?.label === 'string' ? option.label : null
      return value ? [{ value, label: option.label || value }] : []
    })
    return { key: item.key || `q${index}`, label: item.title || item.label || item.question || `Question ${index + 1}`, type: item.type || (options.length ? 'select' : 'string'), options }
  })
  if (!fields.length) fields.push({ key: 'answer', label: raw.description || 'Your answer', type: 'string', options: [] })
  return { id: raw.id, title: raw.title || 'OpenCode needs clarification', fields }
}
const questionContext = form => {
  const context = {
  question: form.title,
  fields: form.fields.map(field => ({ id: field.key, label: field.label, type: field.type === 'boolean' ? 'select' : field.options.length ? 'select' : 'text', options: field.type === 'boolean' && !field.options.length ? ['true', 'false'] : field.options.map(option => option.value) })),
  fingerprint: fingerprint(form),
  }
  return { ...context, operatorOnly: Boolean(questionIsSensitive(context)) }
}

export async function createMochiIntegration(deps, { intervalMs = 15000 } = {}) {
  const store = new MochiStore(path.join(deps.stateDirectory, 'mochi'), { validateConfig })
  await store.ready
  const applying = new Set()
  const pendingBrains = new Map()
  const currentBrain = async teamId => {
    const record = await store.get(teamId)
    return brainStamp(record.config, record.brainRevision || 0)
  }
  const verifyInference = async ({ teamId, event, model: selectedModel }, provider) => {
    const record = await store.get(teamId)
    const team = await deps.superAgent.get(teamId)
    const stamp = brainStamp(record.config, record.brainRevision || 0)
    const expected = pendingBrains.get(teamId + ':' + event.id)
    if (!record.config.enabled || team.archived || stamp.provider !== provider || stamp.model !== selectedModel || !expected || !sameBrain(stamp, expected)) throw problem('Mochi stopped or its brain configuration changed before inference.')
    await deps.providerActivity.require(provider)
    return record.config
  }
  const licenseReady = async () => {
    if (typeof deps.license?.check !== 'function' || await deps.license.check() !== true) throw problem('Mochi needs an active Open Zero license.', 403)
  }
  const binding = async identity => {
    const team = await deps.superAgent.get(identity.teamId)
    const slot = team.slots.find(item => item.id === identity.slotId)
    if (team.archived || !slot?.thread || slot.thread.archived || slot.thread.id !== identity.threadId || slot.id === 'manager') throw problem('The desk binding changed. Nothing was sent.')
    const config = (await store.get(team.id)).config
    if (!config.enabled) throw problem('Mochi is disabled. Nothing was sent.')
    if (identity.brain && !sameBrain(identity.brain, await currentBrain(team.id))) throw problem('The Mochi brain changed; this suggestion is stale.')
    const provider = superProvider(slot.thread)
    await deps.providerActivity.require(brainStamp(config).provider)
    await deps.providerActivity.require(provider)
    return { team, slot, provider, config }
  }
  const model = new MochiOpenCodeModel({
    requireEnabled: () => deps.providerActivity.require('opencode'),
    // OpenCode's stateless text endpoint accepts only prompt/model; it does not
    // create an agent session or run a worker's tools. Unsupported versions fail
    // explicitly; there is deliberately no fallback to an unrestricted agent.
    capabilities: () => ({ toolFree: true, dedicatedContext: true }),
    invokeModel: async payload => {
      const { model: selector, prompt } = payload
      await verifyInference(payload, 'opencode')
      await licenseReady()
      const slash = selector.indexOf('/')
      if (slash < 1 || slash === selector.length - 1) throw problem('Choose an OpenCode model as providerID/modelID.', 400)
      await deps.license.consume()
      await verifyInference(payload, 'opencode')
      const response = await deps.openCodeApi('POST', '/api/experimental/generate', { model: { providerID: selector.slice(0, slash), id: selector.slice(slash + 1) }, prompt })
      if (typeof response?.data?.text !== 'string') throw problem('OpenCode did not return a stateless text result.', 502)
      return { text: response.data.text }
    },
  })

  const clineBrain = new MochiClineModel({
    requireEnabled: () => deps.providerActivity.require('cline'),
    capabilities: async ({ teamId }) => {
      const config = (await store.get(teamId)).config
      return deps.clineText?.availability(config.clineProvider || 'cline')
    },
    invokeModel: async payload => {
      const config = await verifyInference(payload, 'cline')
      if (!deps.clineText?.generate) throw problem(CLINE_BRAIN_OBSTACLE)
      await licenseReady()
      await deps.license.consume()
      await verifyInference(payload, 'cline')
      return deps.clineText.generate({ provider: config.clineProvider || 'cline', model: payload.model, prompt: payload.prompt, maxOutputChars: payload.maxOutputChars })
    },
  })
  const brains = { opencode: model, cline: clineBrain }
  const clineCatalog = async provider => {
    if (typeof deps.listClineModels !== 'function') throw problem('The Cline model catalog is unavailable in this build.', 503)
    return deps.listClineModels(provider || 'cline')
  }

  const currentJob = identity => deps.superCoordinator.jobs.filter(job => job.teamId === identity.teamId && job.slotId === identity.slotId && job.threadId === identity.threadId).at(-1)
  const readTask = async identity => {
    const { provider, slot } = await binding(identity)
    const job = currentJob(identity)
    if (!job || job.id !== identity.taskId || job.status !== 'failed') throw problem('The latest task is no longer this failed task.')
    if (provider !== 'opencode') throw problem('Safe Mochi continuation is currently available for OpenCode desks only.')
    await deps.guards.requireSuperOpenCodeThread(slot.thread)
    // Fresh provider state includes queued messages/forms, not only local flags.
    await deps.superOpenCode.prepare(identity.threadId)
    return { ...identity, status: job.status, canResume: true, messageId: job.requestId || job.id }
  }
  const forms = async threadId => dataList(await deps.openCodeApi('GET', `/api/session/${encodeURIComponent(threadId)}/form`)).map(readMochiForm).filter(Boolean)
  const readQuestion = async proposal => {
    const { provider, slot } = await binding(proposal)
    if (provider !== 'opencode') throw problem('This desk no longer has OpenCode questions.')
    await deps.guards.requireSuperOpenCodeThread(slot.thread)
    const form = (await forms(proposal.threadId)).find(item => item.id === proposal.sourceId)
    if (!form) throw problem('The question was answered or removed. Nothing was sent.')
    const record = await store.get(proposal.teamId)
    const event = record.events.find(item => item.id === proposal.eventId && item.sourceId === proposal.sourceId)
    if (!event || event.context.fingerprint !== fingerprint(form)) throw problem('The question changed. Open the desk to answer its current form.')
    // Reuse the deterministic validator on the fresh form and candidate. This
    // checks completeness, choice membership and dangerous questions without AI.
    const checked = await planQuestion({ ...event, context: { ...questionContext(form), evidence: proposal.answer } }, record.config)
    if (checked?.kind !== 'answer_question') throw problem(checked?.reason || 'The current answer could not be validated.')
    return { form, event }
  }

  const apply = async (proposal, _config, { operatorApproved = false } = {}) => {
    const key = `${proposal.teamId}:${proposal.id}`
    if (applying.has(key)) return { status: 'blocked', reason: 'This proposal is already being resolved.' }
    applying.add(key)
    try {
      const record = await store.get(proposal.teamId)
      const saved = record.proposals.find(item => item.id === proposal.id)
      if (!saved || saved.status !== 'pending') return { status: 'blocked', reason: 'This proposal is no longer pending.' }
      if (saved.kind === 'answer_question' && !saved.brain) {
        await store.change(saved.teamId, current => {
          const item = current.proposals.find(candidate => candidate.id === saved.id)
          if (item?.status !== 'pending') return
          item.status = 'stale'; item.resolvedAt = Date.now()
          item.reason = 'This older suggestion has no verified brain identity. Answer the question in its desk conversation.'
        })
        return { status: 'stale', reason: 'The older suggestion has no verified brain identity.' }
      }
      let claimTaken = false
      const claim = async () => {
        // Persist BEFORE the network side effect. On a crash, an uncertain action
        // remains blocked and is never replayed from a pending proposal.
        const claimed = await store.change(proposal.teamId, current => {
          const item = current.proposals.find(candidate => candidate.id === proposal.id)
          if (item?.status !== 'pending' || !current.config.enabled) return false
          if (!operatorApproved && (current.config.mode !== 'automatic' || current.config.autoAnswer !== true || saved.kind !== 'answer_question')) return false
          item.status = 'blocked'; item.resolvedAt = Date.now()
          item.reason = 'Execution claimed; outcome unconfirmed until the provider replies. Do not replay automatically.'
          return true
        })
        if (!claimed) throw problem('This action was stopped or already claimed.')
        claimTaken = true
      }
      const result = await applyMochiProposal(saved, record.config, {
        liveContext: async () => {
          await binding(saved)
          await licenseReady()
          // A suggestion decided by one brain must not be executed after the
          // operator switched Mochi's brain provider or model.
          if (saved.brain) {
            const current = await currentBrain(saved.teamId)
            if (!sameBrain(current, saved.brain)) throw problem("Mochi's brain changed after this suggestion was made. Answer it in the desk conversation, or wait for a fresh suggestion from the current brain.")
          }
          const event = record.events.find(item => item.id === saved.eventId)
          if (!event || event.sourceId !== saved.sourceId) throw problem('The source event is unavailable.')
          let source, task
          if (saved.kind === 'answer_question') {
            const { form } = await readQuestion(saved)
            source = { id: form.id, status: 'pending', safe: true, fields: form.fields }
          } else if (saved.kind === 'resume_task') {
            task = await readTask(saved)
            source = { id: saved.sourceId, status: 'pending', safe: true }
          } else source = { id: saved.sourceId, status: 'pending', safe: false }
          return { teamId: saved.teamId, slotId: saved.slotId, threadId: saved.threadId, taskId: saved.taskId, providerReady: true, licenseReady: true, event, source, task }
        },
        answerQuestion: async () => {
          await readQuestion(saved)
          await claim()
          await deps.license.consume()
          await readQuestion(saved)
          if (!operatorApproved) {
            const latest = (await store.get(saved.teamId)).config
            if (latest.mode !== 'automatic' || latest.autoAnswer !== true) throw problem('Automatic answering was disabled before sending.')
          }
          // Same reply shape/path as the main Agent question UI.
          await deps.openCodeApi('POST', `/api/session/${encodeURIComponent(saved.threadId)}/form/${encodeURIComponent(saved.sourceId)}/reply`, { answer: saved.answer })
          return { ok: true, status: 'applied' }
        },
        resumeTask: async () => applyRecovery(saved, {
          operatorApproved,
          readTask,
          claimAttempt: async () => { await claim(); return { claimed: true, attempt: 1, maxAttempts: 1 } },
          resumeTask: async () => {
            await readTask(saved)
            const result = await deps.sendMessage(saved.teamId, saved.slotId, {
              threadId: saved.threadId, messageId: `mochi-${saved.id}`, attachments: [],
              text: 'Continue the existing assigned task from its last confirmed state. Inspect what already completed before acting. Do not repeat completed actions or expand the task. Report any blocker instead of guessing.',
            })
            if (!result?.turn?.id && result?.accepted !== true) return { status: 'failed', reason: 'The normal send path did not confirm a continuation.' }
            return { status: 'resumed', turnId: result.turn?.id || null }
          },
        }),
      }, { operatorApproved })
      const status = ['applied', 'stale', 'rejected'].includes(result?.status) ? result.status : 'blocked'
      await store.change(saved.teamId, current => {
        const item = current.proposals.find(candidate => candidate.id === saved.id)
        if (!item) return
        item.status = status; item.resolvedAt = Date.now()
        item.reason = short(result.reason || (status === 'applied' ? 'The provider confirmed the action.' : 'No action was confirmed.'))
      })
      await store.appendLog(saved.teamId, { level: status === 'applied' ? 'info' : 'warn', message: `${claimTaken ? 'claimed_' : ''}${status}: ${short(result.reason)}`, eventKey: saved.eventKey })
      return { ...result, status }
    } catch (error) {
      return { status: 'blocked', reason: short(error.message) }
    } finally { applying.delete(key) }
  }

  const collect = async team => {
    if (team.archived || !(await store.get(team.id)).config.enabled) return []
    const events = []
    for (const slot of team.slots) {
      if (slot.id === 'manager' || !slot.thread || slot.thread.archived) continue
      const provider = superProvider(slot.thread)
      if (!deps.providerActivity.enabled(provider)) continue
      const identity = { teamId: team.id, slotId: slot.id, threadId: slot.thread.id }
      const job = currentJob(identity)
      const add = (kind, sourceId, context, taskId = '') => events.push({ ...identity, id: fingerprint([team.id, slot.id, slot.thread.id, kind, sourceId]), taskId, kind, sourceId, createdAt: iso(), context })
      if (job && ['failed', 'tracking_unknown'].includes(job.status)) add(job.status, job.id, { state: job.status, error: short(job.error), canResume: provider === 'opencode' }, job.id)
      if (provider === 'opencode') {
        try {
          for (const form of (await forms(slot.thread.id)).slice(0, 3)) add('question', form.id, { ...questionContext(form), assignedTask: short(job?.text) })
          for (const permission of dataList(await deps.openCodeApi('GET', `/api/session/${encodeURIComponent(slot.thread.id)}/permission`)).slice(0, 3)) if (permission.id) add('permission', permission.id, { title: short(permission.title || 'Tool permission requires your review') })
        } catch { /* next deterministic tick retries reads; no failed inference */ }
      } else if (provider === 'cline') {
        try {
          const session = await deps.clineBridge.get(slot.thread.id)
          for (const permission of (session?.permissions || []).slice(0, 3)) if (permission.id) add('permission', permission.id, { title: short(permission.title || 'Tool permission requires your review') })
        } catch { /* no speculative permissions */ }
      }
      if (events.length >= 24) break
    }
    return events.slice(0, 24)
  }
  const runtime = new MochiRuntime(store, {
    listTeams: () => deps.superAgent.list(),
    // The brain's own provider gates inference; a desk only needs its own provider.
    providerAvailable: (_team, config) => deps.providerActivity.enabled(brainStamp(config).provider),
    collect,
    plan: async (event, config) => {
      if (event.kind === 'question') {
        const current = await store.get(event.teamId)
        const before = brainStamp(current.config, current.brainRevision || 0)
        if (!current.config.enabled) return null
        const key = event.teamId + ':' + event.id
        pendingBrains.set(key, before)
        let proposal
        try { proposal = await planQuestion(event, current.config, { decide: (source, settings) => brains[before.provider].decide(source, { ...settings, model: before.model }) }) }
        finally { pendingBrains.delete(key) }
        if (!proposal) return null
        // The brain may have been switched while the request was in flight: an
        // old decision is never stored, and the event waits for the new brain.
        const after = await currentBrain(event.teamId)
        if (!sameBrain(before, after)) {
          return { kind: 'escalate', reason: "Mochi's brain changed while this was being decided. Nothing was applied; the next event will be planned by the new brain." }
        }
        return { ...proposal, brain: before }
      }
      if (event.kind === 'failed') return planRecovery(event, config)
      return { kind: 'escalate', reason: event.kind === 'permission' ? 'Review this permission in its desk conversation. Mochi does not approve tools in this version.' : 'Tracking is uncertain; the task may still be running. Open the desk; nothing was resent.' }
    },
    apply,
  }, { intervalMs })

  const snapshot = async teamId => {
    await deps.superAgent.get(teamId)
    const result = await runtime.snapshot(teamId)
    // Capability truth lives on the server: the panel renders it, it never claims it.
    const stamp = await currentBrain(teamId)
    const activity = deps.providerActivity.enabled(stamp.provider)
    const availability = stamp.provider === 'cline' && activity ? await deps.clineText?.availability(stamp.account) : null
    const brain = { ...stamp, available: activity && (stamp.provider === 'opencode' || availability?.available === true), reason: !activity ? 'The selected Mochi provider is disabled.' : stamp.provider === 'cline' && !availability?.available ? availability?.reason || CLINE_BRAIN_OBSTACLE : null }
    return { ...result, brain, proposals: result.proposals.map(item => ({ ...item, createdAt: iso(item.createdAt) })), events: result.events.map(item => ({ ...item, createdAt: iso(item.createdAt) })) }
  }
  const configure = async (teamId, patch) => {
    const team = await deps.superAgent.get(teamId)
    if (team.archived) throw problem('Restore the team before configuring Mochi.')
    const current = (await store.get(teamId)).config
    const effectivePatch = patch?.enabled === false ? { ...patch, mode: 'suggest' } : patch
    const next = validateConfig(effectivePatch, current)
    if (next.autoApproveTools || next.autoResume) throw problem('Tool approvals and continuation require operator review in this version.', 400)
    // Switching the brain is a stop-first operation: never swap it under a live assistant.
    if (next.enabled && (next.brainProvider !== current.brainProvider || next.clineProvider !== current.clineProvider)) {
      throw problem('Stop Mochi before changing its brain provider.')
    }
    if (next.enabled) {
      // Enabling is refused, not degraded: an unsafe or unproven brain never runs.
      await deps.providerActivity.require(next.brainProvider)
      if (next.brainProvider === 'cline') {
        const availability = await deps.clineText?.availability(next.clineProvider)
        if (availability?.available !== true) throw problem(availability?.reason || CLINE_BRAIN_OBSTACLE)
        const available = await clineCatalog(next.clineProvider)
        if (!available.some(item => item.id === next.clineModel)) throw problem('Choose an available Cline model.', 400)
      } else {
        const available = await deps.listOpenCodeModels()
        if (!available.some(item => item.id === next.model)) throw problem('Choose an available OpenCode model.', 400)
      }
    }
    if (effectivePatch && 'clineModel' in effectivePatch && next.clineModel) {
      // Cline models come from Cline's own catalog path and require Cline activity;
      // OpenCode is never woken for this and never sees a Cline model id.
      await deps.providerActivity.require('cline')
      const catalog = await clineCatalog(next.clineProvider)
      if (!catalog.some(item => item?.id === next.clineModel)) throw problem("Choose an available Cline model from Cline's own catalog.", 400)
    }
    await store.configure(teamId, effectivePatch)
    return snapshot(teamId)
  }
  const resolve = async (teamId, proposalId, decision) => {
    if (!['approve', 'reject'].includes(decision)) throw problem('Choose approve or reject.', 400)
    const record = await store.get(teamId)
    await deps.superAgent.get(teamId)
    const proposal = record.proposals.find(item => item.id === proposalId)
    if (!proposal) throw problem('Proposal not found.', 404)
    if (proposal.status !== 'pending' || applying.has(`${teamId}:${proposalId}`)) return snapshot(teamId)
    if (decision === 'reject') await store.resolveProposal(teamId, proposalId, 'rejected')
    else await apply(proposal, record.config, { operatorApproved: true })
    return snapshot(teamId)
  }
  return { snapshot, configure, resolve, start: () => runtime.start(), stop: () => runtime.stop(), pending: () => [], active: () => true,
    // Deterministic isolated checks; not exposed by HTTP and never drives a model on GET.
    tick: teamId => runtime.tick(teamId), flush: () => store.flush() }
}
