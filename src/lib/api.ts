import { tr } from './i18n'
import type { CodexWeeklyQuota, ExtensionWorkspaceStatus, ExtensionItem } from './types'
/**
 * The one place that talks HTTP.
 *
 * Components never build a URL: they call a named function here, so a path
 * change is a one-line edit and every call gets the same error handling and
 * the same `apiBase` prefix.
 */
import { config } from '../app/config'
import type { McpServerInfo } from './types'
import { readCodexFileChanges } from './diff'
import type { CodexModelInfo, CodexSettings } from './types'
import type { SessionFileDiff } from './types'
import type { CodexItem, CodexStatus, CodexThread, CodexTurnState, HandoffData, ModelInfo, OpenCodeModelChange, OpenCodeSession, OpenCodeStatus, ProjectInfo, RelayEvent } from './types'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiBase}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

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
    // A dev server without the API proxy answers unknown paths with index.html.
    throw new Error(response.ok
      ? tr("استجابة غير متوقعة من الخادم — شغّل Open Zero بالأمر npm run dev:api.")
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

function messageId() {
  return globalThis.crypto.randomUUID()
}

/** Most endpoints answer `{ data: ... }`; unwrap once, here. */
function unwrap<T>(body: { data?: T }): T {
  return (body?.data ?? null) as T
}

/** The model of a session, addressed as `providerID/modelID`. */
export type ModelSelector = string

export const api = {
  codexWeeklyQuota: () => requestJson<{ data: CodexWeeklyQuota }>('/api/codex/weekly-quota').then(unwrap),
  extensionsStatus: () => requestJson<{ data: ExtensionWorkspaceStatus }>('/api/extensions/status').then(unwrap),
  installedExtensions: () => requestJson<{ data: ExtensionItem[] }>('/api/extensions/installed').then(unwrap),
  searchExtensions: (query: string, page = 1) => requestJson<{ data: { items: ExtensionItem[]; page: number; hasMore: boolean } }>(`/api/extensions/search?${new URLSearchParams({ q: query, page: String(page) })}`).then(unwrap),
  manageExtension: (id: string, action: 'install' | 'uninstall') => post<{ data: { id: string; installed: boolean } }>('/api/extensions/manage', { id, action }).then(unwrap),
  startExtensions: (directory: string, acceptedTerms: boolean, updateRuntime = false) => post<{ data: ExtensionWorkspaceStatus }>('/api/extensions/start', { directory, acceptedTerms, updateRuntime }).then(unwrap),
  stopExtensions: () => post('/api/extensions/stop'),
  installNxConsole: () => post<{ data: { installed: boolean; id: string } }>('/api/extensions/install-nx').then(unwrap),
  licenseStatus: () => window.codingRoomLicense
    ? window.codingRoomLicense.status()
    : requestJson<NonNullable<Awaited<ReturnType<NonNullable<Window['codingRoomLicense']>['status']>>>>('/api/license/status'),
  activateLicense: (key: string) => window.codingRoomLicense
    ? window.codingRoomLicense.activate(key)
    : post<Awaited<ReturnType<NonNullable<Window['codingRoomLicense']>['activate']>>>('/api/license/activate', { key }),
  workflow: () => requestJson<{ data: import('./types').WorkflowSettings }>('/api/workflow').then(unwrap),
  saveWorkflow: (setup: import('./types').WorkflowSetup) => post<{ data: import('./types').WorkflowSettings }>('/api/workflow', setup).then(unwrap),
  workflowAction: (threadId: string, action: 'plan' | 'execute' | 'review', text?: string) => post<{ data: { accepted: boolean; threadId?: string } }>(`/api/codex/threads/${threadId}/workflow/${action}`, { text, messageId: messageId() }).then(unwrap),
  mcpServers: (agent: 'codex' | 'opencode') => requestJson<{ data: McpServerInfo[] }>(`/api/${agent}/mcp`).then(unwrap),
  setMcpEnabled: (agent: 'codex' | 'opencode', name: string, enabled: boolean) => post<{ data: { servers: McpServerInfo[]; note: string } }>(`/api/${agent}/mcp`, { name, enabled }).then(unwrap),
  // Project scope
  project: () => requestJson<{ data: ProjectInfo }>('/api/project').then(unwrap),
  projectFile: (root: string, path: string) => requestJson<{ data: { path: string; content: string; version: string } }>(`/api/project/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`).then(unwrap),
  saveProjectFile: (input: { root: string; path: string; content: string; version: string }) => post<{ data: { path: string; content: string; version: string } }>('/api/project/file', input).then(unwrap),
  projectFiles: (path = '') => requestJson<{ data: import('./types').ProjectFiles }>(`/api/project/files?path=${encodeURIComponent(path)}`).then(unwrap),
  projectSearch: (query: string) => requestJson<{ data: import('./types').ProjectSearchResults }>(`/api/project/search?q=${encodeURIComponent(query)}`).then(unwrap),
  projectContentSearch: (query: string, signal?: AbortSignal) => requestJson<{ data: import('./types').ProjectContentSearchResults }>(`/api/project/search-content?q=${encodeURIComponent(query)}`, { signal }).then(unwrap),
  projectPreviewFiles: (root: string) => requestJson<{ data: { files: string[] } }>(`/api/project/preview-files?root=${encodeURIComponent(root)}`).then(unwrap),
  sourceControl: (root: string) => requestJson<{ data: import('./types').SourceControlStatus }>(`/api/source-control?root=${encodeURIComponent(root)}`).then(unwrap),
  sourceControlAction: (input: { root: string; action: 'stage' | 'unstage' | 'commit' | 'push' | 'publish'; paths?: string[]; message?: string; stagedVersion?: string; head?: string; branch?: string; remote?: string }) => post<{ data: import('./types').SourceControlStatus }>('/api/source-control', input).then(unwrap),
  sourceControlDiff: (root: string, path: string, staged: boolean) => requestJson<{ data: import('./types').GitDiffPreview }>(`/api/source-control/diff?${new URLSearchParams({ root, path, staged: String(staged) })}`).then(unwrap),
  generateCommitMessage: (input: { root: string; stagedVersion: string; model?: string; messageId: string }) => post<{ data: { message: string; model: string; stagedVersion: string } }>('/api/source-control/commit-message', input).then(unwrap),
  openProjectFolder: () => post<{ data: ProjectInfo }>('/api/project/open'),
  openWorkRoot: () => post<{ data: { directory: string } }>('/api/project/open-work-root'),
  selectProjectFolder: () =>
    post<{ data: { directory: string; changed: boolean } }>('/api/project/select-folder').then(unwrap),
  selectProjectFile: (directory?: string) =>
    post<{ data: { path: string } | null }>('/api/project/select-file', { directory }).then(unwrap),

  // Health of the two agents
  codexStatus: () => requestJson<CodexStatus>('/api/codex/status'),
  openCodeStatus: () => requestJson<OpenCodeStatus>('/api/health'),
  relayEvents: () => requestJson<{ data: RelayEvent[] }>('/api/relay-events').then(unwrap),

  // Codex conversations
  threads: () => requestJson<{ data: CodexThread[] }>('/api/codex/threads').then(unwrap),
  archivedThreads: () => requestJson<{ data: CodexThread[] }>('/api/codex/threads?archived=true').then(unwrap),
  renameThread: (id: string, title: string) => post(`/api/codex/threads/${id}/rename`, { title }),
  archiveThread: (id: string) => post(`/api/codex/threads/${id}/archive`),
  restoreThread: (id: string) => post(`/api/codex/threads/${id}/restore`),
  createThread: (title: string) => post<{ data: CodexThread }>('/api/codex/threads', { title }).then(unwrap),
  messages: (threadId: string) => requestJson<{ data: CodexItem[] }>(`/api/codex/threads/${threadId}/messages`).then(unwrap),
  codexModels: () => requestJson<{ data: CodexModelInfo[] }>('/api/codex/models').then(unwrap),
  codexDiff: (threadId: string) => requestJson<{ data: CodexItem[] }>(`/api/codex/threads/${threadId}/messages`).then(unwrap).then(readCodexFileChanges),
  acceptCodexChanges: (threadId: string, itemIds: string[]) => post<{ data: { accepted: string[] } }>(`/api/codex/threads/${threadId}/changes/accept`, { itemIds }).then(unwrap),
  codexSettings: (threadId: string) => requestJson<{ data: CodexSettings }>(`/api/codex/threads/${threadId}/settings`).then(unwrap),
  setCodexPermissions: (threadId: string, sandbox: string) => post<{ data: { sandbox: string } }>(`/api/codex/threads/${threadId}/settings`, { sandbox }).then(unwrap),
  sendMessage: (threadId: string, text: string, attachments: string[] = [], settings?: CodexSettings) =>
    post(`/api/codex/threads/${threadId}/messages`, { text, attachments, ...settings, messageId: messageId() }),
  turnState: (threadId: string) => requestJson<{ data: CodexTurnState }>(`/api/codex/threads/${threadId}/status`).then(unwrap),
  stopTurn: (threadId: string) => post(`/api/codex/threads/${threadId}/stop`),
  openThreadFolder: (threadId: string) =>
    post<{ data: { threadId: string; directory: string } }>(`/api/codex/threads/${threadId}/open-folder`),

  // The OpenCode side of one Codex conversation
  handoff: (threadId: string) => requestJson<{ data: HandoffData }>(`/api/codex/threads/${threadId}/handoff`).then(unwrap),
  sendOpenCodeMessage: (threadId: string, text: string) => post(`/api/codex/threads/${threadId}/opencode/messages`, { text, messageId: messageId() }),
  stopOpenCode: (threadId: string) => post(`/api/codex/threads/${threadId}/opencode/stop`),

  // OpenCode sessions belonging to this project (or already linked)
  openCodeSessions: () => requestJson<{ data: OpenCodeSession[] }>('/api/opencode/sessions').then(unwrap),
  createOpenCodeSession: (input: { title?: string; directory?: string; model?: string }) =>
    post<{ data: { id: string } }>('/api/opencode/sessions', input).then(unwrap),
  sessionMessages: (sessionId: string) =>
    requestJson<{ data: unknown[] }>(`/api/sessions/${sessionId}/messages`).then((body) => body?.data ?? null),
  sessionDiff: (sessionId: string) => requestJson<{ data: SessionFileDiff[] }>(`/api/sessions/${sessionId}/diff`).then(unwrap),
  sessionMessageDiff: (sessionId: string, messageId: string) =>
    requestJson<{ data: SessionFileDiff[] }>(`/api/sessions/${sessionId}/diff?messageID=${encodeURIComponent(messageId)}`).then(unwrap),
  revertSessionMessage: (sessionId: string, messageId: string) =>
    post<{ data: { reverted: boolean; messageID: string } }>(`/api/sessions/${sessionId}/revert`, { messageID: messageId }).then(unwrap),
  sendToOpenCodeSession: (sessionId: string, text: string) =>
    post(`/api/sessions/${sessionId}/prompt`, { text, messageId: messageId() }),
  stopOpenCodeSession: (sessionId: string) => post(`/api/opencode/sessions/${sessionId}/stop`),
  openSessionFolder: (sessionId: string) =>
    post<{ data: { sessionId: string; directory: string } }>(`/api/opencode/sessions/${sessionId}/open-folder`),

  // Models: what the local OpenCode install can run
  models: () => requestJson<{ data: ModelInfo[] }>('/api/models').then(unwrap),

  // Which model one conversation runs OpenCode on
  threadModel: (threadId: string) =>
    requestJson<{ data: { model: string } }>(`/api/codex/threads/${threadId}/opencode/model`).then(unwrap),
  setThreadModel: (threadId: string, model: string) =>
    post<{ data: OpenCodeModelChange }>(`/api/codex/threads/${threadId}/opencode/model`, { model }).then(unwrap),

  // Answering a question OpenCode raised
  replyToForm: (sessionId: string, formId: string, answer: Record<string, string>) =>
    post(`/api/sessions/${sessionId}/forms/${formId}/reply`, { answer, messageId: messageId() }),
}

export type Api = typeof api
