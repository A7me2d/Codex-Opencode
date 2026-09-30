/**
 * Domain types.
 *
 * These mirror what `server/` actually returns. Anything a bridge owns stays
 * `unknown` and is narrowed by a reader in `src/lib`, so a surprise payload
 * becomes a rendering decision instead of a type error three files away.
 */

export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error'

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

export interface OpenCodeStatus {
  online: boolean
  root?: string
  error?: string
}

export interface CodexThread {
  id: string
  title?: string
  name?: string
  createdAt?: number | string
  updatedAt?: number | string
  cwd?: string
}

/** A Codex transcript entry. Only `userMessage` and `agentMessage` are rendered. */
export interface CodexItem {
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
  directory: string
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
}

export type Speaker = 'codex' | 'opencode'

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

/** The result of pointing one conversation at a different OpenCode model. */
export interface OpenCodeModelChange {
  /** The selector now in effect. */
  model: string
  /** The provider's own label, for the confirmation notice. */
  name?: string
}
