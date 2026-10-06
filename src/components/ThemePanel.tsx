import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { themes, readStoredTheme, saveTheme, themeStorageKey, type ThemeId } from '../lib/themes'
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
    <fieldset><legend className="sr-only">اختر ثيم الواجهة</legend><div className="grid gap-3 sm:grid-cols-3">
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
    <p role="status" className="min-h-5 text-xs text-ready-ink">{notice ?? 'الأساسي يحافظ على ألوان الواجهة الأصلية.'}</p>
    <a href="https://github.com/tokyo-night/tokyo-night-vscode-theme" target="_blank" rel="noreferrer" className="inline-block text-[10px] text-ink-soft underline underline-offset-4">لوحة ألوان Tokyo Night الأصلية</a>
  </section>
}
