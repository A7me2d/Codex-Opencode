export const preferenceKeys = {
  theme: 'relay-room.theme',
  locale: 'coding-room.locale',
  fileIconTheme: 'relay-room.file-icon-theme',
  panelSizes: 'relay-room.panel-sizes',
  handoffVisible: 'relay-room.handoff-visible',
} as const

type PreferenceKey = typeof preferenceKeys[keyof typeof preferenceKeys]

declare global {
  interface Window {
    codingRoomPreferences?: {
      getAll: () => Promise<Record<string, string>>
      set: (key: string, value: string) => Promise<void>
    }
    codingRoomWindow?: { setTheme: (theme: string) => Promise<void> }
  }
}

/** Restore Electron-backed preferences before React reads localStorage. */
export async function hydratePreferences() {
  if (!window.codingRoomPreferences) return
  try {
    const saved = await window.codingRoomPreferences.getAll()
    for (const key of Object.values(preferenceKeys)) {
      const value = saved[key]
      if (typeof value === 'string') window.localStorage.setItem(key, value)
    }
  } catch {
    // Keep localStorage preferences available if the native bridge is unavailable.
  }
}

export function persistPreference(key: PreferenceKey, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* Electron storage may still succeed. */ }
  void window.codingRoomPreferences?.set(key, value).catch(() => undefined)
}

export function readHandoffVisibility() {
  try { return window.localStorage.getItem(preferenceKeys.handoffVisible) !== 'false' } catch { return true }
}
