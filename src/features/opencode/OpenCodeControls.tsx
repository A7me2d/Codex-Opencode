import { tr } from '../../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { CircleStop, Send, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { Spinner } from '../../components/ui/Spinner'

export interface OpenCodeControlsProps {
  threadId: string
  sessionId: string
  /** True while OpenCode is working in this session. */
  active: boolean
  onNotify: (title: string, detail?: string) => void
}

/**
 * Direct control over the OpenCode run linked to this conversation.
 *
 * A message sent while OpenCode is busy *steers* the running turn; a message
 * sent while it is idle is queued as a new task. The stop button only appears
 * while there is something to stop.
 */
export function OpenCodeControls({ threadId, sessionId, active, onNotify }: OpenCodeControlsProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Never leave text in a box that belongs to a different conversation.
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft('')
    setError(null)
  }, [threadId])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      await api.sendOpenCodeMessage(threadId, text)
      setDraft('')
      onNotify(active ? tr("تم توجيه النص إلى OpenCode الجاري") : tr("تم إرسال المهمة إلى OpenCode"))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("تعذر إرسال الرسالة إلى OpenCode."))
    } finally {
      setSending(false)
      box.current?.focus()
    }
  }

  async function stop() {
    if (stopping) return
    setStopping(true)
    setError(null)
    try {
      await api.stopOpenCode(threadId)
      onNotify(tr("أرسلنا طلب إيقاف OpenCode"), sessionId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("تعذر إيقاف OpenCode."))
    } finally {
      setStopping(false)
    }
  }

  return <div className="shrink-0 border-t border-line bg-paper p-3">
    <div className="mb-2 flex items-center justify-between gap-2">
      <label htmlFor="opencode-direct" className="text-[11px] font-bold text-ready-ink">{tr("رسالة مباشرة إلى OpenCode")}</label>
      {active ? (
        <button type="button" onClick={() => void stop()} disabled={stopping} className="inline-flex items-center gap-1 rounded-md bg-review px-2 py-1 text-[10px] font-bold text-on-accent transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-55" aria-label={tr("إيقاف OpenCode فورًا")}>
          {stopping ? <Spinner className="h-3 w-3" /> : <CircleStop className="h-3 w-3" aria-hidden="true" />}
          {tr("إيقاف")}</button>
      ) : null}
    </div>

    <div className="flex items-end gap-2 rounded-xl border border-ready/20 bg-card p-2 focus-within:border-ready/55 focus-within:ring-2 focus-within:ring-ready/10">
      <textarea
        id="opencode-direct"
        ref={box}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
        }}
        rows={2}
        placeholder={active ? tr("اكتب تصحيحًا، سيصل إلى العمل الجاري…") : tr("اكتب إلى OpenCode مباشرة…")}
        className="min-h-[3.25rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft/75"
      />
      <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ready text-on-accent transition-colors hover:bg-ready-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label={tr("إرسال إلى OpenCode")} title={active ? tr("توجيه مباشر للعمل الجاري") : tr("إرسال رسالة جديدة")}>
        {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>

    {error ? (
      <div className="mt-2 flex items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-[11px] leading-5 text-review-ink">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{tr(error)}
      </div>
    ) : null}
  </div>
}
