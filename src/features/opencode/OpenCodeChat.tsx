import { tr } from '../../lib/i18n'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, CircleStop, Plus, Send } from 'lucide-react'
import { Spinner } from '../../components/ui/Spinner'
import { MessageBubble } from '../../components/MessageBubble'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { readOpenCodeChat } from '../../lib/chat'
import { clip, relativeTime } from '../../lib/format'
import { MessageChanges } from './MessageChanges'
import { usePolling } from '../../hooks/usePolling'
import type { Notify } from '../../hooks/useAgentAlerts'
import type { OpenCodeSession } from '../../lib/types'

export interface OpenCodeChatProps {
  sessions: OpenCodeSession[]
  /** The model new sessions should run on. */
  model: string
  models: string[]
  /** The folder new sessions should be created in. */
  workRoot?: string
  /** The session the open Codex conversation is linked to, if any. */
  linkedSessionId?: string
  onNotify: Notify
  onRefreshSessions: () => void
}

/**
 * Talking to OpenCode on its own.
 *
 * Codex does not have to be involved: an existing session can be picked, or a
 * new one started, and the conversation continues here. Messages are read from
 * OpenCode directly, so this stays honest even when the session was started
 * somewhere else entirely.
 */
export function OpenCodeChat({ sessions, model, models, workRoot, linkedSessionId, onNotify, onRefreshSessions }: OpenCodeChatProps) {
  const [selected, setSelected] = useState<string>('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newModel, setNewModel] = useState('')
  const [minimized, setMinimized] = useState(false)
  const panelId = useId()
  const box = useRef<HTMLTextAreaElement>(null)

  const current = useMemo(() => sessions.find((entry) => entry.id === selected) ?? null, [selected, sessions])
  const running = Boolean(current?.active)

  // Follow the linked session when the open conversation has one, so the panel
  // shows the work already in flight instead of an unrelated session.
  useEffect(() => {
    if (linkedSessionId && sessions.some((entry) => entry.id === linkedSessionId)) {
      setSelected(linkedSessionId)
      return
    }
    setSelected((value) => (value && sessions.some((entry) => entry.id === value) ? value : ''))
  }, [linkedSessionId, sessions])

  const transcript = usePolling(selected ? () => api.sessionMessages(selected) : null, running ? 2_500 : 15_000, { resetKey: selected })
  const messages = useMemo(() => readOpenCodeChat(transcript.data), [transcript.data])
  const loading = transcript.status === 'loading'
  const read = transcript.refresh

  async function startSession() {
    if (starting) return
    setStarting(true)
    setError(null)
    try {
      const created = await api.createOpenCodeSession({
        title: `Coding Room ${new Date().toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`,
        directory: workRoot,
        model: newModel || model,
      })
      const id = String((created as { id?: string })?.id ?? '')
      if (id) {
        setSelected(id)
        onNotify(tr("بدأنا جلسة OpenCode جديدة"), id)
      } else {
        onNotify(tr("أُنشئت الجلسة"), tr("لم نستقبل معرّفها، حدّث القائمة."))
      }
      onRefreshSessions()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("تعذّر بدء جلسة جديدة."))
    } finally {
      setStarting(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || !selected || sending) return
    setSending(true)
    setError(null)
    try {
      await api.sendToOpenCodeSession(selected, text)
      setDraft('')
      await read()
      onRefreshSessions()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("تعذّر إرسال الرسالة."))
    } finally {
      setSending(false)
      box.current?.focus()
    }
  }

  async function stop() {
    if (stopping || !selected) return
    setStopping(true)
    setError(null)
    try {
      await api.stopOpenCodeSession(selected)
      onNotify(tr("أرسلنا طلب إيقاف OpenCode"), current?.title)
      onRefreshSessions()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("تعذّر إيقاف الجلسة."))
    } finally {
      setStopping(false)
    }
  }

  return <section aria-label={tr("شات مباشر مع OpenCode")} className={cx('min-h-0 border-t border-line', minimized ? 'mt-auto shrink-0' : 'flex flex-1 flex-col')}>
    <div className={cx('shrink-0 bg-paper px-3 py-2.5', minimized ? '' : 'space-y-2 border-b border-line')}>
      <button
        type="button"
        onClick={() => setMinimized((value) => !value)}
        aria-expanded={!minimized}
        aria-controls={panelId}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md text-start transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ready/35"
      >
        <span className="text-[11px] font-bold text-ink">{tr("شات مباشر مع OpenCode")}</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-ink-soft">{sessions.length} {' '}{tr("جلسات متاحة")}</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ready-ink">
            {minimized ? tr("إظهار") : tr("إخفاء")}
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none', minimized ? '' : 'rotate-180')} aria-hidden="true" />
          </span>
        </span>
      </button>
    </div>
    <div id={panelId} hidden={minimized} className={minimized ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
      <div className="shrink-0 space-y-2 border-b border-line bg-paper px-3 pb-2.5">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          aria-label={tr("اختر جلسة OpenCode")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-[11px] text-ink outline-none focus:border-ready/55"
        >
          <option value="">{tr("— اختر جلسة للتشات —")}</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {clip(session.title, 40)}{session.active ? tr(" ● شغّالة") : ''}
            </option>
          ))}
        </select>
        {running ? (
          <button type="button" onClick={() => void stop()} disabled={stopping} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-review px-2 py-1.5 text-[10px] font-bold text-on-accent transition-colors hover:bg-review-ink disabled:opacity-55" aria-label={tr("أوقف الجلسة")}>
            {stopping ? <Spinner className="h-3 w-3" /> : <CircleStop className="h-3 w-3" aria-hidden="true" />}
            {tr("إيقاف")}</button>
        ) : null}
      </div>

      <details className="rounded-lg border border-line bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[10px] font-bold text-ready-ink marker:content-none">
          {tr("جلسة OpenCode جديدة")}<span className="font-normal text-ink-soft">{tr("اختياري")}</span>
        </summary>
        <div className="flex items-center gap-2 border-t border-line p-2">
          <select
            value={newModel}
            onChange={(event) => setNewModel(event.target.value)}
            aria-label={tr("موديل الجلسة الجديدة")}
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1 text-[10px] text-ink outline-none focus:border-ready/55"
          >
            <option value="">{tr("موديل الجلسة الجديدة:")}{' '}{clip(model || tr("الافتراضي"), 28)}</option>
            {models.map((id) => <option key={id} value={id}>{clip(id, 40)}</option>)}
          </select>
          <button type="button" onClick={() => void startSession()} disabled={starting} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ready/30 bg-ready-tint px-2 py-1 text-[10px] font-bold text-ready-ink transition-colors hover:bg-ready-tint/80 disabled:opacity-55" aria-label={tr("ابدأ جلسة OpenCode جديدة")}>
            {starting ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
            {tr("ابدأ")}</button>
        </div>
      </details>

      {current ? (
        <p className="flex items-center gap-1.5 text-[10px] text-ink-soft">
          <code dir="ltr" className="ltr truncate" title={current.directory}>{clip(current.directory, 44)}</code>
          {current.updatedAt ? <span>· {relativeTime(current.updatedAt)}</span> : null}
        </p>
      ) : null}
    </div>

    {!selected ? (
      <p className="flex flex-1 items-center justify-center px-6 text-center text-xs leading-6 text-ink-soft">
        {tr("اختر جلسة من القائمة، أو ابدأ جلسة جديدة، لتتحدث مع OpenCode مباشرة بدون Codex.")}</p>
    ) : (
      <>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading && messages.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-6 text-xs text-ink-soft"><Spinner />{tr("يتم قراءة الرسائل…")}</p>
          ) : messages.length === 0 ? (
            <p className="py-6 text-center text-xs leading-6 text-ink-soft">{tr("لا توجد رسائل في هذه الجلسة بعد. اكتب أول رسالة.")}</p>
          ) : (
              <ol className="mx-auto max-w-3xl divide-y divide-line/80">
              {messages.map((message) => <li key={message.id} className="py-4 first:pt-0 last:pb-0">
                <MessageBubble message={message} speaker="opencode" />
                {message.role === 'assistant' && message.userMessageId ? <MessageChanges sessionId={selected} messageId={message.userMessageId} active={running} onChanged={() => { void read(); onRefreshSessions() }} /> : null}
              </li>)}
            </ol>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-card p-3">
          <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-2 focus-within:border-ready/55 focus-within:ring-2 focus-within:ring-ready/10">
            <textarea
              ref={box}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
              }}
              rows={2}
              placeholder={running ? tr("اكتب تصحيحًا، سيصل إلى العمل الجاري…") : tr("اكتب إلى OpenCode…")}
              className="min-h-[3rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft/75"
            />
            <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ready text-on-accent transition-colors hover:bg-ready-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label={tr("إرسال إلى OpenCode")}>
              {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          {(error || transcript.error) ? <p className="mt-2 text-[11px] leading-5 text-review-ink">{tr(error || transcript.error || '')}</p> : null}
          <p className="mt-2 px-1 text-[10px] text-ink-soft">{tr("Enter للإرسال · Shift + Enter لسطر جديد · هذا الشات لا يمرّ على Codex.")}</p>
        </div>
      </>
    )}
    </div>
  </section>
}
