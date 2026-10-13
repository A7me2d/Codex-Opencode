import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, Puzzle, RefreshCw, Square } from 'lucide-react'
import { api } from '../lib/api'
import { config } from '../app/config'
import { tr, useLocale } from '../lib/i18n'
import { usePolling } from '../hooks/usePolling'

export default function ExtensionsPanel({ root, visible }: { root?: string; visible: boolean }) {
  const ar = useLocale() === 'ar'
  const status = usePolling(visible && root ? api.extensionsStatus : null, 5_000, { resetKey: root })
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [busy, setBusy] = useState<'start' | 'install' | 'stop' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [framePath, setFramePath] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const currentRoot = useRef(root)
  currentRoot.current = root
  useEffect(() => { setFramePath(null); setError(''); setNotice('') }, [root])
  useEffect(() => {
    if (status.data?.directory !== root) return
    if (status.data?.running && status.data.path) setFramePath(status.data.path)
    else if (status.data && !status.data.running) setFramePath(null)
  }, [status.data, root])
  async function perform(action: 'start' | 'install' | 'stop') {
    if (!root || busy) return
    const directory = root
    setBusy(action); setError(''); setNotice('')
    try {
      if (action === 'start') {
        const next = await api.startExtensions(directory, acceptedTerms)
        if (currentRoot.current === directory) setFramePath(next.path)
      } else if (action === 'install') {
        await api.installNxConsole()
        if (currentRoot.current === directory) {
          setRevision(previous => previous + 1)
          setNotice(ar ? 'تم تثبيت Nx Console. افتح أيقونة Nx في الشريط الجانبي داخل المحرر.' : 'Nx Console installed. Open the Nx icon in the editor sidebar.')
        }
      } else {
        await api.stopExtensions()
        if (currentRoot.current === directory) setFramePath(null)
      }
      await status.refresh()
    } catch (failure) { if (currentRoot.current === directory) setError(tr(failure instanceof Error ? failure.message : String(failure))) }
    finally { setBusy(null) }
  }
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-not-allowed disabled:opacity-45'
  const data = status.data
  return <section className="flex min-h-0 flex-1 flex-col bg-card" aria-label="Extensions">
    <header className="shrink-0 space-y-3 border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><Puzzle className="h-4 w-4 shrink-0 text-relay-ink" /><div className="min-w-0"><h2 className="text-sm font-bold">{ar ? 'الإضافات' : 'Extensions'}</h2><p className="truncate text-[10px] text-ink-soft" dir="ltr" title={root}>{root}</p></div></div>
        <div className="flex flex-wrap gap-2">
          {data?.running || framePath ? <>
            <button type="button" className={button} disabled={Boolean(busy) || !data?.runtimeReady || data?.installing} onClick={() => void perform('install')}>{busy === 'install' || data?.installing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{data?.nxInstalled ? (ar ? 'تحديث Nx Console' : 'Update Nx Console') : (ar ? 'تثبيت Nx Console' : 'Install Nx Console')}</button>
            <button type="button" className={button} disabled={Boolean(busy)} onClick={() => setRevision(previous => previous + 1)} title={ar ? 'إعادة تحميل بيئة الإضافات' : 'Reload extension workspace'} aria-label={ar ? 'إعادة تحميل بيئة الإضافات' : 'Reload extension workspace'}><RefreshCw className="h-3.5 w-3.5" /></button>
            <button type="button" className={button} disabled={Boolean(busy)} onClick={() => void perform('stop')} title={ar ? 'إيقاف بيئة الإضافات' : 'Stop extension workspace'} aria-label={ar ? 'إيقاف بيئة الإضافات' : 'Stop extension workspace'}><Square className="h-3.5 w-3.5" /></button>
          </> : <button type="button" className={button} disabled={!root || !acceptedTerms || !data?.available || Boolean(busy)} onClick={() => void perform('start')}>{busy === 'start' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Puzzle className="h-3.5 w-3.5" />}{ar ? 'تشغيل بيئة الإضافات' : 'Start extension workspace'}</button>}
        </div>
      </div>
      <p className="text-xs leading-5 text-ink-soft">{ar ? 'Nx Console: nrwl.angular-console. لتثبيت إضافات أخرى، افتح Extensions داخل المحرر (Ctrl+Shift+X)، ثم ابحث واضغط Install.' : 'Nx Console: nrwl.angular-console. For other extensions, open Extensions in the editor (Ctrl+Shift+X), search, and select Install.'}</p>
      {!framePath ? <>
        <p className="text-xs leading-5 text-ink-soft">{ar ? 'أول تشغيل ينزّل بيئة VS Code من Microsoft. تُحفظ الإضافات محليًا بين مرات التشغيل.' : 'The first start downloads the VS Code runtime from Microsoft. Installed extensions are kept locally between launches.'}</p>
        <label className="flex items-start gap-2 text-xs leading-5 text-ink"><input type="checkbox" checked={acceptedTerms} disabled={Boolean(busy)} onChange={event => setAcceptedTerms(event.target.checked)} className="mt-1" /><span>{ar ? 'أوافق على ' : 'I accept the '}<a href="https://aka.ms/vscode-server-license" target="_blank" rel="noreferrer" className="underline underline-offset-2">{ar ? 'شروط VS Code Server' : 'VS Code Server terms'}</a>.</span></label>
      </> : null}
      {data && !data.available ? <p className="text-xs text-review-ink">{ar ? 'ثبّت VS Code على جهازك لاستخدام الإضافات، ثم أعد تحميل هذا التبويب.' : 'Install VS Code on this computer to use extensions, then reload this tab.'}</p> : null}
      {data && !data.nxWorkspace ? <p className="text-xs text-ink-soft">{ar ? 'المجلد الحالي لا يحتوي nx.json. افتح مجلد مشروع Nx من قائمة الملفات لاستخدام أدوات Nx Console.' : 'This folder has no nx.json. Select your Nx workspace folder to use Nx Console tools.'}</p> : null}
      {(error || status.error || data?.error) ? <p role="alert" className="text-xs leading-5 text-review-ink">{tr(error || status.error || data?.error)}</p> : null}
      {notice ? <p role="status" className="text-xs leading-5 text-ready-ink">{notice}</p> : null}
    </header>
    {framePath ? <iframe key={`${root}:${revision}`} src={`${config.apiBase}${framePath}`} title={ar ? 'محرر VS Code والإضافات' : 'VS Code editor and extensions'} className="min-h-0 w-full flex-1 border-0 bg-paper" allow="clipboard-read; clipboard-write" /> : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm leading-7 text-ink-soft">{status.status === 'loading' ? <LoaderCircle className="h-5 w-5 animate-spin" /> : ar ? 'شغّل بيئة الإضافات، ثم ثبّت Nx Console من الزر أعلاه.' : 'Start the extension workspace, then install Nx Console using the button above.'}</div>}
  </section>
}
