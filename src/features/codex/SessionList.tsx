import { openSupport } from '../../components/SupportChat'
import { direction, tr } from '../../lib/i18n'
import { useEffect, useState } from 'react'
import { FolderOpen, FolderTree, LoaderCircle, MessageCircleMore, PanelLeft, Plus } from 'lucide-react'
import { AccountAvatar } from '../../components/AccountAvatar'
import { accountIdentity } from '../../lib/accountIdentity'
import { StateDot } from '../../components/ui/StateDot'
import { cx } from '../../lib/cx'
import { clip, relativeTime } from '../../lib/format'
import type { CodexThread } from '../../lib/types'
import { ProjectExplorer } from './ProjectExplorer'
import { ConversationActions } from '../../components/ConversationActions'

export interface SessionListProps {
  collapsed: boolean
  onToggle: () => void
  threads: CodexThread[]
  archivedThreads: CodexThread[]
  showArchived: boolean
  archivedLoading: boolean
  archivedError: string | null
  onShowArchived: (value: boolean) => void
  onRename: (id: string, title: string) => Promise<unknown>
  onArchive: (id: string) => Promise<unknown>
  onRestore: (id: string) => Promise<unknown>
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
  codexIdentity?: string
}

/** Left column: the Codex conversations Open Zero owns, plus the project scope. */
export function SessionList({ collapsed, onToggle, threads, archivedThreads, showArchived, archivedLoading, archivedError, onShowArchived, onRename, onArchive, onRestore, selectedId, onSelect, onCreate, creating, connected, workRoot, onChooseWorkRoot, onOpenThreadFolder, choosingWorkRoot, codexIdentity }: SessionListProps) {
  const [view, setView] = useState<'files' | 'chats'>('files')
  const visibleThreads = showArchived ? archivedThreads : threads
  useEffect(() => { setView('files') }, [workRoot])
  const { name: accountName } = accountIdentity(codexIdentity)
  const toggle = <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? tr("إظهار جلسات Codex") : tr("إخفاء جلسات Codex")} title={collapsed ? tr("إظهار جلسات Codex") : tr("إخفاء جلسات Codex")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
    <PanelLeft className="h-4 w-4" aria-hidden="true" />
  </button>
  if (collapsed) return <aside dir={direction()} className="flex flex-col items-center gap-2 border-b border-line bg-card py-2 lg:h-full lg:border-b-0 lg:border-r">
    {toggle}
    <button type="button" onClick={() => openSupport(accountName)} aria-label="Support chat" title={tr("Codex account")} className="mt-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-relay-tint text-[10px] font-extrabold text-relay-ink ring-1 ring-inset ring-relay/15">
        <AccountAvatar identity={codexIdentity} />
    </button>
  </aside>
  return (
    <aside dir={direction()} className="flex min-h-[14rem] flex-col border-b border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          {toggle}</div>
        <button type="button" onClick={onCreate} disabled={!connected || creating} className="inline-flex items-center gap-1.5 rounded-lg bg-relay px-2.5 py-1.5 text-xs font-bold text-on-accent transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45">
          {creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          {tr("محادثة")}</button>
      </div>

      <div className="shrink-0 border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {workRoot ? <>
              <span dir="auto" title={workRoot} className="block truncate text-xs font-semibold text-ink">{workRoot.split(/[\\/]/).filter(Boolean).slice(-1)[0] || workRoot}</span>
            </> : <span className="block text-[11px] text-ink-soft">{tr("جارٍ تحديد المجلد…")}</span>}
          </div>
          <button type="button" onClick={onChooseWorkRoot} disabled={choosingWorkRoot}
            aria-label={choosingWorkRoot ? tr('جارٍ اختيار المشروع…') : tr('فتح مجلد مشروع جديد')}
            title={choosingWorkRoot ? tr('جارٍ اختيار المشروع…') : tr('فتح مجلد مشروع جديد')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-wait disabled:opacity-55">
            {choosingWorkRoot ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FolderOpen className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-line px-3 py-2">
        <div role="tablist" aria-label={tr('محتوى المشروع')} className="grid grid-cols-2 gap-1 rounded-full border border-line bg-paper p-1">
          {(['files', 'chats'] as const).map(value => <button key={value} type="button" role="tab" id={`project-tab-${value}`} aria-controls={`project-panel-${value}`} aria-selected={view === value} tabIndex={view === value ? 0 : -1}
            aria-label={tr(value === 'files' ? 'الملفات' : 'محادثات المشروع')} onClick={() => setView(value)} onKeyDown={event => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const next = value === 'files' ? 'chats' : 'files'
              setView(next); document.getElementById(`project-tab-${next}`)?.focus()
            }} className={cx('inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40', view === value ? 'bg-card text-relay-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:text-ink')}>
            {tr(value === 'files' ? 'الملفات' : 'المحادثات')}
            {value === 'chats' ? <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-relay-tint px-1 text-[9px] leading-4 tabular-nums text-relay-ink">{threads.length}</span> : null}
          </button>)}
        </div>
      </div>

      {view === 'files' ? <div id="project-panel-files" role="tabpanel" aria-labelledby="project-tab-files" className="flex min-h-0 flex-1 flex-col">
        {workRoot ? <ProjectExplorer key={workRoot.toLowerCase()} workRoot={workRoot} /> : <div className="flex-1 px-3 py-6 text-center text-xs text-ink-soft">{tr("اختَر مجلد مشروع لعرض ملفاته هنا.")}</div>}
      </div> : null}
      {view === 'chats' ? <nav id="project-panel-chats" role="tabpanel" aria-labelledby="project-tab-chats" className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-2 flex gap-1">
          <button type="button" aria-pressed={!showArchived} onClick={() => onShowArchived(false)} className={cx('flex-1 rounded-lg px-2 py-2 text-[10px] font-bold', !showArchived ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}>{tr('المحادثات الحالية')}</button>
          <button type="button" aria-pressed={showArchived} onClick={() => onShowArchived(true)} className={cx('flex-1 rounded-lg px-2 py-2 text-[10px] font-bold', showArchived ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}>{tr('المؤرشفة')}</button>
        </div>
        {showArchived && archivedLoading ? <p role="status" className="flex justify-center p-3"><LoaderCircle className="h-4 w-4 animate-spin" /></p> : null}
        {showArchived && archivedError ? <p role="alert" className="p-3 text-xs text-review-ink">{tr(archivedError)}</p> : null}
        {visibleThreads.length === 0 && !(showArchived && (archivedLoading || archivedError)) ? (
          <div className="px-3 py-6 text-center text-xs leading-6 text-ink-soft">
            {tr(showArchived ? 'لا توجد محادثات مؤرشفة لهذا المشروع.' : 'لا توجد محادثات لهذا المشروع بعد.')}<br />{!showArchived ? tr('ابدأ محادثة جديدة وستظهر هنا.') : null}</div>
        ) : (
          <ul className="space-y-1">
            {visibleThreads.map((thread) => {
              const selected = thread.id === selectedId
              const title = thread.title ?? thread.name ?? tr("محادثة جديدة")
              return <li key={thread.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] rounded-lg', selected && !showArchived && 'bg-relay-tint')}>
                <button type="button" disabled={showArchived} onClick={() => onSelect(thread.id)} aria-current={selected && !showArchived ? 'true' : undefined} title={title} className={cx('min-w-0 rounded-lg px-3 py-2.5 text-start transition-colors', selected && !showArchived ? 'text-relay-ink' : 'text-ink hover:bg-paper')}>
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
                  </span>
                </button>
                <ConversationActions title={title} archived={showArchived} running={thread.running}
                  onRename={name => onRename(thread.id, name)} onArchive={() => onArchive(thread.id)} onRestore={() => onRestore(thread.id)}
                  onOpenFolder={thread.directory && !showArchived ? () => onOpenThreadFolder(thread.id) : undefined} />
              </li>
            })}
          </ul>
        )}
      </nav> : null}

      <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-4 py-3">
        <button type="button" aria-label="Support chat" onClick={() => openSupport(accountName)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-relay-tint text-[10px] font-extrabold text-relay-ink ring-1 ring-inset ring-relay/15">
          <AccountAvatar identity={codexIdentity} />
        </button>
        <span dir="auto" className="min-w-0 truncate text-xs font-semibold text-ink" title={accountName || tr("Codex Desktop")}>
          {accountName || tr("Codex Desktop")}
        </span>
      </div>
    </aside>
  )
}
