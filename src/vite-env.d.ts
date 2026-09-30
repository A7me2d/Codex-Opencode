/// <reference types="vite/client" />

/**
 * The full set of variables the browser app understands. Keep this in sync
 * with `.env.example` — that file is what teammates actually copy.
 */
interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string
  readonly VITE_API_BASE?: string
  readonly VITE_POLL_TURN_MS?: string
  readonly VITE_POLL_HANDOFF_MS?: string
  readonly VITE_POLL_MESSAGES_MS?: string
  readonly VITE_POLL_EVENTS_MS?: string
  readonly VITE_POLL_THREADS_MS?: string
  readonly VITE_POLL_CODEX_STATUS_MS?: string
  readonly VITE_POLL_OPENCODE_STATUS_MS?: string
  readonly VITE_POLL_PROJECT_MS?: string
  readonly VITE_POLL_MODELS_MS?: string
  readonly VITE_STICKY_SCROLL_PX?: string
  readonly VITE_MIN_TURN_MS?: string
  readonly VITE_ALERT_TIMEOUT_MS?: string
  readonly VITE_MAX_ALERTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
