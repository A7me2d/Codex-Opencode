import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { themes, themeSources, readStoredTheme, saveTheme, themeStorageKey, type ThemeId } from '../lib/themes'
import { saveFileIconTheme, useFileIconTheme, type FileIconThemeId } from '../lib/fileIconThemes'
import { cx } from '../lib/cx'

export function ThemePanel() {
  const [selected, setSelected] = useState<ThemeId>(readStoredTheme)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    function sync(event: StorageEvent) { if (event.key === themeStorageKey || event.key === null) setSelected(readStoredTheme()) }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  function choose(theme: ThemeId) {
    const saved = saveTheme(theme)
    setSelected(theme)
    setNotice(saved ? 'تم تطبيق الثيم وحفظه لهذا المتصفح.' : 'تم تطبيق الثيم. تعذّر حفظ الاختيار في هذا المتصفح.')
  }
  return <section aria-label="الثيمات" className="space-y-4 p-6">
    <div><h3 className="text-sm font-bold">الثيمات</h3><p className="mt-1 text-xs leading-6 text-ink-soft">اختَر المظهر المناسب لك. يتطبّق فورًا على الواجهة ويُحفظ تلقائيًا.</p></div>
    <fieldset><legend className="sr-only">اختر ثيم الواجهة</legend><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {themes.map(theme => <label key={theme.id} className={cx('min-w-0 cursor-pointer rounded-xl border p-2 transition-colors', selected === theme.id ? 'border-relay ring-1 ring-relay' : 'border-line hover:border-relay/50')}>
        <input type="radio" name="theme" value={theme.id} checked={selected === theme.id} onChange={() => choose(theme.id)} className="sr-only peer" />
        <div data-theme={theme.id} aria-hidden="true" className="overflow-hidden rounded-lg border border-line bg-paper peer-focus-visible:ring-2 peer-focus-visible:ring-relay">
          <div className="flex items-center gap-1 border-b border-line bg-card px-2 py-2"><span className="h-1.5 w-1.5 rounded-full bg-relay" /><span className="h-1.5 w-1.5 rounded-full bg-ready" /><span className="h-1.5 w-1.5 rounded-full bg-review" /></div>
          <div className="flex h-24 gap-2 p-2" dir="ltr"><div className="w-7 shrink-0 space-y-2 border-r border-line pr-2"><div className="h-1 rounded bg-ink-soft/50" /><div className="h-1 rounded bg-relay" /><div className="h-1 rounded bg-ink-soft/30" /></div><div className="flex-1 space-y-2"><div className="ml-auto h-5 w-4/5 rounded bg-user-surface" /><div className="h-8 rounded border border-line bg-card p-2"><div className="h-1 w-3/4 rounded bg-relay-ink" /><div className="mt-1.5 h-1 w-1/2 rounded bg-ink-soft/50" /></div><div className="h-1 w-1/3 rounded bg-ready" /></div></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-1 px-1"><span className="text-xs font-bold">{theme.name}</span>{selected === theme.id ? <Check className="h-3.5 w-3.5 shrink-0 text-relay" /> : null}</div>
        <p className="mt-1 px-1 pb-1 text-[10px] leading-5 text-ink-soft">{theme.description}</p>
      </label>)}
    </div></fieldset>
    <p role="status" className="min-h-5 text-xs text-ready-ink">{notice ?? `الثيم الحالي: ${themes.find(theme => theme.id === selected)?.name}`}</p>
    {themeSources[selected] ? <a href={themeSources[selected]} target="_blank" rel="noreferrer" className="inline-block text-[10px] text-ink-soft underline underline-offset-4">مصدر ألوان الثيم · الألوان مهيّأة لواجهة Coding Room</a> : null}
    <FileIconThemePicker />
  </section>
}

function FileIconThemePicker() {
  const selected = useFileIconTheme()
  function choose(theme: FileIconThemeId) { saveFileIconTheme(theme) }
  return <div className="max-w-md border-t border-line pt-5">
    <label htmlFor="file-icon-theme" className="block text-xs font-bold">Set File Icon Theme</label>
    <p className="mt-1 text-[10px] leading-5 text-ink-soft">Choose how folders and file types appear in the project explorer.</p>
    <select id="file-icon-theme" value={selected} onChange={event => choose(event.target.value as FileIconThemeId)} className="mt-2 h-10 w-full rounded-lg border border-line bg-card px-3 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
      <option value="lynx-style-a">Lynx — Style A</option>
      <option value="classic">Classic</option>
    </select>
    <p role="status" className="mt-2 text-[10px] text-ready-ink">Current file icon theme: {selected === 'lynx-style-a' ? 'Lynx — Style A' : 'Classic'}</p>
  </div>
}
