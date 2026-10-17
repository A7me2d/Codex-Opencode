/**
 * Mochi client API (Desk 7). Uses my own module tree only.
 *
 * `lib/api.ts` does not export `requestJson`, so this is the equivalent
 * guarded same-origin helper (same `src/app/config` apiBase, JSON in/out,
 * `{error}` unwrapping and license-usage events). Endpoints mirror the fixed
 * contract exactly:
 *   GET  /api/super-agent/teams/:id/mochi
 *   POST /api/super-agent/teams/:id/mochi/config
 *   POST /api/super-agent/teams/:id/mochi/proposals/:p/resolve
 * The OpenCode model catalog comes from the existing GET /api/models.
 * GET requests never trigger model inference; only operator actions POST.
 */
import { config } from '../../app/config'
import type { ModelInfo } from '../../lib/types'
import {
  mochiRoute,
  pickMochiConfigPatch,
  validateMochiSnapshot,
  type MochiConfigPatch,
  type MochiSnapshot,
} from './types'

/** Honest placeholder for "the server answered, but not with contract data". */
export const mochiUnavailableMessage = 'Request failed: body is not a Mochi contract snapshot.'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiBase}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

  // Same usage indicators as src/lib/api.ts so license usage stays consistent.
  const remaining = response.headers.get('X-License-Remaining')
  if (remaining !== null && Number.isFinite(Number(remaining))) {
    window.dispatchEvent(new CustomEvent('coding-room:license-usage', { detail: { remaining: Number(remaining) } }))
  } else if (response.status === 429 || response.status === 403) {
    window.dispatchEvent(new Event('coding-room:license-refresh'))
  }

  const raw = await response.text()
  let body: unknown
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(response.ok ? mochiUnavailableMessage : `Request failed (${response.status}).`)
  }

  if (!response.ok) {
    const failure = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
    throw new Error(typeof failure === 'string' ? failure : `Request failed (${response.status}).`)
  }
  return body as T
}

/** Strict/untrusted unwrap: returns the snapshot or throws — the panel must never fake a success. */
function unwrapSnapshot(body: { data?: unknown }): MochiSnapshot {
  const snapshot = validateMochiSnapshot(body?.data)
  if (!snapshot) throw new Error(mochiUnavailableMessage)
  return snapshot
}

export async function fetchMochiSnapshot(teamId: string, signal?: AbortSignal): Promise<MochiSnapshot> {
  const body = await requestJson<{ data?: unknown }>(mochiRoute(teamId), { signal })
  return unwrapSnapshot(body)
}

export function mochiConfigPatch(patch: MochiConfigPatch): MochiConfigPatch {
  return pickMochiConfigPatch(patch)
}

export async function saveMochiConfig(teamId: string, patch: MochiConfigPatch): Promise<MochiSnapshot> {
  const body = await requestJson<{ data?: unknown }>(mochiRoute(teamId, 'config'), {
    method: 'POST',
    body: JSON.stringify(pickMochiConfigPatch(patch)),
  })
  return unwrapSnapshot(body)
}

export async function resolveMochiProposal(
  teamId: string,
  proposalId: string,
  decision: 'approve' | 'reject',
): Promise<MochiSnapshot> {
  const id = typeof proposalId === 'string' ? proposalId.trim() : ''
  if (!id) throw new Error(mochiUnavailableMessage)
  const body = await requestJson<{ data?: unknown }>(
    mochiRoute(teamId, `proposals/${encodeURIComponent(id)}/resolve`),
    { method: 'POST', body: JSON.stringify({ decision }) },
  )
  return unwrapSnapshot(body)
}

/**
 * The existing OpenCode catalog (`GET /api/models`), loaded once per panel
 * visibility window and never claimed free or paid: the copy stays factual.
 */
export async function fetchOpenCodeModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const body = await requestJson<{ data?: unknown }>('/api/models?visibility=shown', { signal })
  const entries = body?.data
  if (!Array.isArray(entries)) throw new Error(mochiUnavailableMessage)
  const models: ModelInfo[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) throw new Error(mochiUnavailableMessage)
    const model = entry as Partial<ModelInfo>
    if (typeof model.id !== 'string' || !model.id
      || typeof model.providerID !== 'string' || typeof model.name !== 'string'
      || typeof model.tools !== 'boolean') throw new Error(mochiUnavailableMessage)
    models.push({
      id: model.id,
      providerID: model.providerID,
      name: model.name,
      variants: Array.isArray(model.variants) ? model.variants.filter(value => typeof value === 'string') : [],
      tools: model.tools,
    })
  }
  return models
}

export interface MochiClineModelInfo {
  /** Cline model id, valid only against Cline's own catalog. */
  id: string
  name: string
}

/**
 * Cline's own model catalog (`GET /api/cline/models`, read from the installed
 * Cline CLI package on disk). Strict shape validation; ids are Cline's and are
 * never sent to another provider.
 */
export async function fetchClineModels(signal?: AbortSignal, provider = 'cline'): Promise<MochiClineModelInfo[]> {
  const body = await requestJson<{ data?: unknown }>(`/api/cline/models?provider=${encodeURIComponent(provider)}`, { signal })
  const entries = body?.data
  if (!Array.isArray(entries)) throw new Error(mochiUnavailableMessage)
  const models: MochiClineModelInfo[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) throw new Error(mochiUnavailableMessage)
    const model = entry as Partial<MochiClineModelInfo>
    if (typeof model.id !== 'string' || !model.id || typeof model.name !== 'string') throw new Error(mochiUnavailableMessage)
    models.push({ id: model.id, name: model.name })
  }
  return models
}
