import { direction, tr } from '../../lib/i18n'
import { useEffect, useState } from 'react'
import { FolderOpen, FolderTree, LoaderCircle, MessageCircleMore, PanelLeft, Plus } from 'lucide-react'
import { StateDot } from '../../components/ui/StateDot'
import { cx } from '../../lib/cx'
import { clip, relativeTime } from '../../lib/format'
import type { CodexThread } from '../../lib/types'
import { ProjectExplorer } from './ProjectExplorer'

export interface SessionListProps {
  collapsed: boolean
  onToggle: () => void
  threads: CodexThread[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  creating: boolean
  connected: boolean
  /** The project sessions work in; often not where this app is installed. */
  workRoot?: string
  onChooseWorkRoot: () => void
  onOpenThreadFolder: (threadId: string) => void
  choosingWorkRoot: boolean
}

/** Left column: the Codex conversations Relay Room owns, plus the project scope. */
export function SessionList({ collapsed, onToggle, threads, selectedId, onSelect, onCreate, creating, connected, workRoot, onChooseWorkRoot, onOpenThreadFolder, choosingWorkRoot }: SessionListProps) {
  const [view, setView] = useState<'files' | 'chats'>('files')
  useEffect(() => { setView('files') }, [workRoot])
  const toggle = <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? tr("إظهار جلسات Codex") : tr("إخفاء جلسات Codex")} title={collapsed ? tr("إظهار جلسات Codex") : tr("إخفاء جلسات Codex")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
    <PanelLeft className="h-4 w-4" aria-hidden="true" />
  </button>
  if (collapsed) return <aside dir={direction()} className="flex items-start justify-center border-b border-line bg-card py-2 lg:border-b-0 lg:border-r">
    {toggle}
  </aside>
  return (
    <aside dir={direction()} className="flex min-h-[14rem] flex-col border-b border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          {toggle} {tr("جلسات Codex")}</div>
        <button type="button" onClick={onCreate} disabled={!connected || creating} className="inline-flex items-center gap-1.5 rounded-lg bg-relay px-2.5 py-1.5 text-xs font-bold text-on-accent transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45">
          {creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          {tr("محادثة")}</button>
      </div>

      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="mb-3 flex items-center gap-2 text-[10px] text-ink-soft">
          <StateDot active={connected} warning={!connected} />
          <span>{connected ? tr("Codex Desktop متصل") : tr("Codex Desktop غير متصل")}</span>
        </div>
        <button type="button" onClick={onChooseWorkRoot} disabled={choosingWorkRoot}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-relay/25 bg-relay-tint/60 px-3 py-2 text-xs font-bold text-relay-ink transition-colors hover:border-relay/50 hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-not-allowed disabled:opacity-55">
          {choosingWorkRoot ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FolderOpen className="h-4 w-4" aria-hidden="true" />}
          {choosingWorkRoot ? tr("جارٍ اختيار المشروع…") : tr("فتح مجلد مشروع جديد")}
        </button>
        <div className="mt-3 flex items-start gap-2 px-1">
          <FolderTree className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span className="block text-[10px] text-ink-soft">{tr("المشروع الحالي")}</span>
            {workRoot ? <>
              <span dir="auto" className="mt-0.5 block truncate text-xs font-semibold text-ink">{workRoot.split(/[\\/]/).filter(Boolean).slice(-1)[0] || workRoot}</span>
              <code dir="ltr" className="ltr mt-1 block truncate text-[10px] text-ink-soft" title={workRoot}>{workRoot}</code>
            </> : <span className="mt-1 block text-[11px] text-ink-soft">{tr("جارٍ تحديد المجلد…")}</span>}
          </div>
        </div>
      </div>

      <div role="tablist" aria-label={tr("محتوى المشروع")} className="grid shrink-0 grid-cols-2 gap-1 border-b border-line px-3 py-2">
        <button type="button" role="tab" aria-selected={view === 'files'} onClick={() => setView('files')} className={cx('rounded-lg px-3 py-2 text-[11px] font-bold transition-colors', view === 'files' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}>{tr("الملفات")}</button>
        <button type="button" role="tab" aria-selected={view === 'chats'} onClick={() => setView('chats')} className={cx('rounded-lg px-3 py-2 text-[11px] font-bold transition-colors', view === 'chats' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}>{tr("محادثات المشروع (")}{threads.length})</button>
      </div>

      {view === 'files' && workRoot ? <ProjectExplorer key={workRoot.toLowerCase()} workRoot={workRoot} /> : null}
      {view === 'files' && !workRoot ? <div className="flex-1 px-3 py-6 text-center text-xs text-ink-soft">{tr("اختَر مجلد مشروع لعرض ملفاته هنا.")}</div> : null}
      {view === 'chats' ? <nav aria-label={tr("محادثات المشروع")} className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs leading-6 text-ink-soft">
            {tr("لا توجد محادثات لهذا المشروع بعد.")}<br />{tr("ابدأ محادثة جديدة وستظهر هنا.")}</div>
        ) : (
          <ul className="space-y-1">
            {threads.map((thread) => {
              const selected = thread.id === selectedId
              const title = thread.title ?? thread.name ?? tr("محادثة جديدة")
              return <li key={thread.id} className="group/item relative">
                <button type="button" onClick={() => onSelect(thread.id)} aria-current={selected ? 'true' : undefined} className={cx('w-full rounded-lg px-3 py-2.5 text-start transition-colors', selected ? 'bg-relay-tint text-relay-ink' : 'text-ink hover:bg-paper')}>
                  <span className="flex items-start gap-2">
                    <MessageCircleMore className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-relay' : 'text-ink-soft')} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold">{clip(title, 46)}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className={cx('text-[10px]', selected ? 'text-relay-ink/75' : 'text-ink-soft')}>{relativeTime(thread.updatedAt)}</span>
                        {thread.active ? <StateDot active /> : null}
                        {thread.inProject
                          ? <span className="rounded bg-relay-tint px-1 text-[9px] font-bold text-relay-ink">{tr("المشروع")}</span>
                          : thread.directory
                            ? <code dir="ltr" className="ltr truncate text-[9px] text-ink-soft" title={thread.directory}>{clip(thread.directory, 22)}</code>
                            : null}
                      </span>
                    </span>
                    {/* Reach the folder this session belongs to, even when it is
                        a different project than the one being watched. */}
                    {thread.directory ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); onOpenThreadFolder(thread.id) }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onOpenThreadFolder(thread.id) }
                        }}
                        title={tr("افتح {{0}}", [thread.directory])}
                        aria-label={tr("افتح مجلد الجلسة {{0}}", [thread.directory])}
                        className="mt-0.5 shrink-0 rounded p-1 text-ink-soft opacity-0 transition-opacity hover:text-relay focus:opacity-100 group-hover/item:opacity-100"
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            })}
          </ul>
        )}
      </nav> : null}

      <div className="shrink-0 border-t border-line px-4 py-3 text-[10px] leading-5 text-ink-soft">
        {threads.length} {tr("محادثة مرتبطة بالمشروع الحالي.")}</div>
    </aside>
  )
}
