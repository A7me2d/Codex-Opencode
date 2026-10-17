import { Paperclip, Send, Square, X } from 'lucide-react'
import { useLocale } from '../../lib/i18n'
import { cx } from '../../lib/cx'
import { Spinner } from '../../components/ui/Spinner'
import type { CodexSelection, ComposerState } from '../../hooks/useConversation'
import type { CodexTurnState } from '../../lib/types'
import { CodexSettingsPicker } from '../codex/CodexSettingsPicker'
import { WeeklyQuota } from '../codex/WeeklyQuota'

/**
 * The composer for the brain (manager) chat.
 *
 * Unlike the worker desks, the whole toolbar lives inside the writing box
 * like the Agent composer: attachment, settings, the live account quota and
 * the send/stop arrow all sit on one row under the textarea.
 */
export function BrainComposer({ compact, busy, enabled, archived, messageLabel, composer, turn, codexSelection, sendNow }: {
  compact: boolean
  busy: boolean
  enabled: boolean
  archived: boolean
  messageLabel: string
  composer: ComposerState
  turn: CodexTurnState
  codexSelection: CodexSelection
  sendNow: () => void
}) {
  const ar = useLocale() === 'ar'
  const blocked = !enabled || archived
  const hasContent = Boolean(composer.draft.trim() || composer.attachments.length)
  const attachTitle = ar ? 'إرفاق مسار ملف' : 'Attach file path'
  const ring = 'focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed'
  return <form onSubmit={event => { event.preventDefault(); sendNow() }} className={cx('super-agent-composer super-brain-composer shrink-0 bg-transparent', compact ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-2')}>
    {composer.attachments.length ? <div className="mb-2 flex flex-wrap gap-1">{composer.attachments.map(file => <button key={file} type="button" title={file} aria-label={`${ar ? 'إزالة' : 'Remove'} ${file}`} onClick={() => composer.onRemoveAttachment(file)} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[10px] hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40"><code dir="ltr" className="truncate">{file.split(/[\\/]/).pop()}</code><X className="h-3 w-3 shrink-0" /></button>)}</div> : null}
    <div className="super-composer-box relative min-w-0 rounded-2xl border border-line bg-paper/60 p-2 focus-within:border-relay/60">
      <textarea aria-label={messageLabel} value={composer.draft} onChange={event => composer.onDraftChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendNow() } }} rows={2} placeholder={ar ? 'اكتب رسالتك…' : 'Write a message…'} className="block min-h-10 w-full resize-none bg-transparent px-1 text-xs leading-5 outline-none max-h-32" />
      <div className="mt-1 flex flex-wrap items-center gap-0.5">
        <button type="button" disabled={busy || blocked} onClick={composer.onAttach} aria-label={attachTitle} title={attachTitle} className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-relay-tint hover:text-relay-ink disabled:opacity-40', ring, 'focus-visible:ring-relay/40')}>{composer.attaching ? <Spinner className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}</button>
        <CodexSettingsPicker selection={codexSelection} disabled={busy || blocked} />
        {busy ? <span role="status" className="ms-2 text-[10px] font-semibold text-relay-ink">{ar ? 'يعمل…' : 'Working…'}</span> : null}
        {enabled ? <WeeklyQuota /> : null}
        {turn.active ? <button type="button" disabled={turn.stopping || !enabled} onClick={composer.onStop} aria-label={ar ? 'إيقاف هذه المحادثة' : 'Stop this conversation'} title={ar ? 'إيقاف هذه المحادثة' : 'Stop this conversation'} className={cx('ms-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-review text-on-accent shadow-sm transition-colors hover:bg-review-ink disabled:opacity-50', ring, 'focus-visible:ring-review/50')}>{turn.stopping ? <Spinner className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}</button> : <button type="submit" disabled={busy || blocked || !hasContent} aria-label={ar ? 'إرسال' : 'Send'} title={ar ? 'إرسال' : 'Send'} className={cx('ms-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-relay text-on-accent shadow-sm transition-colors hover:bg-relay-ink disabled:opacity-45', ring, 'focus-visible:ring-relay/50')}>{composer.sending ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}</button>}
      </div>
    </div>
    {composer.error || codexSelection.error ? <p role="alert" className="mt-2 break-words text-[11px] leading-5 text-review-ink">{composer.error || codexSelection.error}</p> : null}
  </form>
}
