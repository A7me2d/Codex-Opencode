import { openProjectFile } from '../../components/ProjectEditor'
import { tr } from '../../lib/i18n'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { BookOpen, Braces, Boxes, Check, ChevronDown, ChevronRight, Code2, Component, Copy, Database, FileArchive, FileAudio2, FileCode2, FileCog, FileImage, FileJson2, FileLock2, FileSpreadsheet, FileText, FileType2, FileVideo2, FlaskConical, Folder, FolderOpen, Globe2, Image, Layers3, LoaderCircle, Package, Palette, Search, Settings2, TestTube2, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import type { ProjectContentMatch, ProjectFileEntry, ProjectFiles } from '../../lib/types'
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
  const lower = entry.name.toLowerCase()
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
  if (['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'avif', 'bmp', 'tiff', 'heic', 'psd'].includes(extension)) return { icon: FileImage, color: 'text-purple-500' }
  if (['vue', 'svelte', 'astro'].includes(extension)) return { icon: Component, color: 'text-green-500' }
  if (['py', 'java', 'go', 'rs', 'cs', 'cpp', 'h', 'php', 'rb', 'swift', 'kt', 'kts', 'dart', 'lua', 'r', 'ex', 'exs', 'clj', 'scala', 'pl', 'cob', 'c', 'cc', 'hpp'].includes(extension)) return { icon: FileCode2, color: 'text-cyan-600' }
  if (['yaml', 'yml', 'toml', 'ini'].includes(extension)) return { icon: Settings2, color: 'text-rose-500' }
  if (['sql', 'db', 'sqlite'].includes(extension)) return { icon: Database, color: 'text-teal-600' }
  if (['csv', 'tsv', 'xls', 'xlsx', 'ods'].includes(extension)) return { icon: FileSpreadsheet, color: 'text-green-600' }
  if (['zip', '7z', 'rar', 'tar', 'gz'].includes(extension)) return { icon: FileArchive, color: 'text-amber-600' }
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'aiff', 'wma'].includes(extension)) return { icon: FileAudio2, color: 'text-violet-500' }
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv'].includes(extension)) return { icon: FileVideo2, color: 'text-violet-500' }
  if (['sh', 'ps1', 'bat', 'cmd'].includes(extension)) return { icon: FileType2, color: 'text-slate-600' }
  if (extension === 'pdf') return { icon: FileText, color: 'text-red-500' }
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(extension)) return { icon: FileType2, color: 'text-rose-500' }
  if (['exe', 'dll', 'bin', 'msi', 'wasm'].includes(extension)) return { icon: FileCog, color: 'text-slate-500' }
  return { icon: FileText, color: 'text-ink-soft' }
}

function lynxIconPathFor(entry: ProjectFileEntry, expanded = false): string {
  const name = entry.name.toLocaleLowerCase()
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : ''
  const languageId = ['ts', 'tsx'].includes(extension) ? 'typescript' : ['js', 'jsx', 'mjs', 'cjs'].includes(extension) ? 'javascript' : extension === 'py' ? 'python' : ['sh', 'ps1', 'bat', 'cmd'].includes(extension) ? 'shellscript' : ''
  const extensionParts = name.split('.').slice(1)
  const compoundIcon = extensionParts.map((_, index) => lynxIcons.fileExtensions[extensionParts.slice(index).join('.')]).find(Boolean)
  const specialIcon = name.startsWith('.env.') ? 'tune' : /^tsconfig(?:\..+)?\.json$/.test(name) ? 'tsconfig' : undefined
  const iconId = entry.kind === 'directory'
    ? expanded ? lynxIcons.folderNamesExpanded[name] ?? 'folder-open' : lynxIcons.folderNames[name] ?? 'folder'
    : lynxIcons.fileNames[name] ?? specialIcon ?? compoundIcon ?? lynxIcons.fileExtensions[extension] ?? lynxIcons.languageIds[languageId]
  return iconId ? lynxIcons.iconPaths[iconId] ?? '' : ''
}

function ProjectFileIcon({ path, icon: Icon, color }: { path?: string; icon: LucideIcon; color: string }) {
  const [failedPath, setFailedPath] = useState<string>()
  return path && failedPath !== path
    ? <img src={path} onError={() => setFailedPath(path)} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 object-contain" />
    : <Icon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />
}

