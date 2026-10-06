import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, FileCode2, FileText, Folder, FolderOpen, LoaderCircle, Search, TriangleAlert, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { ProjectFileEntry, ProjectFiles } from '../../lib/types'
import { cx } from '../../lib/cx'

function ProjectEntry({ entry, childrenByPath, loadingPaths, expandedPaths, onToggle }: {
  entry: ProjectFileEntry
  childrenByPath: Record<string, ProjectFiles>
  loadingPaths: Set<string>
  expandedPaths: Set<string>
  onToggle: (entry: ProjectFileEntry) => void
}) {
  const directory = entry.kind === 'directory'
  const children = childrenByPath[entry.path]
  const loading = loadingPaths.has(entry.path)
  const isExpanded = expandedPaths.has(entry.path)
  const codeFile = /\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|py|java|go|rs|cs|cpp|h|css|scss|html|json|ya?ml|toml|sh)$/i.test(entry.name)
  return <li>
    {directory ? <button type="button" onClick={() => onToggle(entry)} aria-expanded={isExpanded} title={entry.path}
      className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-right text-[11px] text-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
      {loading ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-soft" /> : isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-soft" /> : <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
      {isExpanded ? <FolderOpen className="h-4 w-4 shrink-0 text-review" /> : <Folder className="h-4 w-4 shrink-0 text-review" />}
      <span dir="auto" className="min-w-0 truncate">{entry.name}</span>
    </button> : <div title={entry.path} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-soft">
      <span className="h-3.5 w-3.5 shrink-0" />{codeFile ? <FileCode2 className="h-4 w-4 shrink-0 text-relay" /> : <FileText className="h-4 w-4 shrink-0 text-ink-soft" />}
      <span dir="auto" className="min-w-0 truncate">{entry.name}</span>
    </div>}
    {isExpanded && children ? <ul className="ms-3 border-s border-line ps-1.5">{children.entries.map(child => <ProjectEntry key={child.path} entry={child} childrenByPath={childrenByPath} loadingPaths={loadingPaths} expandedPaths={expandedPaths} onToggle={onToggle} />)}</ul> : null}
  </li>
}

export function ProjectExplorer({ workRoot }: { workRoot: string }) {
  const [directories, setDirectories] = useState<Record<string, ProjectFiles>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [loading, setLoading] = useState<Set<string>>(() => new Set(['']))
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ProjectFileEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const generation = useRef(0)
  const loadDirectory = useCallback(async (directory: string) => {
    const requestGeneration = generation.current
    setLoading(current => new Set(current).add(directory))
    setError(null)
    try {
      const result = await api.projectFiles(directory)
      if (generation.current === requestGeneration) setDirectories(current => ({ ...current, [directory]: result }))
    } catch (failure) {
      if (generation.current === requestGeneration) setError(failure instanceof Error ? failure.message : 'تعذّر قراءة ملفات المشروع.')
    } finally {
      if (generation.current === requestGeneration) setLoading(current => { const next = new Set(current); next.delete(directory); return next })
    }
  }, [])
  useEffect(() => {
    generation.current += 1
    setDirectories({}); setExpanded(new Set([''])); setLoading(new Set([''])); setError(null)
    void loadDirectory('')
  }, [workRoot, loadDirectory])
  useEffect(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) { setSearchResults([]); setSearching(false); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const result = await api.projectSearch(term)
        if (!cancelled) { setSearchResults(result.entries); setSearchTruncated(result.truncated) }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'تعذّر البحث في ملفات المشروع.')
      } finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, workRoot])
  function toggleDirectory(entry: ProjectFileEntry) {
    if (expanded.has(entry.path)) {
      setExpanded(current => { const next = new Set(current); next.delete(entry.path); return next })
      return
    }
    setExpanded(current => new Set(current).add(entry.path))
    if (!directories[entry.path] && !loading.has(entry.path)) void loadDirectory(entry.path)
  }
  const root = directories['']
  return <section aria-label="ملفات المشروع" className="flex min-h-0 flex-1 flex-col">
    {error ? <p role="alert" className="flex shrink-0 items-start gap-2 border-b border-line bg-review-tint px-3 py-2 text-[10px] leading-5 text-review-ink"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />{error}</p> : null}
    <label className="mx-2 mt-2 flex shrink-0 items-center gap-2 rounded-md border border-line bg-paper px-2.5 focus-within:border-relay/50 focus-within:ring-2 focus-within:ring-relay/20">
      {searching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-ink-soft" aria-hidden="true" /> : <Search className="h-3.5 w-3.5 text-ink-soft" aria-hidden="true" />}
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم الملف…" aria-label="ابحث باسم الملف" className="h-9 min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-soft" />
      {query ? <button type="button" onClick={() => setQuery('')} aria-label="مسح البحث" className="rounded p-1 text-ink-soft hover:bg-card hover:text-ink"><X className="h-3.5 w-3.5" /></button> : null}
    </label>
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {query.trim() ? <>
        {searchResults.length ? <ul className="space-y-0.5">{searchResults.map(entry => <li key={entry.path} title={entry.path} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink"><span className="h-3.5 w-3.5 shrink-0" />{entry.kind === 'directory' ? <Folder className="h-4 w-4 shrink-0 text-review" /> : <FileText className="h-4 w-4 shrink-0 text-ink-soft" />}<span dir="auto" className="min-w-0 flex-1 truncate">{entry.name}</span><code dir="ltr" className="ltr max-w-[45%] truncate text-[9px] text-ink-soft">{entry.path}</code></li>)}</ul> : !searching ? <p className="px-3 py-6 text-center text-[11px] text-ink-soft">لا توجد نتائج مطابقة.</p> : null}
        {searching ? <p className="px-3 py-2 text-center text-[10px] text-ink-soft">جارٍ البحث في ملفات المشروع…</p> : null}
        {searchTruncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">تم عرض أول 1000 نتيجة فقط.</p> : null}
      </> : <>
      {loading.has('') && !root ? <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />جارٍ قراءة ملفات المشروع…</div> : null}
      {root?.entries.length ? <ul className="space-y-0.5">{root.entries.map(entry => <ProjectEntry key={entry.path} entry={entry} childrenByPath={directories} loadingPaths={loading} expandedPaths={expanded} onToggle={toggleDirectory} />)}</ul> : null}
      {root && root.entries.length === 0 ? <p className="px-3 py-6 text-center text-[11px] leading-5 text-ink-soft">المجلد ده فاضي لسه.</p> : null}
      {root?.truncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">تم عرض أول 500 عنصر في هذا المجلد.</p> : null}
      </>}
    </div>
    <div className="shrink-0 border-t border-line px-3 py-2 text-[10px] text-ink-soft">{root ? `${root.entries.length} عنصر` : 'مستكشف ملفات المشروع'}</div>
  </section>
}
