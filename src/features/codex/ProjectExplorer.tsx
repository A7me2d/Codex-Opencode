import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, FileCode2, FileText, Folder, FolderOpen, LoaderCircle, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import type { ProjectFileEntry, ProjectFiles } from '../../lib/types'
import { cx } from '../../lib/cx'

function ProjectEntry({ entry, childrenByPath, loadingPaths, onToggle }: {
  entry: ProjectFileEntry
  childrenByPath: Record<string, ProjectFiles>
  loadingPaths: Set<string>
  onToggle: (entry: ProjectFileEntry) => void
}) {
  const directory = entry.kind === 'directory'
  const children = childrenByPath[entry.path]
  const loading = loadingPaths.has(entry.path)
  const isExpanded = Boolean(children)
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
    {children ? <ul className="ms-3 border-s border-line ps-1.5">{children.entries.map(child => <ProjectEntry key={child.path} entry={child} childrenByPath={childrenByPath} loadingPaths={loadingPaths} onToggle={onToggle} />)}</ul> : null}
  </li>
}

export function ProjectExplorer({ workRoot }: { workRoot: string }) {
  const [directories, setDirectories] = useState<Record<string, ProjectFiles>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [loading, setLoading] = useState<Set<string>>(() => new Set(['']))
  const [error, setError] = useState<string | null>(null)
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
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {loading.has('') && !root ? <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />جارٍ قراءة ملفات المشروع…</div> : null}
      {root?.entries.length ? <ul className="space-y-0.5">{root.entries.map(entry => <ProjectEntry key={entry.path} entry={entry} childrenByPath={directories} loadingPaths={loading} onToggle={toggleDirectory} />)}</ul> : null}
      {root && root.entries.length === 0 ? <p className="px-3 py-6 text-center text-[11px] leading-5 text-ink-soft">المجلد ده فاضي لسه.</p> : null}
      {root?.truncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">تم عرض أول 500 عنصر في هذا المجلد.</p> : null}
    </div>
    <div className="shrink-0 border-t border-line px-3 py-2 text-[10px] text-ink-soft">{root ? `${root.entries.length} عنصر` : 'مستكشف ملفات المشروع'}</div>
  </section>
}
