import { FolderOpen, LoaderCircle, MessageCircleMore, PanelLeft, Plus } from 'lucide-react'
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
  onOpenProject: () => void
  openingProject: boolean
}

/** Left column: the Codex conversations Relay Room owns, plus the project scope. */
export function SessionList({ threads, selectedId, onSelect, onCreate, creating, connected, projectDirectory, onOpenProject, openingProject }: SessionListProps) {
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
        <button type="button" onClick={onOpenProject} disabled={openingProject} className="flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2.5 text-right text-xs text-ink transition-colors hover:border-relay/35 hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-55" aria-label="فتح مجلد المشروع في مستكشف الملفات">
          {openingProject ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-relay" aria-hidden="true" /> : <FolderOpen className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            <span className="block font-bold">فتح ملفات المشروع</span>
            {projectDirectory
              ? <code dir="ltr" className="ltr mt-0.5 block truncate text-[10px] font-normal text-ink-soft" title={projectDirectory}>{projectDirectory}</code>
              : <span className="mt-0.5 block text-[10px] text-ink-soft">يتم تحديد المسار…</span>}
          </span>
        </button>
      </div>

      <nav aria-label="جلسات Codex" className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs leading-6 text-ink-soft">
            لا توجد جلسات هنا بعد.<br />ابدأ محادثة لكي تظهر في هذه القائمة.
          </div>
        ) : (
          <ul className="space-y-1">
            {threads.map((thread) => {
              const selected = thread.id === selectedId
              const title = thread.title ?? thread.name ?? 'محادثة جديدة'
              return <li key={thread.id}>
                <button type="button" onClick={() => onSelect(thread.id)} aria-current={selected ? 'true' : undefined} className={cx('w-full rounded-lg px-3 py-3 text-right transition-colors', selected ? 'bg-relay-tint text-relay-ink' : 'text-ink hover:bg-paper')}>
                  <span className="flex items-start gap-2">
                    <MessageCircleMore className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-relay' : 'text-ink-soft')} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold">{clip(title, 52)}</span>
                      <span className={cx('mt-1 block text-[10px]', selected ? 'text-relay-ink/75' : 'text-ink-soft')}>{relativeTime(thread.updatedAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            })}
          </ul>
        )}
      </nav>

      <div className="shrink-0 border-t border-line px-4 py-3 text-[10px] leading-5 text-ink-soft">
        تظهر هنا الجلسات التي أنشأها Relay Room فقط، حتى لا تختلط مع محادثاتك الأخرى.
      </div>
    </aside>
  )
}
