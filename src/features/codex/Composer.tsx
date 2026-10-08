import { tr } from '../../lib/i18n'
import { useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AtSign, CircleStop, Paperclip, Send, Timer, X } from 'lucide-react'
import { ErrorNote } from '../../components/ui/ErrorNote'
import { Spinner } from '../../components/ui/Spinner'
import type { CodexTurnState } from '../../lib/types'

import type { CodexSelection } from '../../hooks/useConversation'
import { CodexSettingsPicker } from './CodexSettingsPicker'

export interface ComposerProps {
  implementer?: boolean
  codexSelection: CodexSelection
  draft: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Hand the text over to be sent the moment the current turn ends. */
  onQueue: () => void
  onCancelQueue: () => void
  /** Text waiting for the turn to end, or null. */
  queued: string | null
  sending: boolean
  error: string | null
  attachments: string[]
  onAttach: () => void
  onRemoveAttachment: (path: string) => void
  attaching: boolean
  turn: CodexTurnState
  onStop: () => void
}

/**
 * The Codex input.
 *
 * The box never locks: while a turn is running the operator can keep writing
 * and the send button parks the text instead of dropping it, so the message
 * leaves the second the agent goes idle.
 */
export function Composer({ implementer = false, codexSelection, draft, onChange, onSubmit, onQueue, onCancelQueue, queued, sending, error, attachments, onAttach, onRemoveAttachment, attaching, turn, onStop }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busy = sending || turn.active
  const isDelegation = /(?:^|\s)\$opencode\b/i.test(draft)
  const starting = sending && !turn.active
  const hasContent = Boolean(draft.trim() || attachments.length)

  const deliver = () => { if (busy) onQueue(); else onSubmit() }
  const insertOpenCodeTag = () => {
    if (/(?:^|\s)\$opencode\b/i.test(draft)) {
      textareaRef.current?.focus()
      return
    }
    const nextDraft = draft.trimEnd() ? `${draft.trimEnd()} $opencode` : '$opencode'
    onChange(nextDraft)
    requestAnimationFrame(() => {
      const input = textareaRef.current
      input?.focus()
      input?.setSelectionRange(nextDraft.length, nextDraft.length)
    })
  }
  const submit = (event: FormEvent) => { event.preventDefault(); deliver() }
  const keyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); deliver() }
  }

  return <form onSubmit={submit} className="shrink-0 border-t border-line bg-card p-3 sm:p-4">
    <CodexSettingsPicker selection={codexSelection} disabled={busy || Boolean(queued)} />
    {codexSelection.error ? <ErrorNote>{tr(codexSelection.error)}</ErrorNote> : null}
    {queued ? (
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-review/25 bg-review-tint px-3 py-2.5">
        <Spinner className="h-3.5 w-3.5 shrink-0 text-review" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-review-ink" title={queued}>{tr("في انتظار الإرسال — هتروح أول ما دور Codex يخلص")}</span>
        <button type="button" onClick={onCancelQueue} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-review-ink/70 hover:bg-card" aria-label={tr("إلغاء الرسالة المحفوظة")}>
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    ) : null}

    {attachments.length > 0 ? (
      <div className="mb-2 rounded-lg border border-relay/20 bg-relay-tint/55 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-relay-ink">
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{tr("ملف مرتبط بالرسالة")}</div>
        <p className="mt-1 text-[10px] leading-5 text-relay-ink/80">{tr("سيُرسل المسار فقط إلى Codex، ولن يُرفع محتوى الملف.")}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((path) => <li key={path} className="inline-flex max-w-full items-center gap-1 rounded-md border border-relay/20 bg-card py-1 pl-1 pr-2 text-[11px] text-ink">
            <Paperclip className="h-3 w-3 shrink-0 text-relay" aria-hidden="true" />
            <code dir="ltr" className="ltr min-w-0 truncate" title={path}>{path}</code>
            <button type="button" onClick={() => onRemoveAttachment(path)} disabled={busy} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-paper hover:text-ink disabled:cursor-not-allowed" aria-label={tr("إزالة {{0}}", [path])}>
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </li>)}
        </ul>
      </div>
    ) : null}

    <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-2 focus-within:border-relay/60 focus-within:ring-2 focus-within:ring-relay/10">
      <button type="button" onClick={onAttach} disabled={busy || attaching} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label={tr("اختيار ملف من المشروع وإرسال مساره فقط")} title={tr("إرسال مسار ملف فقط")}>
        {attaching ? <Spinner className="h-4 w-4" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
      </button>

      <button type="button" onClick={insertOpenCodeTag} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ready/25 bg-ready-tint/60 text-ready-ink transition-colors hover:border-ready/50 hover:bg-ready-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ready/30" aria-label={tr("إضافة وسم $opencode إلى الرسالة")} title={tr("إضافة وسم $opencode إلى الرسالة")}>
        <AtSign className="h-4 w-4" aria-hidden="true" />
      </button>

      <textarea ref={textareaRef} value={draft} onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} rows={2} placeholder={implementer ? tr("اكتب توجيهًا إلى Codex المنفّذ…") : tr("اكتب إلى Codex… أضف $opencode عندما تريد إرسال التنفيذ إلى OpenCode.")} className="min-h-[3.4rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft/75" />

      {turn.active ? (
        <button type="button" onClick={onStop} disabled={turn.stopping} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-review text-on-accent transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-55" aria-label={tr("إيقاف Codex فورًا")} title={tr("إيقاف Codex فورًا")}>
          {turn.stopping ? <Spinner className="h-4 w-4" /> : <CircleStop className="h-4 w-4" aria-hidden="true" />}
        </button>
      ) : (
        <button type="submit" disabled={sending || !hasContent} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-relay text-on-accent transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label={busy ? tr("حفظ الرسالة وإرسالها فور انتهاء دور Codex") : tr("إرسال إلى Codex")} title={busy ? tr("يُرسل تلقائيًا فور انتهاء دور Codex") : tr("إرسال إلى Codex")}>
          {sending ? <Spinner className="h-4 w-4" /> : busy ? <Timer className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </div>

    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-soft">
      {turn.active ? (
        <span role="status" className="inline-flex items-center gap-1.5 font-bold text-review-ink">
          <Spinner className="h-3.5 w-3.5" />
          {turn.stopping ? tr("يجري إيقاف Codex…") : tr("اكتب وأنت مستني — الرسالة تروح أول ما يخلص.")}
        </span>
      ) : starting ? (
        <span role="status" className="inline-flex items-center gap-1.5 font-bold text-relay-ink">
          <Spinner className="h-3.5 w-3.5" />{tr("جارٍ بدء دور Codex…")}</span>
      ) : isDelegation ? (
        <span className="font-mono text-relay-ink">{tr("$opencode ← سيظهر التفويض في المسار الجانبي")}</span>
      ) : null}
    </div>

    {error ? <ErrorNote>{tr(error)}</ErrorNote> : null}
  </form>
}