function projectAbsolutePath(workRoot: string, relativePath: string) {
  const separator = workRoot.includes('\\') ? '\\' : '/'
  const root = workRoot.replace(/[\\/]+$/, '')
  const child = relativePath.replace(/[\\/]+/g, separator).replace(/^[\\/]+/, '')
  return child ? `${root}${separator}${child}` : root
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  async function copyPath(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch { setCopied(false) }
  }
  return <button type="button" onClick={copyPath} aria-label={tr("نسخ المسار: {{0}}", [path])} title={copied ? tr("تم نسخ المسار") : tr("نسخ المسار الكامل")} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
    {copied ? <Check className="h-3.5 w-3.5 text-ready" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
  </button>
}

function SearchModePicker({ value, onChange }: { value: 'name' | 'content'; onChange: (value: 'name' | 'content') => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const modes = ['name', 'content'] as const
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    options.current[value === 'name' ? 0 : 1]?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, value])
  return <div ref={root} className="relative h-7 w-10 shrink-0 border-s border-line" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() } }}>
    <button ref={trigger} type="button" aria-label={`${tr('طريقة البحث')}: ${tr(value === 'name' ? 'اسم الملف' : 'داخل الملفات')}`} title={tr('طريقة البحث')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(previous => !previous)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
      }} className={`flex h-full w-full items-center justify-center gap-0.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 ${open ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-card hover:text-ink'}`}>
      {value === 'name' ? <FileText className="h-3.5 w-3.5" aria-hidden="true" /> : <Code2 className="h-3.5 w-3.5" aria-hidden="true" />}<ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
    {open ? <div id={id} role="menu" aria-label={tr('طريقة البحث')} className="absolute end-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-card p-1.5 shadow-[0_12px_32px_rgba(20,28,40,0.18)]">
      <div className="px-2.5 pb-2 pt-1 text-[10px] font-semibold text-ink-soft">{tr('طريقة البحث')}</div>
      {modes.map((mode, index) => <button key={mode} ref={node => { options.current[index] = node }} type="button" role="menuitemradio" aria-checked={value === mode} tabIndex={-1}
        onClick={() => { onChange(mode); close() }} onKeyDown={event => {
          let next = index
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') next = 1 - index
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = 1
          else return
          event.preventDefault(); options.current[next]?.focus()
        }} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-start text-[11px] font-semibold outline-none transition-colors focus:bg-relay-tint hover:bg-relay-tint ${value === mode ? 'bg-relay-tint/60 text-relay-ink' : 'text-ink'}`}>
        {mode === 'name' ? <FileText className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" /> : <Code2 className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />}
        <span className="flex-1">{tr(mode === 'name' ? 'اسم الملف' : 'داخل الملفات')}</span>
        {value === mode ? <Check className="h-3.5 w-3.5 shrink-0 text-relay-ink" aria-hidden="true" /> : null}
      </button>)}
    </div> : null}
  </div>
}

function ProjectEntry({ entry, childrenByPath, loadingPaths, expandedPaths, iconTheme, workRoot, onToggle }: {
  entry: ProjectFileEntry
  childrenByPath: Record<string, ProjectFiles>
  loadingPaths: Set<string>
  expandedPaths: Set<string>
  iconTheme: 'lynx-style-a' | 'classic'
  workRoot: string
  onToggle: (entry: ProjectFileEntry) => void
}) {
  const directory = entry.kind === 'directory'
  const children = childrenByPath[entry.path]
  const loading = loadingPaths.has(entry.path)
  const isExpanded = expandedPaths.has(entry.path)
  const { icon: EntryIcon, color } = iconFor(entry, isExpanded, iconTheme)
  const iconPath = iconTheme === 'lynx-style-a' ? lynxIconPathFor(entry, isExpanded) : undefined
  return <li>
    {directory ? <div className="group/entry flex min-h-8 items-center gap-0.5 rounded-md pr-1 hover:bg-paper">
      <button type="button" onClick={() => onToggle(entry)} aria-expanded={isExpanded} title={entry.path}
      className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-start text-[11px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
      {loading ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-soft" /> : isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-soft" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
      <ProjectFileIcon path={iconPath} icon={EntryIcon} color={color} />
      <span dir="auto" className="min-w-0 truncate">{entry.name}</span>
      </button>
      <CopyPathButton path={projectAbsolutePath(workRoot, entry.path)} />
    </div> : <div title={entry.path} className="group/entry flex min-h-8 items-center gap-0.5 rounded-md pr-1 text-[11px] text-ink-soft hover:bg-paper">
      <span className="h-3.5 w-3.5 shrink-0" /><ProjectFileIcon path={iconPath} icon={EntryIcon} color={color} />
      <button type="button" onClick={() => openProjectFile(workRoot, entry.path)} className="min-w-0 flex-1 truncate rounded px-1 py-1.5 text-start hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40" title={entry.path}><span dir="auto">{entry.name}</span></button>
      <CopyPathButton path={projectAbsolutePath(workRoot, entry.path)} />
    </div>}
    {isExpanded && children ? <ul className="ms-3 border-s border-line ps-1.5">{children.entries.map(child => <ProjectEntry key={child.path} entry={child} childrenByPath={childrenByPath} loadingPaths={loadingPaths} expandedPaths={expandedPaths} iconTheme={iconTheme} workRoot={workRoot} onToggle={onToggle} />)}</ul> : null}
  </li>
}

export function ProjectExplorer({ workRoot }: { workRoot: string }) {
  const iconTheme = useFileIconTheme()
  const [directories, setDirectories] = useState<Record<string, ProjectFiles>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [loading, setLoading] = useState<Set<string>>(() => new Set(['']))
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'name' | 'content'>('name')
  const [contentMatches, setContentMatches] = useState<ProjectContentMatch[]>([])
  const [skippedFiles, setSkippedFiles] = useState(0)
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
      if (generation.current === requestGeneration) setError(failure instanceof Error ? failure.message : tr("تعذّر قراءة ملفات المشروع."))
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
    const term = query.trim()
    setSearchResults([]); setContentMatches([]); setSearchTruncated(false); setSkippedFiles(0)
    if (!term) { setSearching(false); return }
    let cancelled = false
    const controller = new AbortController()
    setSearching(true)
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        if (searchMode === 'content') {
          const result = await api.projectContentSearch(term, controller.signal)
          if (!cancelled) { setContentMatches(result.matches); setSearchTruncated(result.truncated); setSkippedFiles(result.skippedFiles) }
        } else {
          const result = await api.projectSearch(term)
          if (!cancelled) { setSearchResults(result.entries); setSearchTruncated(result.truncated) }
        }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : tr("تعذّر البحث في ملفات المشروع."))
      } finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer) }
  }, [query, workRoot, searchMode])
  function toggleDirectory(entry: ProjectFileEntry) {
    if (expanded.has(entry.path)) {
      setExpanded(current => { const next = new Set(current); next.delete(entry.path); return next })
      return
    }
    setExpanded(current => new Set(current).add(entry.path))
    if (!directories[entry.path] && !loading.has(entry.path)) void loadDirectory(entry.path)
  }
  const root = directories['']
  return <section aria-label={tr("ملفات المشروع")} className="flex min-h-0 flex-1 flex-col">
    {error ? <p role="alert" className="flex shrink-0 items-start gap-2 border-b border-line bg-review-tint px-3 py-2 text-[10px] leading-5 text-review-ink"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />{tr(error)}</p> : null}
    <div className="mx-2 mt-2 flex shrink-0 items-center gap-2 rounded-lg border border-line bg-paper ps-2.5 pe-1 focus-within:border-relay/50 focus-within:ring-2 focus-within:ring-relay/20">
      {searching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-ink-soft" aria-hidden="true" /> : <Search className="h-3.5 w-3.5 text-ink-soft" aria-hidden="true" />}
      <input value={query} onChange={event => setQuery(event.target.value)} maxLength={searchMode === 'content' ? 500 : undefined} placeholder={tr(searchMode === 'content' ? 'ابحث عن كلاس أو نص…' : 'ابحث باسم الملف…')} aria-label={tr(searchMode === 'content' ? 'البحث داخل الملفات' : 'ابحث باسم الملف')} className="h-9 min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-soft" />
      {query ? <button type="button" onClick={() => setQuery('')} aria-label={tr("مسح البحث")} className="rounded p-1 text-ink-soft hover:bg-card hover:text-ink"><X className="h-3.5 w-3.5" /></button> : null}
      <SearchModePicker value={searchMode} onChange={setSearchMode} />
    </div>
    <div dir="ltr" className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {query.trim() ? <>
        {searchMode === 'content' && contentMatches.length ? <ProjectContentResults matches={contentMatches} workRoot={workRoot} /> : searchMode === 'name' && searchResults.length ? <ul className="space-y-0.5">{searchResults.map(entry => <ProjectSearchResult key={entry.path} entry={entry} iconTheme={iconTheme} workRoot={workRoot} />)}</ul> : !searching ? <p className="px-3 py-6 text-center text-[11px] text-ink-soft">{tr("لا توجد نتائج مطابقة.")}</p> : null}
        {searching ? <p className="px-3 py-2 text-center text-[10px] text-ink-soft">{tr("جارٍ البحث في ملفات المشروع…")}</p> : null}
        {searchTruncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">{tr('تم عرض جزء من النتائج. اكتب بحثًا أدق لعرض الباقي.')}</p> : null}
        {searchMode === 'content' && skippedFiles > 0 ? <p className="px-3 py-2 text-[10px] text-ink-soft">{tr('تم تجاوز {{0}} ملف ثنائي أو كبير أو غير قابل للقراءة.', [skippedFiles])}</p> : null}
      </> : <>
      {loading.has('') && !root ? <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />{tr("جارٍ قراءة ملفات المشروع…")}</div> : null}
      {root?.entries.length ? <ul className="space-y-0.5">{root.entries.map(entry => <ProjectEntry key={entry.path} entry={entry} childrenByPath={directories} loadingPaths={loading} expandedPaths={expanded} iconTheme={iconTheme} workRoot={workRoot} onToggle={toggleDirectory} />)}</ul> : null}
      {root && root.entries.length === 0 ? <p className="px-3 py-6 text-center text-[11px] leading-5 text-ink-soft">{tr("المجلد ده فاضي لسه.")}</p> : null}
      {root?.truncated ? <p className="px-3 py-2 text-[10px] text-ink-soft">{tr("تم عرض أول 500 عنصر في هذا المجلد.")}</p> : null}
      </>}
    </div>
    <div className="shrink-0 border-t border-line px-3 py-2 text-[10px] text-ink-soft">{root ? tr("{{0}} عنصر", [root.entries.length]) : tr("مستكشف ملفات المشروع")}</div>
  </section>
}

function ProjectContentResults({ matches, workRoot }: { matches: ProjectContentMatch[]; workRoot: string }) {
  const groups = new Map<string, ProjectContentMatch[]>()
  matches.forEach(match => { const group = groups.get(match.path) ?? []; group.push(match); groups.set(match.path, group) })
  return <div>
    <p className="mb-2 px-2 text-[10px] text-ink-soft">{tr('{{0}} نتيجة في {{1}} ملف محفوظ', [matches.length, groups.size])}</p>
    <ul className="space-y-2">{Array.from(groups, ([filePath, results]) => <li key={filePath}>
      <div className="flex items-center gap-1 rounded-md bg-paper px-2 py-1"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-relay-ink" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink" title={filePath}>{filePath}</span><CopyPathButton path={projectAbsolutePath(workRoot, filePath)} /></div>
      <ul className="mt-1 space-y-0.5">{results.map(match => <li key={`${match.line}:${match.column}`}>
        <button type="button" onClick={() => openProjectFile(workRoot, match.path, match.line, match.column, match.matchLength)} title={`${match.path}:${match.line}:${match.column}`} className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-start font-mono text-[11px] hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
          <span className="min-w-5 shrink-0 text-ink-soft">{match.line}</span>
          <span className="min-w-0 truncate text-ink">{match.text.slice(0, match.matchStart)}<mark className="rounded-sm bg-review-tint text-review-ink">{match.text.slice(match.matchStart, match.matchStart + match.matchLength)}</mark>{match.text.slice(match.matchStart + match.matchLength)}</span>
        </button>
      </li>)}</ul>
    </li>)}</ul>
  </div>
}

function ProjectSearchResult({ entry, iconTheme, workRoot }: { entry: ProjectFileEntry; iconTheme: 'lynx-style-a' | 'classic'; workRoot: string }) {
  const { icon: Icon, color } = iconFor(entry, false, iconTheme)
  const iconPath = iconTheme === 'lynx-style-a' ? lynxIconPathFor(entry) : undefined
  return <li title={entry.path} className="group/entry flex min-h-8 items-center gap-1 rounded-md px-1 text-[11px] text-ink hover:bg-paper"><span className="h-3.5 w-3.5 shrink-0" /><ProjectFileIcon path={iconPath} icon={Icon} color={color} /><button type="button" onClick={() => openProjectFile(workRoot, entry.path)} className="min-w-0 flex-1 truncate rounded px-1 py-1.5 text-start hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40" title={entry.path}><span dir="auto">{entry.name}</span></button><code dir="ltr" className="ltr max-w-[40%] truncate text-[9px] text-ink-soft">{entry.path}</code><CopyPathButton path={projectAbsolutePath(workRoot, entry.path)} /></li>
}
