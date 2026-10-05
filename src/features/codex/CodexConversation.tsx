import { CircleDot, Plus, Sparkles } from 'lucide-react'
import { MessageBubble } from '../../components/MessageBubble'
import { ScrollToLatest } from '../../components/ui/ScrollToLatest'
import { Spinner } from '../../components/ui/Spinner'
import { StatusPill } from '../../components/ui/StatusPill'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import type { ChatMessage, CodexThread, CodexTurnState } from '../../lib/types'
import type { SessionFileDiff } from '../../lib/types'
import { Composer } from './Composer'
import { ChangedFiles } from '../opencode/ChangedFiles'

import type { CodexSelection } from '../../hooks/useConversation'

export interface CodexConversationProps {
  fileChanges: SessionFileDiff[]
  workRoot?: string
  codexSelection: CodexSelection
  thread: CodexThread | null
  messages: ChatMessage[]
  loading: boolean
  turn: CodexTurnState
  sending: boolean
  error: string | null
  draft: string
  queued: string | null
  attachments: string[]
  attaching: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
  onQueue: () => void
  onCancelQueue: () => void
  onAttach: () => void
  onRemoveAttachment: (path: string) => void
  onStop: () => void
  onNewThread: () => void
}

function EmptyThread({ onNewThread }: { onNewThread: () => void }) {
  return <div className="flex h-full flex-1 items-center justify-center px-8 text-center">
    <div className="max-w-md">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-relay-tint text-relay-ink">
        <Sparkles className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-bold text-ink">ابدأ من شات Codex</h1>
      <p className="mt-3 text-sm leading-7 text-ink-soft">
        اكتب طلبك هنا. إذا أردت أن ينفّذ OpenCode، أضف
        <code className="rounded bg-card px-1.5 py-0.5 font-mono text-relay-ink">$opencode</code>
        داخل الرسالة، وسترى التسليم والرد في المساحة الجانبية.
      </p>
      <button type="button" onClick={onNewThread} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-relay px-4 py-2.5 text-sm font-bold text-white hover:bg-relay-ink">
        <Plus className="h-4 w-4" aria-hidden="true" />محادثة Codex جديدة
      </button>
    </div>
  </div>
}

function TurnPill({ turn, sending }: { turn: CodexTurnState; sending: boolean }) {
  if (turn.active) {
    return <StatusPill tone="warning">
      <Spinner className="h-3 w-3" />
      {turn.stopping ? 'يتم الإيقاف' : 'Codex يفكّر'}
    </StatusPill>
  }
  if (sending) {
    return <StatusPill tone="warning">
      <Spinner className="h-3 w-3" />يبدأ Codex
    </StatusPill>
  }
  return <StatusPill tone="codex"><CircleDot className="h-3 w-3" aria-hidden="true" /> Codex</StatusPill>
}

/** Middle column: the conversation with Codex, plus the composer. */
export function CodexConversation(props: CodexConversationProps) {
  const { thread, messages, loading, turn, sending, error, draft, queued, attachments, attaching, onDraftChange, onSend, onQueue, onCancelQueue, onAttach, onRemoveAttachment, onStop, onNewThread } = props
  const scroll = useStickyScroll(messages, thread?.id)

  return <section dir="rtl" className="flex min-h-[32rem] min-w-0 flex-col bg-paper lg:min-h-0 lg:overflow-hidden">
    {thread ? (
      <>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-card px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-ink">
              <Sparkles className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />
              <span className="truncate">{thread.title ?? thread.name ?? 'محادثة جديدة'}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-soft">هنا تتحدث مع Codex — التخطيط، المنطق، والمراجعة.</p>
            {thread.directory ? <div className="mt-2 text-[10px] text-ink-soft">
              <span>مجلد هذه الجلسة: </span><code dir="ltr" className="ltr inline-block max-w-full truncate align-bottom" title={thread.directory}>{thread.directory}</code>
              {props.workRoot && thread.directory.replace(/[\\/]+$/, '').toLowerCase() !== props.workRoot.replace(/[\\/]+$/, '').toLowerCase() ? <p className="mt-1 text-review-ink">هذه جلسة لمشروع مختلف. لإنشاء جلسة في المجلد المختار، اضغط «+ محادثة».</p> : null}
            </div> : null}
          </div>
          <TurnPill turn={turn} sending={sending} />
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scroll.ref} onScroll={scroll.handleScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto mb-4 max-w-3xl"><ChangedFiles key={thread.id} source="codex" sessionId={thread.id} active={turn.active} files={props.fileChanges} /></div>
            {loading && messages.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft">
                <Spinner />يتم تحميل المحادثة…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <p className="max-w-sm text-sm leading-7 text-ink-soft">هذه جلسة جديدة. اكتب ما تريد من Codex أن يفهمه أو يخطط له.</p>
              </div>
            ) : (
              <ol className="mx-auto flex max-w-3xl flex-col gap-5">
                {messages.map((message) => <li key={message.id}><MessageBubble message={message} speaker="codex" /></li>)}
              </ol>
            )}
          </div>
          <ScrollToLatest visible={!scroll.following && messages.length > 0} onClick={() => scroll.scrollToLatest(true)} />
        </div>

        <Composer
          codexSelection={props.codexSelection}
          draft={draft}
          onChange={onDraftChange}
          onSubmit={onSend}
          onQueue={onQueue}
          onCancelQueue={onCancelQueue}
          queued={queued}
          sending={sending}
          error={error}
          attachments={attachments}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
          attaching={attaching}
          turn={turn}
          onStop={onStop}
        />
      </>
    ) : <EmptyThread onNewThread={onNewThread} />}
  </section>
}
