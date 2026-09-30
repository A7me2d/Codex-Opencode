/**
 * Runtime configuration for the browser app.
 *
 * Everything tunable lives here so nobody has to hunt through components:
 * copy `.env.example` to `.env` and change a value, nothing else. Values are
 * read once at startup and validated, so a typo degrades to the documented
 * default instead of breaking polling.
 *
 * Only `VITE_`-prefixed variables reach the browser, and they are public by
 * definition — never put a secret here.
 */

interface Config {
  /** Shown in the header and in the tab title. */
  appTitle: string
  /** Prefix for every API call. Empty means "same origin" (the Vite proxy in dev). */
  apiBase: string
  poll: {
    codexStatusMs: number
    openCodeStatusMs: number
    projectMs: number
    threadsMs: number
    codexMessagesMs: number
    handoffMs: number
    turnStateMs: number
    relayEventsMs: number
    modelsMs: number
    sessionsMs: number
  }
  /** How close to the bottom still counts as "following the newest message". */
  stickyScrollThresholdPx: number
  /** A turn shorter than this is a blip, not news worth an alert. */
  minimumTurnMs: number
  /** How long a non-blocking alert stays on screen. */
  alertTimeoutMs: number
  /** Maximum alerts stacked on screen at once. */
  maxAlerts: number
}

type Env = Record<string, string | boolean | undefined>

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function count(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback
  return Math.round(parsed)
}

export function readConfig(env: Env): Config {
  return {
    appTitle: text(env.VITE_APP_TITLE, 'Relay Room'),
    apiBase: text(env.VITE_API_BASE, '').replace(/\/+$/, ''),
    poll: {
      // Turn state is the fastest signal (the composer and the alerts depend on it);
      // the health of the two agents changes slowly, so it can stay cheap.
      turnStateMs: count(env.VITE_POLL_TURN_MS, 800, 200, 60_000),
      handoffMs: count(env.VITE_POLL_HANDOFF_MS, 1_200, 200, 60_000),
      codexMessagesMs: count(env.VITE_POLL_MESSAGES_MS, 1_400, 300, 60_000),
      relayEventsMs: count(env.VITE_POLL_EVENTS_MS, 3_000, 500, 300_000),
      threadsMs: count(env.VITE_POLL_THREADS_MS, 5_000, 500, 300_000),
      codexStatusMs: count(env.VITE_POLL_CODEX_STATUS_MS, 10_000, 1_000, 600_000),
      openCodeStatusMs: count(env.VITE_POLL_OPENCODE_STATUS_MS, 10_000, 1_000, 600_000),
      projectMs: count(env.VITE_POLL_PROJECT_MS, 60_000, 5_000, 3_600_000),
      modelsMs: count(env.VITE_POLL_MODELS_MS, 60_000, 5_000, 3_600_000),
      sessionsMs: count(env.VITE_POLL_SESSIONS_MS, 15_000, 2_000, 3_600_000),
    },
    stickyScrollThresholdPx: count(env.VITE_STICKY_SCROLL_PX, 72, 0, 1_000),
    minimumTurnMs: count(env.VITE_MIN_TURN_MS, 4_000, 0, 600_000),
    alertTimeoutMs: count(env.VITE_ALERT_TIMEOUT_MS, 9_000, 1_000, 600_000),
    maxAlerts: count(env.VITE_MAX_ALERTS, 3, 1, 10),
  }
}

export const config = readConfig(import.meta.env)
