export const themes = [
  { id: 'default', name: 'الأساسي', description: 'نفس الاستايل الأصلي الفاتح.' },
  { id: 'tokyo-night', name: 'Tokyo Night', description: 'خلفية داكنة وألوان أزرق وبنفسجي.' },
  { id: 'tokyo-storm', name: 'Tokyo Night Storm', description: 'درجات كحلي مائلة للبنفسجي.' },
] as const

export type ThemeId = typeof themes[number]['id']
export const themeStorageKey = 'relay-room.theme'

function validTheme(value: string | null): ThemeId {
  return themes.some(theme => theme.id === value) ? value as ThemeId : 'default'
}

export function readStoredTheme(): ThemeId {
  try { return validTheme(window.localStorage.getItem(themeStorageKey)) } catch { return 'default' }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
}

export function saveTheme(theme: ThemeId): boolean {
  applyTheme(theme)
  try { window.localStorage.setItem(themeStorageKey, theme); return true } catch { return false }
}

export function initializeTheme() {
  applyTheme(readStoredTheme())
  window.addEventListener('storage', event => {
    if (event.key === themeStorageKey || event.key === null) applyTheme(readStoredTheme())
  })
}
