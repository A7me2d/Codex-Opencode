import { MochiOpenCodeModel } from './opencode-model.mjs'

export const CLINE_BRAIN_OBSTACLE = 'The installed Cline SDK must support stateless text generation and the selected Cline provider must be signed in. Agent sessions are never used as a fallback.'

/** Reuse the bounded JSON parser and serialized event dedup, with a text-only Cline transport. */
export class MochiClineModel extends MochiOpenCodeModel {
  escalateFromError(error) {
    const result = super.escalateFromError(error)
    return { ...result, reason: result.reason.replace(/\bOpenCode\b/g, 'Cline') }
  }
  async capabilities({ teamId = '', model = '' } = {}) {
    let capability
    try {
      capability = typeof this.deps.capabilities === 'function' ? await this.deps.capabilities({ teamId, model }) : this.deps.capabilities
    } catch { capability = null }
    if (capability?.toolFree !== true || capability?.stateless !== true || capability?.dedicatedContext !== true) {
      return { toolFree: false, blocked: true, reason: capability?.reason || CLINE_BRAIN_OBSTACLE }
    }
    return { toolFree: true, blocked: false, reason: 'Cline provider SDK: a stateless text-only request, without tools or agent sessions.' }
  }
}
