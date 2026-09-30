/**
 * The one place that talks HTTP.
 *
 * Components never build a URL: they call a named function here, so a path
 * change is a one-line edit and every call gets the same error handling and
 * the same `apiBase` prefix.
 */
import { config } from '../app/config'
import type { CodexItem, CodexStatus, CodexThread, CodexTurnState, HandoffData, ModelInfo, OpenCodeModelChange, OpenCodeStatus, ProjectInfo, RelayEvent } from './types'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiBase}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

  const raw = await response.text()
  let body: unknown
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    // A dev server without the API proxy answers unknown paths with index.html.
    throw new Error(response.ok
      ? 'استجابة غير متوقعة من الخادم — شغّل Relay Room بالأمر npm run dev:api.'
      : `Request failed (${response.status}).`)
  }

  if (!response.ok) {
    const failure = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
    throw new Error(typeof failure === 'string' ? failure : `Request failed (${response.status}).`)
  }
  return body as T
}

function post<T>(url: string, body?: unknown) {
  return requestJson<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) })
}

/** Most endpoints answer `{ data: ... }`; unwrap once, here. */
function unwrap<T>(body: { data?: T }): T {
  return (body?.data ?? null) as T
}

/** The model of a session, addressed as `providerID/modelID`. */
export type ModelSelector = string

export const api = {
  // Project scope
  project: () => requestJson<{ data: ProjectInfo }>('/api/project').then(unwrap),
  openProjectFolder: () => post<{ data: ProjectInfo }>('/api/project/open'),
  selectProjectFile: () => post<{ data: { path: string } | null }>('/api/project/select-file').then(unwrap),

  // Health of the two agents
  codexStatus: () => requestJson<CodexStatus>('/api/codex/status'),
  openCodeStatus: () => requestJson<OpenCodeStatus>('/api/health'),
  relayEvents: () => requestJson<{ data: RelayEvent[] }>('/api/relay-events').then(unwrap),

  // Codex conversations
  threads: () => requestJson<{ data: CodexThread[] }>('/api/codex/threads').then(unwrap),
  createThread: (title: string) => post<{ data: CodexThread }>('/api/codex/threads', { title }).then(unwrap),
  messages: (threadId: string) => requestJson<{ data: CodexItem[] }>(`/api/codex/threads/${threadId}/messages`).then(unwrap),
  sendMessage: (threadId: string, text: string) => post(`/api/codex/threads/${threadId}/messages`, { text }),
  turnState: (threadId: string) => requestJson<{ data: CodexTurnState }>(`/api/codex/threads/${threadId}/status`).then(unwrap),
  stopTurn: (threadId: string) => post(`/api/codex/threads/${threadId}/stop`),

  // The OpenCode side of one Codex conversation
  handoff: (threadId: string) => requestJson<{ data: HandoffData }>(`/api/codex/threads/${threadId}/handoff`).then(unwrap),
  sendOpenCodeMessage: (threadId: string, text: string) => post(`/api/codex/threads/${threadId}/opencode/messages`, { text }),
  stopOpenCode: (threadId: string) => post(`/api/codex/threads/${threadId}/opencode/stop`),

  // Models: what the local OpenCode install can run
  models: () => requestJson<{ data: ModelInfo[] }>('/api/models').then(unwrap),

  // Which model one conversation runs OpenCode on
  threadModel: (threadId: string) =>
    requestJson<{ data: { model: string } }>(`/api/codex/threads/${threadId}/opencode/model`).then(unwrap),
  setThreadModel: (threadId: string, model: string) =>
    post<{ data: OpenCodeModelChange }>(`/api/codex/threads/${threadId}/opencode/model`, { model }).then(unwrap),

  // Answering a question OpenCode raised
  replyToForm: (sessionId: string, formId: string, answer: Record<string, string>) =>
    post(`/api/sessions/${sessionId}/forms/${formId}/reply`, { answer }),
}

export type Api = typeof api
