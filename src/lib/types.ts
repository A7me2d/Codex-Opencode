/**
 * Domain types.
 *
 * These mirror what `server/` actually returns. Anything a bridge owns stays
 * `unknown` and is narrowed by a reader in `src/lib`, so a surprise payload
 * becomes a rendering decision instead of a type error three files away.
 */

export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CodexAllowance { available: boolean; remainingPercent: number | null; resetsAt: number | null }
export interface CodexWeeklyQuota extends CodexAllowance { fiveHour?: CodexAllowance }

export interface ExtensionWorkspaceStatus {
  phase: 'ready'
  directory: string
  available: boolean
  runtimeReady: boolean
  installing: boolean
  revision: number
  path: null
}

export interface ExtensionItem {
  enabled?: boolean
  support?: 'snippets' | 'tailwind' | 'unsupported'
  iconUrl: string | null
  id: string
  name: string
  publisher: string
  description: string
  version: string
  installed: boolean
}

export interface EditorExtensionConfig {
  snippets: Array<{ label: string; body: string; description: string; language: string; extension: string }>
  tailwind: boolean
  revision: number
}

export interface RequestState<T> {
  data: T | null
  error: string | null
  status: RequestStatus
}

/** Anything polled or refreshed on demand carries its own state. */
export interface Request<T> extends RequestState<T> {
  refresh: () => Promise<T | null>
}

export interface CodexStatus {
  connected: boolean
  identity?: string
  root?: string
  error?: string
}

export interface CodexModelInfo {
  model: string
  displayName: string
  isDefault: boolean
  defaultReasoningEffort: string
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[]
}

export interface CodexSettings {
  permissionsPending?: boolean
  sandbox?: string
  model: string
  effort: string
}

export interface OpenCodeStatus {
  online: boolean
  root?: string
  error?: string
}

export interface WorkflowSetup { planner: 'codex' | 'opencode'; plannerModel: string; executor: 'codex' | 'opencode'; executorModel: string }
export interface WorkflowSettings { workflow: WorkflowSetup; agents: { id: string; name: string; available: boolean }[] }
export interface ProjectFileEntry { name: string; path: string; kind: 'directory' | 'file' }
export interface ProjectFiles { path: string; entries: ProjectFileEntry[]; truncated: boolean }
export interface ProjectSearchResults { entries: ProjectFileEntry[]; truncated: boolean }
export interface ProjectContentMatch { name: string; path: string; line: number; column: number; text: string; matchStart: number; matchLength: number }
export interface ProjectContentSearchResults { matches: ProjectContentMatch[]; truncated: boolean; skippedFiles: number }
export interface GitChange { path: string; originalPath?: string; index: string; worktree: string; staged: boolean; changed: boolean; conflict: boolean }
export type SourceControlStatus = { repository: false; root: string; error: string } | {
  repository: true; root: string; branch: string; head: string; upstream: string; ahead: number; behind: number;
  remotes: string[]; entries: GitChange[]; stagedVersion: string
}
export interface GitDiffPreview { path: string; staged: boolean; text: string; truncated: boolean; deleted: boolean }

export interface CodexThread {
  archived?: boolean
  running?: boolean
  workflow?: WorkflowSetup
  workflowRole?: 'planner' | 'executor'
  executorThreadId?: string
  id: string
  title?: string
  name?: string
  createdAt?: number | string
  updatedAt?: number | string
  cwd?: string
  /** The folder this session belongs to; may be another project. */
  directory?: string
  /** The folder Open Zero is currently watching. */
  inProject?: boolean
  /** Open in the local Codex right now, so its state is live. */
  active?: boolean
  /** Not recorded by Open Zero yet; opening it registers it. */
  needsRegistration?: boolean
  /** `providerID/modelID` chosen for this conversation. */
  openCodeModel?: string
}

/** A Codex transcript entry. Only `userMessage` and `agentMessage` are rendered. */
export interface CodexItem {
  status?: string
  changes?: { path: string; diff: string; kind?: { type: string } }[]
  id: string
  type: string
  text?: string
  content?: unknown
  phase?: 'commentary' | 'final_answer'
  live?: boolean
}

export interface CodexTurnState {
  active: boolean
  stopping?: boolean
  turnId?: string
  startedAt?: number
}

export interface ProjectInfo {
  /** Where Open Zero's own code lives. */
  directory: string
  /** The project sessions are opened in, which the folder button opens. */
  workRoot?: string
}

export interface HandoffLink {
  codexThreadId: string
  opencodeSessionId: string
  title?: string
  createdAt?: number
  updatedAt?: number
}

export type OpenCodeActivityKind = 'idle' | 'thinking' | 'edit' | 'command' | 'inspect' | 'tool'

export interface OpenCodeActivity {
  active: boolean
  kind: OpenCodeActivityKind
  label: string
  detail?: string
  toolName?: string
  updatedAt?: number
}

export interface HandoffData {
  link: HandoffLink | null
  /** `providerID/modelID` this conversation runs OpenCode on. */
  model?: string
  messages: unknown[]
  /** A question OpenCode cannot continue without; answered from the rail. */
  forms: unknown[]
  inbox: unknown[]
  active: boolean
  activity: OpenCodeActivity
}

export interface RelayEvent {
  id: string
  timestamp: number
  role: string
  kind: string
  message: string
  sessionId?: string
  codexThreadId?: string
}

/** A rendered chat line, whichever agent produced it. */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Codex is still streaming this message. */
  live?: boolean
  /** The user prompt that produced this OpenCode answer, used for scoped diffs/reverts. */
  userMessageId?: string
}

export type Speaker = 'codex' | 'opencode'

export interface SessionFileDiff {
  /** The completed Codex edit events contributing to this file's patch. */
  changeIds?: string[]
  file: string
  patch: string
  additions: number
  deletions: number
  status: string
}

/** One selectable OpenCode model, e.g. Big Pickle, G5.3, or a free router model. */
export interface ModelInfo {
  /** The id sent back to the server, e.g. `opencode/big-pickle`. */
  id: string
  /** The provider prefix of the id, e.g. `opencode`, `freetheai`, `openrouter`. */
  providerID: string
  /** Human name from the provider; falls back to the id. */
  name: string
  /** Extra variants the model offers (e.g. reasoning effort levels). */
  variants: string[]
  /** Can this model run agentic tool loops at all? */
  tools: boolean
}

/** One OpenCode session on this machine, with the project it belongs to. */
export interface OpenCodeSession {
  id: string
  title: string
  /** The folder the session runs in. */
  directory: string
  /** `providerID/modelID` the session currently runs. */
  model?: string
  updatedAt?: number
  createdAt?: number
  /** Running right now. */
  active: boolean
  /** Inside the folder Open Zero watches. */
  inProject: boolean
  /** The Codex conversation this session is doing work for, if any. */
  codexThreadId: string | null
  codexThreadModel?: string | null
}

/** The result of pointing one conversation at a different OpenCode model. */
export interface OpenCodeModelChange {
  /** The selector now in effect. */
  model: string
  /** The provider's own label, for the confirmation notice. */
  name?: string
}

export interface McpServerInfo {
  name: string
  enabled: boolean
  status: string
  toolCount: number | null
  pluginId?: string | null
}
