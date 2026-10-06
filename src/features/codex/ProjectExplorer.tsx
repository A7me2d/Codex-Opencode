import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Braces, Boxes, ChevronDown, ChevronLeft, Code2, Component, Database, FileArchive, FileAudio2, FileCode2, FileCog, FileImage, FileJson2, FileLock2, FileSpreadsheet, FileText, FileType2, FileVideo2, FlaskConical, Folder, FolderOpen, Globe2, Image, Layers3, LoaderCircle, Package, Palette, Search, Settings2, TestTube2, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import type { ProjectFileEntry, ProjectFiles } from '../../lib/types'
import { useFileIconTheme } from '../../lib/fileIconThemes'
import { lynxStyleA } from '../../lib/lynxStyleA'

const lynxIcons = lynxStyleA as unknown as {
  languageIds: Record<string, string>
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  iconPaths: Record<string, string>
}

const folderIcons: Record<string, { icon: LucideIcon; color: string }> = {
  src: { icon: Code2, color: 'text-sky-500' }, app: { icon: Component, color: 'text-violet-500' }, apps: { icon: Boxes, color: 'text-violet-500' },
  components: { icon: Component, color: 'text-fuchsia-500' }, pages: { icon: Layers3, color: 'text-blue-500' }, hooks: { icon: Code2, color: 'text-cyan-500' },
  lib: { icon: Package, color: 'text-orange-500' }, libs: { icon: Boxes, color: 'text-orange-500' }, assets: { icon: Image, color: 'text-pink-500' },
  images: { icon: Image, color: 'text-pink-500' }, public: { icon: Globe2, color: 'text-green-500' }, tests: { icon: FlaskConical, color: 'text-emerald-500' },
  test: { icon: FlaskConical, color: 'text-emerald-500' }, __tests__: { icon: TestTube2, color: 'text-emerald-500' }, docs: { icon: BookOpen, color: 'text-blue-400' },
  documentation: { icon: BookOpen, color: 'text-blue-400' }, api: { icon: Database, color: 'text-teal-500' }, config: { icon: Settings2, color: 'text-slate-500' },
  styles: { icon: Palette, color: 'text-pink-500' }, css: { icon: Palette, color: 'text-pink-500' }, packages: { icon: Package, color: 'text-amber-500' },
}

