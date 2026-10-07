import { tr } from '../../lib/i18n'
import { FolderOpen, LoaderCircle, Square, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { clip, relativeTime } from '../../lib/format'
import type { Notify } from '../../hooks/useAgentAlerts'
import type { OpenCodeSession } from '../../lib/types'

export interface SessionBrowserProps {
  sessions: OpenCodeSession[]
  /** The folder of the conversation being read, so its project's sessions lead. */
  threadDirectory?: string
  /** The session this conversation is linked to, highlighted when it appears. */
  linkedSessionId?: string
  onNotify: Notify
  onRefresh: () => void
}

/** Running first, then this project's own, then newest activity. */
function order(sessions: OpenCodeSession[], threadDirectory?: string) {
  const target = threadDirectory?.toLowerCase()
  const inThread = (session: OpenCodeSession) => Boolean(target) && session.directory.toLowerCase() === target
  return [...sessions].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1
    const leftHere = inThread(left)
    const rightHere = inThread(right)
    if (leftHere !== rightHere) return leftHere ? -1 : 1
    return Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0)
  })
}

/**
 * The OpenCode sessions that belong to this project.
 *
 * Sessions can be started outside Relay Room or left over from earlier work, so
 * they are listed rather than hidden. Reading is always safe, and the only
 * action offered is stopping a session that is running right now: nothing else
 * here can be undone.
 */
export function SessionBrowser({ sessions, threadDirectory, linkedSessionId, onNotify, onRefresh }: SessionBrowserProps) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const ordered = order(sessions, threadDirectory)
  const visible = expanded ? ordered : ordered.slice(0, 5)
  const running = ordered.filter((session) => session.active).length
  const target = threadDirectory?.toLowerCase()

  async function stop(session: OpenCodeSession) {
    if (busy) return
    setBusy(session.id)
    try {
      await api.stopOpenCodeSession(session.id)
      onNotify(tr("أرسلنا طلب إيقاف OpenCode"), session.title)
      onRefresh()
    } catch (failure) {
      onNotify(tr("تعذّر إيقاف الجلسة"), failure instanceof Error ? failure.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function openFolder(session: OpenCodeSession) {
    if (busy) return
    setBusy(session.id)
    try {
      await api.openSessionFolder(session.id)
    } catch (failure) {
      onNotify(tr("تعذّر فتح مجلد الجلسة"), failure instanceof Error ? failure.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return <section aria-label={tr("جلسات OpenCode في هذا المشروع")} className="shrink-0 border-t border-line">
    <div className="flex items-center justify-between gap-2 px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
        <TerminalSquare className="h-3.5 w-3.5 text-ready" aria-hidden="true" />
        {tr("جلسات OpenCode")}<span className="font-normal text-ink-soft">({ordered.length})</span>
      </span>
      {running > 0 ? <span className="rounded bg-ready-tint px-1.5 py-0.5 text-[10px] font-bold text-ready-ink">{running} {' '}{tr("شغّالة")}</span> : null}
    </div>

    {ordered.length === 0 ? (
      <p className="px-4 pb-3 text-[11px] leading-5 text-ink-soft">{tr("لا توجد جلسات OpenCode لهذا المشروع بعد.")}</p>
    ) : (
      <ul className="thin-scroll max-h-56 overflow-y-auto px-2 pb-2">
        {visible.map((session) => {
          const here = Boolean(target) && session.directory.toLowerCase() === target
          const isLinked = session.id === linkedSessionId
          return <li key={session.id} className={cx('rounded-lg px-2 py-1.5', isLinked && 'bg-ready-tint/60')}>
            <div className="flex items-start gap-2">
              <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', session.active ? 'bg-ready' : 'bg-line-strong')} aria-label={session.active ? tr("شغّالة الآن") : tr("متوقفة")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold text-ink" title={session.title}>{clip(session.title, 44)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] text-ink-soft">{relativeTime(session.updatedAt)}</span>
                  {here ? <span className="rounded bg-relay-tint px-1 text-[9px] font-bold text-relay-ink">{tr("هذا المشروع")}</span> : null}
                  {isLinked ? <span className="rounded bg-ready-tint px-1 text-[9px] font-bold text-ready-ink">{tr("مرتبطة")}</span> : null}
                  {session.model ? <code dir="ltr" className="ltr truncate text-[9px] text-ink-soft" title={session.model}>{session.model}</code> : null}
                </span>
              </span>
              {session.active ? (
                <button
                  type="button"
                  onClick={() => void stop(session)}
                  disabled={busy === session.id}
                  title={tr("أوقف هذه الجلسة")}
                  aria-label={tr("أوقف جلسة {{0}}", [session.title])}
                  className="mt-0.5 shrink-0 rounded p-1 text-review transition-colors hover:bg-review-tint disabled:opacity-55"
                >
                  {busy === session.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Square className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              ) : null}
              {session.directory ? (
                <button
                  type="button"
                  onClick={() => void openFolder(session)}
                  disabled={busy === session.id}
                  title={tr("افتح {{0}}", [session.directory])}
                  aria-label={tr("افتح مجلد {{0}}", [session.directory])}
                  className="mt-0.5 shrink-0 rounded p-1 text-ink-soft transition-colors hover:text-relay disabled:opacity-55"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </li>
        })}
      </ul>
    )}

    {ordered.length > 5 ? (
      <button type="button" onClick={() => setExpanded((value) => !value)} className="w-full border-t border-line px-4 py-2 text-[10px] font-bold text-relay-ink transition-colors hover:bg-relay-tint">
        {expanded ? tr("اعرض أقل") : tr("اعرض كل الجلسات ({{0}})", [ordered.length])}
      </button>
    ) : null}
  </section>
}
