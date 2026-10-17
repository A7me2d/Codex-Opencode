import { tr, getLocale, type AppLocale } from './i18n'
import { persistPreference, preferenceKeys } from './preferences'
import './additional-themes.css'

export function getThemes(locale: AppLocale = getLocale()) {
  return [
    { id: 'liquid-glass', name: 'Liquid Glass Design', description: tr('زجاج داكن، حواف فضية ولمعة ناعمة مع نص واضح.') },
    { id: 'default', name: tr("الأساسي"), description: tr("نفس الاستايل الأصلي الفاتح.") },
    { id: 'tokyo-night', name: 'Tokyo Night', description: tr("خلفية داكنة وألوان أزرق وبنفسجي.") },
    { id: 'tokyo-storm', name: 'Tokyo Night Storm', description: tr("درجات كحلي مائلة للبنفسجي.") },
    { id: 'laserwave', name: 'LaserWave', description: tr("بنفسجي داكن مع وردي وأزرق ريترو.") },
    { id: 'sea-green', name: 'Sea Green Theme', description: tr("درجات البحر الداكنة ولمسات تركواز.") },
    { id: 'pro-hacker', name: 'Pro hacker theme', description: tr("أسود وأخضر مستوحى من التيرمنال.") },
    { id: 'huacat-pink', name: 'Huacat Pink Theme', description: tr("وردي فاتح وهادئ مع تفاصيل وردية.") },
    { id: 'cyberpunk-2077', name: 'Cyberpunk 2077', description: tr("رمادي داكن مع أصفر نيون وتركواز.") },
    { id: 'solarized-light', name: 'Solarized Light', description: locale === 'en' ? 'Warm paper light with calm blues and greens.' : 'ورق فاتح دافئ مع أزرق وأخضر هادئين.' },
    { id: 'nord', name: 'Nord', description: locale === 'en' ? 'Calm, north-bluish dark with muted frost accents.' : 'داكن هادئ بالأزرق البارد مع لمسات صقيعية.' },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark', description: locale === 'en' ? 'Warm retro dark with orange and olive tones.' : 'داكن دافئ ريترو ببرتقالي وأخضر زيتوني.' },
  ] as const
}

export const themes = getThemes()

export type ThemeId = typeof themes[number]['id']
export const themeSources: Partial<Record<ThemeId, string>> = {
  'tokyo-night': 'https://github.com/tokyo-night/tokyo-night-vscode-theme',
  'tokyo-storm': 'https://github.com/tokyo-night/tokyo-night-vscode-theme',
  laserwave: 'https://vscodethemes.com/e/jaredkent.laserwave/laserwave',
  'sea-green': 'https://vscodethemes.com/e/raashida.fixthecode-vs/sea-green-theme',
  'pro-hacker': 'https://vscodethemes.com/e/CamilaMartinezBedoya.pro-hacker-theme/pro-hacker-theme',
  'huacat-pink': 'https://vscodethemes.com/e/huacat.pink-theme/huacat-pink-theme',
  'cyberpunk-2077': 'https://vscodethemes.com/e/JWSandeman.cyberpunk2077-theme/cyberpunk2077',
  'solarized-light': 'https://ethanschoonover.com/solarized/',
  nord: 'https://github.com/nordtheme/nord',
  'gruvbox-dark': 'https://github.com/morhetz/gruvbox',
}
export const themeStorageKey = 'relay-room.theme'

function validTheme(value: string | null): ThemeId {
  return themes.some(theme => theme.id === value) ? value as ThemeId : 'default'
}

export function readStoredTheme(): ThemeId {
  try { return validTheme(window.localStorage.getItem(themeStorageKey)) } catch { return 'default' }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
  void window.codingRoomWindow?.setTheme(theme).catch(() => undefined)
}

export function saveTheme(theme: ThemeId): boolean {
  applyTheme(theme)
  persistPreference(preferenceKeys.theme, theme)
  return true
}

export function initializeTheme() {
  applyTheme(readStoredTheme())
  window.addEventListener('storage', event => {
    if (event.key === themeStorageKey || event.key === null) applyTheme(readStoredTheme())
  })
}
