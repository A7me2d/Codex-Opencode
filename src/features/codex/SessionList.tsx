import { FolderOpen, FolderTree, LoaderCircle, MessageCircleMore, PanelLeft, Plus } from 'lucide-react'
import { StateDot } from '../../components/ui/StateDot'
import { cx } from '../../lib/cx'
import { clip, relativeTime } from '../../lib/format'
import type { CodexThread } from '../../lib/types'

export interface SessionListProps {
  threads: CodexThread[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  creating: boolean
  connected: boolean
  projectDirectory?: string
  /** The project sessions work in; often not where this app is installed. */
  workRoot?: string
  onOpenProject: () => void
  onOpenWorkRoot: () => void
  onOpenThreadFolder: (threadId: string) => void
  openingProject: boolean
}

/** Left column: the Codex conversations Relay Room owns, plus the project scope. */
export function SessionList({ threads, selectedId, onSelect, onCreate, creating, connected, projectDirectory, workRoot, onOpenProject, onOpenWorkRoot, onOpenThreadFolder, openingProject }: SessionListProps) {
  const projectCount = threads.filter((thread) => thread.inProject).length
  const externalCount = threads.length - projectCount
  return (
    <aside dir="rtl" className="flex min-h-[14rem] flex-col border-b border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <PanelLeft className="h-4 w-4 text-relay" aria-hidden="true" /> جلسات Codex
        </div>
        <button type="button" onClick={onCreate} disabled={!connected || creating} className="inline-flex items-center gap-1.5 rounded-lg bg-relay px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45">
          {creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          محادثة
        </button>
      </div>

      <div className="shrink-0 border-b border-line px-4 py-3 text-xs text-ink-soft">
        <div className="flex items-center gap-2">
          <StateDot active={connected} warning={!connected} />
          {connected ? 'مرتبطة بـ Codex Desktop المحلي' : 'تعذر الاتصال بـ Codex Desktop'}
        </div>
      </div>

      <div className="shrink-0 border-b border-line p-3">
        {/* Two different folders, both worth reaching: the project sessions
            run in, and the folder this app's own code lives in. */}
        <button type="button" onClick={onOpenWorkRoot} disabled={openingProject} className="flex w-full items-center gap-2 rounded-lg border border-relay/30 bg-relay-tint/60 px-3 py-2.5 text-right text-xs text-ink transition-colors hover:border-relay/50 hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-55" aria-label="فتح مجلد المشروع الذي تعمل عليه">
          {openingProject ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-relay" aria-hidden="true" /> : <FolderTree className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            <span className="block font-bold">افتح مجلد المشروع</span>
            {workRoot
              ? <code dir="ltr" className="ltr mt-0.5 block truncate text-[10px] font-normal text-ink-soft" title={workRoot}>{workRoot}</code>
              : <span className="mt-0.5 block text-[10px] text-ink-soft">يتم تحديد المسار…</span>}
          </span>
        </button>

        <button type="button" onClick={onOpenProject} disabled={openingProject} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-right text-[11px] text-ink-soft transition-colors hover:border-line/70 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-55" aria-label="فتح مجلد كود Relay Room في مستكشف الملفات">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">مجلد كود Relay Room</span>
            {projectDirectory
              ? <code dir="ltr" className="ltr block truncate text-[10px]" title={projectDirectory}>{projectDirectory}</code>
              : null}
          </span>
        </button>
      </div>

      <nav aria-label="جلسات Codex" className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs leading-6 text-ink-soft">
            لا توجد جلسات Codex على هذا الجهاز بعد.<br />ابدأ محادثة لكي تظهر في هذه القائمة.
          </div>
        ) : (
          <ul className="space-y-1">
            {threads.map((thread) => {
              const selected = thread.id === selectedId
              const title = thread.title ?? thread.name ?? 'محادثة جديدة'
              return <li key={thread.id} className="group/item relative">
                <button type="button" onClick={() => onSelect(thread.id)} aria-current={selected ? 'true' : undefined} className={cx('w-full rounded-lg px-3 py-2.5 text-right transition-colors', selected ? 'bg-relay-tint text-relay-ink' : 'text-ink hover:bg-paper')}>
                  <span className="flex items-start gap-2">
                    <MessageCircleMore className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-relay' : 'text-ink-soft')} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold">{clip(title, 46)}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className={cx('text-[10px]', selected ? 'text-relay-ink/75' : 'text-ink-soft')}>{relativeTime(thread.updatedAt)}</span>
                        {thread.active ? <StateDot active /> : null}
                        {thread.inProject
                          ? <span className="rounded bg-relay-tint px-1 text-[9px] font-bold text-relay-ink">المشروع</span>
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
                        title={`افتح ${thread.directory}`}
                        aria-label={`افتح مجلد الجلسة ${thread.directory}`}
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
      </nav>

      <div className="shrink-0 border-t border-line px-4 py-3 text-[10px] leading-5 text-ink-soft">
        كل جلسات Codex على هذا الجهاز: <span className="font-bold text-ink-soft">{projectCount}</span> في هذا المشروع
        {externalCount > 0 ? <> و <span className="font-bold text-ink-soft">{externalCount}</span> من مشاريع أخرى</> : null}.
        الفتح يسجّل الجلسة هنا تلقائيًا.
      </div>
    </aside>
  )
}
