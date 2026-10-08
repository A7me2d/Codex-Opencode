import { useEffect, useState } from 'react'
import { persistPreference, preferenceKeys } from './preferences'

export const fileIconThemeStorageKey = 'relay-room.file-icon-theme'
export type FileIconThemeId = 'lynx-style-a' | 'classic'

export function readFileIconTheme(): FileIconThemeId {
  try {
    const value = window.localStorage.getItem(fileIconThemeStorageKey)
    return value === 'classic' ? 'classic' : 'lynx-style-a'
  } catch { return 'lynx-style-a' }
}

export function saveFileIconTheme(theme: FileIconThemeId): boolean {
  persistPreference(preferenceKeys.fileIconTheme, theme)
  window.dispatchEvent(new Event('relay-room-file-icon-theme'))
  return true
}

export function useFileIconTheme(): FileIconThemeId {
  const [theme, setTheme] = useState<FileIconThemeId>(readFileIconTheme)
  useEffect(() => {
    const sync = () => setTheme(readFileIconTheme())
    window.addEventListener('relay-room-file-icon-theme', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('relay-room-file-icon-theme', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return theme
}
