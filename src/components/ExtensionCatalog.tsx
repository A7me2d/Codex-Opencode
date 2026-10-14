import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, LoaderCircle, Search, Trash2, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import type { ExtensionItem } from '../lib/types'
import ExtensionIcon from './ExtensionIcon'

export default function ExtensionCatalog({ ar, ready, locked, visible, revision, onChanged, onOpenTools }: {
  ar: boolean; ready: boolean; locked: boolean; visible: boolean; revision: number; onChanged: () => void; onOpenTools: () => void
}) {
  const [tab, setTab] = useState<'marketplace' | 'installed'>('marketplace')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ExtensionItem[]>([])
  const [installed, setInstalled] = useState<ExtensionItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const reloadInstalled = async () => { const next = await api.installedExtensions(); setInstalled(next) }
  useEffect(() => {
    if (!visible) return
    let active = true
    void api.installedExtensions().then(next => { if (active) setInstalled(next) }).catch(() => { if (active) setError(ar ? 'تعذّر عرض الإضافات المثبتة.' : 'Could not load installed extensions.') })
    return () => { active = false }
  }, [visible, revision, ar])
  useEffect(() => {
    const request = ++generation.current
    if (!visible || tab !== 'marketplace') { setLoading(false); return }
    setLoading(true); setError('')
    const timer = setTimeout(() => {
      void api.searchExtensions(query, page).then(result => {
        if (request !== generation.current) return
        setItems(result.items); setHasMore(result.hasMore)
      }).catch(() => { if (request === generation.current) { setItems([]); setError(ar ? 'تعذّر الاتصال بالـ Marketplace. حاول مرة أخرى.' : 'Could not reach the Marketplace. Try again.') } })
        .finally(() => { if (request === generation.current) setLoading(false) })
    }, 350)
    return () => { clearTimeout(timer); generation.current++ }
  }, [query, page, tab, visible, ar, retry])
  const installedIds = new Set(installed.map(item => item.id.toLowerCase()))
  const list = tab === 'installed' ? installed.filter(item => `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(query.toLowerCase())) : items
  const selected = list.find(item => item.id === selectedId) || list[0]
  const selectedInstalled = selected && installedIds.has(selected.id.toLowerCase())
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-45 disabled:cursor-not-allowed'
  async function manage(action: 'install' | 'uninstall') {
    if (!selected || busy || locked || !ready) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api.manageExtension(selected.id, action)
      await reloadInstalled(); onChanged()
      setNotice(action === 'install' ? (ar ? 'تم التثبيت. افتح أدوات الإضافات لاستخدامها.' : 'Installed. Open extension tools to use it.') : (ar ? 'تمت إزالة الإضافة من Open Zero.' : 'Extension removed from Open Zero.'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3">
      <div className="flex gap-1 rounded-lg bg-paper p-1" role="tablist" aria-label="Extensions">
        {(['marketplace', 'installed'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setPage(1); setSelectedId(null); setError('') }} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === value ? 'bg-card text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>{value === 'marketplace' ? (ar ? 'المتجر' : 'Marketplace') : `${ar ? 'المثبتة' : 'Installed'} (${installed.length})`}</button>)}
      </div>
      <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2"><Search className="h-4 w-4 shrink-0 text-ink-soft" /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); setSelectedId(null) }} aria-label={ar ? 'البحث عن الإضافات' : 'Search extensions'} placeholder={ar ? 'ابحث عن إضافة، مثل Nx Console…' : 'Search extensions, e.g. Nx Console…'} className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none" /></label>
    </div>
    {error ? <div className="flex items-center gap-3 px-4 py-2"><p role="alert" className="text-xs text-review-ink">{error}</p><button className={button} disabled={loading || busy} onClick={() => { setRetry(previous => previous + 1); void reloadInstalled().catch(() => {}) }}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div> : null}
    {notice ? <p role="status" className="px-4 py-2 text-xs text-ready-ink">{notice}</p> : null}
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[minmax(280px,32%)_1fr] md:overflow-hidden">
      <div className="min-h-0 overflow-auto border-e border-line" aria-label={ar ? 'قائمة الإضافات' : 'Extension list'}>
        {loading ? <div role="status" className="flex items-center gap-2 p-6 text-xs text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />{ar ? 'جارٍ البحث…' : 'Searching…'}</div> : list.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id} className={`flex w-full gap-3 border-b border-line px-4 py-4 text-start hover:bg-relay-tint ${selected?.id === item.id ? 'bg-relay-tint' : ''}`}>
          <ExtensionIcon source={item.iconUrl || installed.find(local => local.id.toLowerCase() === item.id.toLowerCase())?.iconUrl} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{item.name}</span>{installedIds.has(item.id.toLowerCase()) ? <Check className="h-3.5 w-3.5 shrink-0 text-ready-ink" aria-label={ar ? 'مثبتة' : 'Installed'} /> : null}</div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-ink-soft">{item.description}</p><p className="mt-1.5 text-[10px] text-ink-soft">{item.publisher}</p></div>
        </button>)}
        {!loading && !list.length && !error ? <p className="p-6 text-xs text-ink-soft">{tab === 'installed' ? (ar ? 'لا توجد إضافات مثبتة تطابق البحث.' : 'No installed extensions match your search.') : (ar ? 'لا توجد نتائج.' : 'No results.')}</p> : null}
        {tab === 'marketplace' && (hasMore || page > 1) ? <div className="flex items-center justify-between gap-2 p-3"><button className={button} disabled={page === 1 || loading} onClick={() => setPage(previous => previous - 1)} aria-label={ar ? 'السابق' : 'Previous page'}><ArrowLeft className="h-3 w-3 rtl:rotate-180" /></button><span className="text-xs text-ink-soft">{page}</span><button className={button} disabled={!hasMore || loading} onClick={() => setPage(previous => previous + 1)} aria-label={ar ? 'التالي' : 'Next page'}><ArrowRight className="h-3 w-3 rtl:rotate-180" /></button></div> : null}
      </div>
      <div className="min-h-0 overflow-auto p-6 md:p-10">
        {selected && !loading ? <div className="mx-auto max-w-2xl"><div className="flex items-center gap-5"><ExtensionIcon source={selected.iconUrl || installed.find(local => local.id.toLowerCase() === selected.id.toLowerCase())?.iconUrl} large /><div className="min-w-0"><p className="mb-2 text-xs text-relay-ink">{selected.publisher}</p><h3 className="text-2xl font-semibold tracking-tight">{selected.name}</h3><div className="mt-3 flex items-center gap-3 text-[11px] text-ink-soft"><span dir="ltr">v{selected.version}</span>{selectedInstalled ? <span className="inline-flex items-center gap-1 text-ready-ink"><Check className="h-3 w-3" />{ar ? 'مثبتة' : 'Installed'}</span> : null}</div></div></div>
          <p className="mt-7 max-w-xl text-sm leading-7 text-ink-soft">{selected.description}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button className={`${button} bg-relay-tint text-relay-ink`} disabled={!ready || busy || locked} onClick={() => selectedInstalled ? onOpenTools() : void manage('install')}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : selectedInstalled ? <Wrench className="h-4 w-4" /> : <Download className="h-4 w-4" />}{selectedInstalled ? (ar ? 'فتح الأدوات' : 'Open tools') : (ar ? 'تثبيت' : 'Install')}</button>
            {selectedInstalled ? <><button className={button} disabled={!ready || busy || locked} onClick={() => void manage('install')}>{ar ? 'تحديث' : 'Update'}</button><button className={button} disabled={!ready || busy || locked} onClick={() => void manage('uninstall')} title={ar ? 'إزالة الإضافة' : 'Uninstall extension'} aria-label={ar ? 'إزالة الإضافة' : 'Uninstall extension'}><Trash2 className="h-4 w-4" /></button></> : null}
          </div>
          {!ready ? <p className="mt-4 text-xs leading-6 text-ink-soft">{ar ? 'شغّل بيئة الإضافات من أعلى لإتاحة التثبيت والتشغيل.' : 'Start the extension workspace above to install and run extensions.'}</p> : null}
          <div className="mt-8 border-t border-line pt-5"><p className="text-[10px] text-ink-soft">{ar ? 'معرّف الإضافة' : 'Extension ID'}</p><p className="mt-1 break-all text-xs text-ink-soft" dir="ltr">{selected.id}</p><details className="mt-5 text-xs leading-6 text-ink-soft"><summary className="cursor-pointer text-ink">{ar ? 'عن تشغيل الإضافات' : 'About extension support'}</summary><p className="mt-2">{ar ? 'الإضافات تُثبّت لـ Open Zero وتعمل داخل الأدوات. لا تغيّر محرر الملفات أو الشات تلقائيًا، والتوافق يعتمد على الإضافة.' : 'Extensions are installed for Open Zero and run in Tools. They do not automatically change the file editor or chat; compatibility depends on the extension.'}</p></details></div>
        </div> : !loading ? <p className="text-sm text-ink-soft">{ar ? 'اختر إضافة لعرض التفاصيل.' : 'Select an extension to view details.'}</p> : null}
      </div>
    </div>
  </div>
}