function iconFor(entry: ProjectFileEntry, expanded = false, theme: 'lynx-style-a' | 'classic' = 'lynx-style-a'): { icon: LucideIcon; color: string } {
  const lower = entry.name.toLocaleLowerCase()
  if (theme === 'classic') {
    if (entry.kind === 'directory') return { icon: expanded ? FolderOpen : Folder, color: 'text-review' }
    return { icon: /\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|py|java|go|rs|cs|cpp|h|css|scss|html|json|ya?ml|toml|sh)$/i.test(entry.name) ? FileCode2 : FileText, color: 'text-ink-soft' }
  }
  if (entry.kind === 'directory') return folderIcons[lower] ?? { icon: expanded ? FolderOpen : Folder, color: 'text-amber-500' }
  const extension = lower.includes('.') ? lower.split('.').pop() ?? '' : ''
  if (/(^|\.)(test|spec)\./.test(lower) || lower.includes('.test.') || lower.includes('.spec.')) return { icon: TestTube2, color: 'text-emerald-500' }
  if (['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'].includes(lower)) return { icon: Package, color: 'text-green-600' }
  if (['tsconfig.json', 'vite.config.ts', 'vite.config.js', 'webpack.config.js', '.eslintrc', 'eslint.config.js'].includes(lower)) return { icon: FileCog, color: 'text-slate-500' }
  if (['.env', '.env.local', '.env.development', '.env.production'].includes(lower)) return { icon: FileLock2, color: 'text-yellow-600' }
  if (['readme.md', 'license', 'changelog.md', 'contributing.md'].includes(lower)) return { icon: BookOpen, color: 'text-blue-500' }
  if (['.gitignore', '.gitattributes'].includes(lower)) return { icon: FileArchive, color: 'text-orange-600' }
  if (['ts', 'tsx'].includes(extension)) return { icon: FileCode2, color: 'text-sky-500' }
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return { icon: Braces, color: 'text-yellow-500' }
  if (['json', 'jsonc'].includes(extension)) return { icon: FileJson2, color: 'text-yellow-600' }
  if (['html', 'htm'].includes(extension)) return { icon: Code2, color: 'text-orange-500' }
  if (['css', 'scss', 'sass', 'less'].includes(extension)) return { icon: Palette, color: 'text-pink-500' }
  if (['md', 'mdx', 'txt', 'rst'].includes(extension)) return { icon: FileText, color: 'text-blue-400' }
  if (['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(extension)) return { icon: FileImage, color: 'text-purple-500' }
  if (['vue', 'svelte', 'astro'].includes(extension)) return { icon: Component, color: 'text-green-500' }
  if (['py', 'java', 'go', 'rs', 'cs', 'cpp', 'h'].includes(extension)) return { icon: FileCode2, color: 'text-cyan-600' }
  if (['yaml', 'yml', 'toml', 'ini'].includes(extension)) return { icon: Settings2, color: 'text-rose-500' }
  if (['sql', 'db', 'sqlite'].includes(extension)) return { icon: Database, color: 'text-teal-600' }
  if (['csv', 'xls', 'xlsx'].includes(extension)) return { icon: FileSpreadsheet, color: 'text-green-600' }
  if (['zip', '7z', 'rar', 'tar', 'gz'].includes(extension)) return { icon: FileArchive, color: 'text-amber-600' }
  if (['mp3', 'wav', 'ogg'].includes(extension)) return { icon: FileAudio2, color: 'text-violet-500' }
  if (['mp4', 'mov', 'webm'].includes(extension)) return { icon: FileVideo2, color: 'text-violet-500' }
  if (['sh', 'ps1', 'bat', 'cmd'].includes(extension)) return { icon: FileType2, color: 'text-slate-600' }
  return { icon: FileText, color: 'text-ink-soft' }
}

function lynxIconPathFor(entry: ProjectFileEntry, expanded = false): string {
  const name = entry.name.toLocaleLowerCase()
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : ''
  const languageId = ['ts', 'tsx'].includes(extension) ? 'typescript' : ['js', 'jsx', 'mjs', 'cjs'].includes(extension) ? 'javascript' : extension === 'py' ? 'python' : ['sh', 'ps1', 'bat', 'cmd'].includes(extension) ? 'shellscript' : ''
  const iconId = entry.kind === 'directory'
    ? expanded ? lynxIcons.folderNamesExpanded[name] ?? 'folder-open' : lynxIcons.folderNames[name] ?? 'folder'
    : lynxIcons.fileNames[name] ?? lynxIcons.fileExtensions[extension] ?? lynxIcons.languageIds[languageId] ?? 'file'
  return lynxIcons.iconPaths[iconId] ?? lynxIcons.iconPaths[entry.kind === 'directory' ? 'folder' : 'file'] ?? ''
}

function ProjectEntry({ entry, childrenByPath, loadingPaths, expandedPaths, iconTheme, onToggle }: {
  entry: ProjectFileEntry
  childrenByPath: Record<string, ProjectFiles>
  loadingPaths: Set<string>
  expandedPaths: Set<string>
  iconTheme: 'lynx-style-a' | 'classic'
  onToggle: (entry: ProjectFileEntry) => void
}) {
  const directory = entry.kind === 'directory'
  const children = childrenByPath[entry.path]
  const loading = loadingPaths.has(entry.path)
  const isExpanded = expandedPaths.has(entry.path)
  const { icon: EntryIcon, color } = iconFor(entry, isExpanded, iconTheme)
  const iconPath = iconTheme === 'lynx-style-a' ? lynxIconPathFor(entry, isExpanded) : undefined
  return <li>
    {directory ? <button type="button" onClick={() => onToggle(entry)} aria-expanded={isExpanded} title={entry.path}
      className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-right text-[11px] text-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
      {loading ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-soft" /> : isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-soft" /> : <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
      {iconPath ? <img src={iconPath} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 object-contain" /> : <EntryIcon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />}
      <span dir="auto" className="min-w-0 truncate">{entry.name}</span>
    </button> : <div title={entry.path} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-soft">
      <span className="h-3.5 w-3.5 shrink-0" />{iconPath ? <img src={iconPath} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 object-contain" /> : <EntryIcon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />}
      <span dir="auto" className="min-w-0 truncate">{entry.name}</span>
    </div>}
    {isExpanded && children ? <ul className="ms-3 border-s border-line ps-1.5">{children.entries.map(child => <ProjectEntry key={child.path} entry={child} childrenByPath={childrenByPath} loadingPaths={loadingPaths} expandedPaths={expandedPaths} iconTheme={iconTheme} onToggle={onToggle} />)}</ul> : null}
  </li>
}

export function ProjectExplorer({ workRoot }: { workRoot: string }) {
  const iconTheme = useFileIconTheme()
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
        {searchResults.length ? <ul className="space-y-0.5">{searchResults.map(entry => <ProjectSearchResult key={entry.path} entry={entry} iconTheme={iconTheme} />)}</ul> : !searching ? <p className="px-3 py-6 text-center text-[11px] text-ink-soft">لا توجد نتائج مطابقة.</p> : null}
        {searching ? <p className="px-3 py-2 text-center text-[10px] text-ink-soft">جارٍ البحث في ملفات المشروع…</p> : null}
        {searchTruncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">تم عرض أول 1000 نتيجة فقط.</p> : null}
      </> : <>
      {loading.has('') && !root ? <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />جارٍ قراءة ملفات المشروع…</div> : null}
      {root?.entries.length ? <ul className="space-y-0.5">{root.entries.map(entry => <ProjectEntry key={entry.path} entry={entry} childrenByPath={directories} loadingPaths={loading} expandedPaths={expanded} iconTheme={iconTheme} onToggle={toggleDirectory} />)}</ul> : null}
      {root && root.entries.length === 0 ? <p className="px-3 py-6 text-center text-[11px] leading-5 text-ink-soft">المجلد ده فاضي لسه.</p> : null}
      {root?.truncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">تم عرض أول 500 عنصر في هذا المجلد.</p> : null}
      </>}
    </div>
    <div className="shrink-0 border-t border-line px-3 py-2 text-[10px] text-ink-soft">{root ? `${root.entries.length} عنصر` : 'مستكشف ملفات المشروع'}</div>
  </section>
}

function ProjectSearchResult({ entry, iconTheme }: { entry: ProjectFileEntry; iconTheme: 'lynx-style-a' | 'classic' }) {
  const { icon: Icon, color } = iconFor(entry, false, iconTheme)
  const iconPath = iconTheme === 'lynx-style-a' ? lynxIconPathFor(entry) : undefined
  return <li title={entry.path} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink"><span className="h-3.5 w-3.5 shrink-0" />{iconPath ? <img src={iconPath} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 object-contain" /> : <Icon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />}<span dir="auto" className="min-w-0 flex-1 truncate">{entry.name}</span><code dir="ltr" className="ltr max-w-[45%] truncate text-[9px] text-ink-soft">{entry.path}</code></li>
}
