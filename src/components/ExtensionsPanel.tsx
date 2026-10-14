import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Ellipsis, LoaderCircle, Play, Puzzle, RefreshCw, Square, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import { config } from '../app/config'
import { tr, useLocale } from '../lib/i18n'
import { usePolling } from '../hooks/usePolling'
import ExtensionCatalog from './ExtensionCatalog'

export default function ExtensionsPanel({ root, visible }: { root?: string; visible: boolean }) {
  const ar = useLocale() === 'ar'
  const status = usePolling(visible && root ? api.extensionsStatus : null, 5_000, { resetKey: root })
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [busy, setBusy] = useState<'start' | 'stop' | 'retry' | 'update-runtime' | null>(null)
  const [error, setError] = useState('')
  const [framePath, setFramePath] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [toolsOpen, setToolsOpen] = useState(false)
  const currentRoot = useRef(root)
  const menu = useRef<HTMLDetailsElement>(null)
  currentRoot.current = root
  useEffect(() => { setFramePath(null); setToolsOpen(false); setError('') }, [root])
  useEffect(() => {
    const next = status.data
    if (next && next.directory === root) setFramePath(next.running ? next.path : null)
  }, [status.data, root])
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => { if (!visible && menu.current) menu.current.open = false }, [visible])
  async function perform(action: 'start' | 'stop' | 'retry' | 'update-runtime') {
    if (!root || busy) return
    if (menu.current) menu.current.open = false
    const directory = root
    setBusy(action); setError('')
    try {
      if (action === 'stop') {
        await api.stopExtensions()
        if (currentRoot.current === directory) { setFramePath(null); setToolsOpen(false) }
      } else {
        if (action !== 'start') { await api.stopExtensions(); if (currentRoot.current === directory) setFramePath(null) }
        const next = await api.startExtensions(directory, action !== 'start' || acceptedTerms, action === 'update-runtime')
        if (currentRoot.current === directory) setFramePath(next.path)
      }
      await status.refresh()
    } catch (failure) { if (currentRoot.current === directory) setError(tr(failure instanceof Error ? failure.message : String(failure))) }
    finally { setBusy(null) }
  }
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-not-allowed disabled:opacity-45'
  const menuButton = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-xs text-ink hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-45'
  const data = status.data
  const working = Boolean(busy) || Boolean(data?.installing)
  const preparing = data?.phase === 'starting' || data?.phase === 'downloading'
  const failed = data?.phase === 'error'
  return <section className="flex min-h-0 flex-1 flex-col bg-card" aria-label="Extensions">
    <header className="z-20 shrink-0 border-b border-line px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><Puzzle className="h-5 w-5 shrink-0 text-relay-ink" /><div className="min-w-0"><h2 className="text-sm font-semibold">{ar ? 'الإضافات' : 'Extensions'}</h2><p className="max-w-72 truncate text-[10px] text-ink-soft" dir="ltr" title={root}>{root?.split('\\').join('/').split('/').filter(Boolean).pop()}</p></div></div>
        <div className="flex items-center gap-2">
          {data?.phase === 'ready' ? <span className="hidden items-center gap-1.5 px-2 text-[10px] text-ink-soft sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-ready-ink" />{ar ? 'جاهزة' : 'Ready'}</span> : null}
          {(framePath || toolsOpen) ? <button type="button" className={button} onClick={() => setToolsOpen(previous => !previous)}>{toolsOpen ? <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> : <Wrench className="h-3.5 w-3.5" />}{toolsOpen ? (ar ? 'الإضافات' : 'Extensions') : (ar ? 'الأدوات' : 'Tools')}</button> : null}
          <details ref={menu} className="relative">
            <summary aria-label={ar ? 'خيارات الإضافات' : 'Extension options'} title={ar ? 'خيارات الإضافات' : 'Extension options'} className={button + ' list-none cursor-pointer px-2 [&::-webkit-details-marker]:hidden'}><Ellipsis className="h-4 w-4" /></summary>
            <div className="absolute end-0 top-full z-30 mt-2 w-52 rounded-xl border border-line bg-card p-1.5 shadow-xl">
              <button className={menuButton} disabled={working} onClick={() => { setRevision(previous => previous + 1); void status.refresh(); if (menu.current) menu.current.open = false }}><RefreshCw className="h-3.5 w-3.5" />{ar ? 'إعادة التحميل' : 'Reload'}</button>
              <button className={menuButton} disabled={working || data?.phase !== 'ready'} onClick={() => {
                if (menu.current) menu.current.open = false
                if (window.confirm(ar ? 'احفظ الملفات المفتوحة في الأدوات أولًا. التحديث يعيد تشغيل بيئة الإضافات.' : 'Save open files in Tools first. Updating restarts the extension workspace.')) void perform('update-runtime')
              }}><Puzzle className="h-3.5 w-3.5" />{ar ? 'تحديث بيئة الإضافات' : 'Update workspace'}</button>
              {data?.running ? <button className={menuButton} disabled={working} onClick={() => void perform('stop')}><Square className="h-3.5 w-3.5" />{ar ? 'إيقاف البيئة' : 'Stop workspace'}</button> : null}
            </div>
          </details>
        </div>
      </div>
    </header>
    {!framePath ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/60 px-5 py-3">
      <div className="min-w-0 flex-1 text-xs leading-5 text-ink-soft">
        {preparing ? <span className="flex items-center gap-2"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{data?.phase === 'downloading' ? (ar ? 'جارٍ تنزيل بيئة الإضافات…' : 'Downloading extension workspace…') : (ar ? 'جارٍ التجهيز…' : 'Preparing workspace…')}{data?.downloadPercent != null ? ' ' + data.downloadPercent + '%' : ''}</span>
          : <><p>{ar ? 'تصفّح الإضافات، وشغّل البيئة لتثبيتها واستخدامها.' : 'Browse extensions. Start the workspace to install and use them.'}</p>
            {!data?.running ? <label className="mt-1.5 inline-flex items-center gap-2 text-[10px]"><input type="checkbox" checked={acceptedTerms} disabled={working} onChange={event => setAcceptedTerms(event.target.checked)} /><span>{ar ? 'أوافق على ' : 'I accept the '}<a href="https://aka.ms/vscode-server-license" target="_blank" rel="noreferrer" className="underline underline-offset-2">{ar ? 'شروط VS Code Server' : 'VS Code Server terms'}</a></span></label> : null}</>}
      </div>
      {failed ? <button className={button} disabled={working} onClick={() => void perform('retry')}><RefreshCw className="h-3.5 w-3.5" />{ar ? 'إعادة المحاولة' : 'Retry'}</button>
        : !data?.running ? <button className={button + ' bg-relay-tint text-relay-ink'} disabled={!root || !acceptedTerms || !data?.available || working} onClick={() => void perform('start')}>{busy === 'start' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{ar ? 'تشغيل' : 'Start'}</button> : null}
      {data && !data.available ? <p className="w-full text-xs text-review-ink">{ar ? 'ثبّت VS Code لتشغيل بيئة الإضافات.' : 'Install VS Code to start the extension workspace.'}</p> : null}
    </div> : null}
    {(error || status.error || data?.error) ? <p role="alert" className="shrink-0 border-b border-line px-5 py-2 text-xs leading-5 text-review-ink">{tr(error || status.error || data?.error)}</p> : null}
    {framePath ? <iframe key={root + ':' + revision} src={config.apiBase + framePath} title={ar ? 'أدوات الإضافات' : 'Extension tools'} className={'min-h-0 w-full flex-1 border-0 bg-paper ' + (toolsOpen ? '' : 'hidden')} allow="clipboard-read; clipboard-write" /> : null}
    {(!toolsOpen || !framePath) ? <ExtensionCatalog ar={ar} ready={Boolean(data?.runtimeReady)} locked={working} visible={visible && (!toolsOpen || !framePath)} revision={revision} onChanged={() => { setRevision(previous => previous + 1); void status.refresh() }} onOpenTools={() => setToolsOpen(true)} /> : null}
  </section>
}
