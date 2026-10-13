import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Code2, RefreshCw, Save, Send, X } from 'lucide-react'
import { api } from '../lib/api'
import { useLocale } from '../lib/i18n'

export type FileTab = { path: string; content: string; saved: string; version: string }
const CodeEditor = lazy(() => import('./CodeEditorView'))
export interface CodeEditorHandle { focus: () => void; measure: () => void; gotoLine: (line: number, column?: number, length?: number) => void; position: () => { line: number; column: number }; selection: () => { text: string; startLine: number; endLine: number } }
export function openProjectFile(root: string, path: string, line?: number, column?: number, matchLength?: number) {
  window.dispatchEvent(new CustomEvent('coding-room:open-file', { detail: { root, path, line, column, matchLength } }))
}

export function ProjectEditor({ root, children, onInsert }: { root?: string; children: ReactNode; onInsert: (text: string) => void }) {
  const ar = useLocale() === 'ar'
  const [tabs, setTabs] = useState<FileTab[]>([]), [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState('')
  const [position, setPosition] = useState({ line: 1, column: 1 }), [goTo, setGoTo] = useState('')
  const tabsRef = useRef(tabs), views = useRef(new Map<string, CodeEditorHandle>()), opening = useRef(new Set<string>()), generation = useRef(0)
  const previousRoot = useRef(root)
  const cachedTabs = useRef(new Map<string, FileTab[]>())
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const targets = useRef(new Map<string, { line: number; column?: number; length?: number }>())
  const reveal = useCallback((path: string, view: CodeEditorHandle) => {
    const target = targets.current.get(path)
    if (target && selectedRef.current === path) {
      view.measure(); view.gotoLine(target.line, target.column, target.length)
      targets.current.delete(path)
    }
  }, [])
  tabsRef.current = tabs
  const file = tabs.find(tab => tab.path === selected)
  useEffect(() => {
    if (previousRoot.current) cachedTabs.current.set(previousRoot.current, tabsRef.current)
    previousRoot.current = root
    generation.current++
    targets.current.clear()
    setTabs(root ? cachedTabs.current.get(root) || [] : [])
    setSelected(''); setError(''); setLoading(false); setBusy(''); opening.current.clear()
  }, [root])
  useEffect(() => {
    if (!selected) return
    const timer = requestAnimationFrame(() => {
      const view = views.current.get(selected)
      if (view) { view.measure(); reveal(selected, view); setPosition(view.position()); view.focus() }
    })
    return () => cancelAnimationFrame(timer)
  }, [selected])
  useEffect(() => {
    const open = async (event: Event) => {
      const input = (event as CustomEvent<{ root: string; path: string; line?: number; column?: number; matchLength?: number }>).detail
      if (!root || input.root !== root) return
      if (input.line) targets.current.set(input.path, { line: input.line, column: input.column, length: input.matchLength })
      if (tabsRef.current.some(tab => tab.path === input.path)) {
        setSelected(input.path)
        requestAnimationFrame(() => { const view = views.current.get(input.path); if (view) reveal(input.path, view) })
        return
      }
      if (opening.current.has(input.path)) return
      if (tabsRef.current.length >= 12) { setError(ar ? 'أغلق تبويبًا قبل فتح ملف آخر.' : 'Close a tab before opening another file.'); return }
      const current = generation.current
      opening.current.add(input.path); setLoading(true); setError('')
      try {
        const result = await api.projectFile(root, input.path)
        if (current !== generation.current) return
        setTabs(previous => previous.some(tab => tab.path === result.path) ? previous : [...previous, { ...result, saved: result.content }])
        setSelected(result.path)
      } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : String(failure)) }
      finally { if (current === generation.current) { opening.current.delete(input.path); setLoading(opening.current.size > 0) } }
    }
    window.addEventListener('coding-room:open-file', open)
    return () => window.removeEventListener('coding-room:open-file', open)
  }, [root, ar])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if ([tabsRef.current, ...Array.from(cachedTabs.current).filter(([key]) => key !== previousRoot.current).map(([, files]) => files)].some(files => files.some(tab => tab.content !== tab.saved))) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [])
  const change = useCallback((path: string, content: string) => setTabs(previous => previous.map(tab => tab.path === path ? { ...tab, content } : tab)), [])
  async function save(path: string) {
    const tab = tabsRef.current.find(item => item.path === path)
    if (!tab || !root || busy) return
    const current = generation.current
    setBusy(path); setError('')
    try {
      const result = await api.saveProjectFile({ root, path, content: tab.content, version: tab.version })
      if (current === generation.current) setTabs(previous => previous.map(item => item.path === path ? { ...item, saved: result.content, version: result.version } : item))
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (current === generation.current) setBusy('') }
  }
  async function reload() {
    if (!file || !root || busy) return
    if (file.content !== file.saved && !window.confirm(ar ? 'إلغاء تعديلات المسودة وإعادة قراءة الملف؟' : 'Discard draft edits and reload the file?')) return
    const path = file.path, current = generation.current
    setBusy(path); setError('')
    try { const result = await api.projectFile(root, path); if (current === generation.current) setTabs(previous => previous.map(tab => tab.path === path ? { ...result, saved: result.content } : tab)) }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (current === generation.current) setBusy('') }
  }
  function close(path: string) {
    const tab = tabs.find(item => item.path === path)
    if (tab && tab.content !== tab.saved && !window.confirm(ar ? 'إغلاق الملف وإلغاء التعديلات غير المحفوظة؟' : 'Close this file and discard unsaved changes?')) return
    setTabs(previous => previous.filter(item => item.path !== path))
    if (selected === path) setSelected(tabs.filter(item => item.path !== path).slice(-1)[0]?.path || '')
  }
  function insert() {
    const view = views.current.get(selected)
    if (!file || !view) return
    const selection = view.selection()
    const content = selection.text
    if (content.length > 24000) { setError(ar ? 'حدد جزءًا أصغر من الكود لإضافته للشات.' : 'Select a smaller code snippet to add to chat.'); return }
    const start = selection.startLine
    const end = selection.endLine
    const separator = root?.includes('\\') ? '\\' : '/'
    const absolute = `${root?.replace(/[\\/]+$/, '')}${separator}${file.path.replace(/\//g, separator)}`
    const fence = '`'.repeat(Math.max(3, ...Array.from(content.matchAll(/`+/g), match => match[0].length + 1)))
    const lang = file.path.split('.').pop() || ''
    onInsert(`${absolute} (lines ${start}-${end}${file.content !== file.saved ? ', unsaved editor draft' : ''})\n\n${fence}${lang}\n${content}\n${fence}`)
    setSelected('')
  }
  return <div className="flex min-h-[22rem] min-w-0 flex-col overflow-hidden bg-card lg:h-full lg:min-h-0">
    <><div role="tablist" aria-label={ar ? 'تبويبات مساحة العمل' : 'Workspace tabs'} className={tabs.length ? 'chat-tabs flex shrink-0 overflow-x-auto border-b border-line bg-paper' : 'hidden'}>
      <button role="tab" aria-label={ar ? 'العودة للمحادثة' : 'Back to conversation'} aria-selected={!selected} onClick={() => setSelected('')} className={`inline-flex shrink-0 items-center justify-center border-b-2 px-4 py-3 text-xs font-semibold ${!selected ? 'border-relay text-relay-ink' : 'border-transparent text-ink-soft'}`}>Agent</button>
      {tabs.map(tab => <div key={tab.path} className={`flex shrink-0 items-center border-b-2 ${selected === tab.path ? 'border-relay bg-card' : 'border-transparent'}`}><button role="tab" aria-selected={selected === tab.path} title={tab.path} onClick={() => { setSelected(tab.path); setGoTo('') }} className="inline-flex items-center gap-2 px-3 py-3 text-xs"><Code2 className="h-3.5 w-3.5 text-relay-ink" />{tab.path.split('/').pop()}{tab.content !== tab.saved && <span aria-label={ar ? 'تعديلات غير محفوظة' : 'Unsaved edits'} className="h-1.5 w-1.5 rounded-full bg-review" />}</button><button disabled={Boolean(busy)} aria-label={`${ar ? 'إغلاق' : 'Close'} ${tab.path}`} onClick={() => close(tab.path)} className="me-2 rounded p-1 text-ink-soft hover:bg-paper"><X className="h-3 w-3" /></button></div>)}
      {loading && <RefreshCw className="m-3 h-4 w-4 shrink-0 animate-spin text-ink-soft" />}
    </div>{error && <p role="alert" className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-review-tint px-4 py-2 text-xs text-review-ink">{error}<button onClick={() => setError('')} aria-label={ar ? 'إخفاء الخطأ' : 'Dismiss error'}><X className="h-3 w-3" /></button></p>}</>
    <div className={selected ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>{children}</div>
    {file && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <button disabled={Boolean(busy) || file.content === file.saved} onClick={() => void save(file.path)} className="inline-flex items-center gap-1.5 rounded-md bg-relay px-3 py-2 text-xs font-bold text-on-accent disabled:opacity-40"><Save className="h-3.5 w-3.5" />{ar ? 'حفظ' : 'Save'}</button>
      <button disabled={Boolean(busy)} onClick={() => void reload()} className="rounded-md border border-line p-2 text-ink-soft" title={ar ? 'إعادة تحميل الملف' : 'Reload file'} aria-label={ar ? 'إعادة تحميل الملف' : 'Reload file'}><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /></button>
      <button onClick={insert} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-bold text-relay-ink"><Send className="h-3.5 w-3.5" />{ar ? 'أضف الكود للشات' : 'Add code to chat'}</button>
      <form onSubmit={event => { event.preventDefault(); const view = views.current.get(selected); if (!view) return; view.gotoLine(Number(goTo) || 1) }} className="ms-auto flex items-center gap-1"><input aria-label={ar ? 'رقم السطر' : 'Line number'} type="number" min={1} value={goTo} onChange={event => setGoTo(event.target.value)} placeholder={ar ? 'سطر' : 'Line'} className="w-20 rounded-md border border-line bg-paper px-2 py-1.5 text-xs" /><button className="rounded-md border border-line px-2 py-1.5 text-xs">{ar ? 'انتقل' : 'Go'}</button></form>
    </div>}
    {tabs.map(tab => <div key={tab.path} className={selected === tab.path ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}><Suspense fallback={<div className="p-5 text-sm text-ink-soft">Loading editor...</div>}><CodeEditor file={tab} register={view => { if (view) { views.current.set(tab.path, view); reveal(tab.path, view) } else views.current.delete(tab.path) }} onChange={content => change(tab.path, content)} onSave={() => void save(tab.path)} onPosition={(line, column) => { if (selected === tab.path) setPosition({ line, column }) }} /></Suspense></div>)}
    {file && <footer className="flex shrink-0 justify-between gap-3 border-t border-line px-3 py-2 text-[10px] text-ink-soft"><span dir="ltr" className="truncate" title={file.path}>{file.path}</span><span className="shrink-0">Ln {position.line}, Col {position.column} · UTF-8{file.content !== file.saved ? (ar ? ' · مسودة' : ' · Draft') : ''}</span></footer>}
  </div>
}
