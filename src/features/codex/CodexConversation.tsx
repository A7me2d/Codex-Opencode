import { direction, tr } from '../../lib/i18n'
import { ArrowUpRight, CircleDot, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { MessageBubble } from '../../components/MessageBubble'
import { ScrollToLatest } from '../../components/ui/ScrollToLatest'
import { Spinner } from '../../components/ui/Spinner'
import { StatusPill } from '../../components/ui/StatusPill'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import type { ChatMessage, CodexThread, CodexTurnState } from '../../lib/types'
import type { SessionFileDiff } from '../../lib/types'
import { Composer } from './Composer'
import { ChangedFiles } from '../opencode/ChangedFiles'
import { McpPanel } from '../../components/McpPanel'

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
  onExecutePlan: (threadId: string) => Promise<void>
}

function EmptyThread({ onNewThread }: { onNewThread: () => void }) {
  return <div className="flex h-full flex-1 items-center justify-center px-8 text-center">
    <div className="max-w-md">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-relay-tint text-relay-ink">
        <Sparkles className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-bold text-ink">{tr("ابدأ محادثة جديدة")}</h1>
      <p className="mt-3 text-sm leading-7 text-ink-soft">
        {tr("اختَر المفكّر والمنفّذ من الإعدادات، ثم افتح محادثة. ستظهر مساحة التخطيط والتنفيذ حسب الأدوار التي اخترتها.")}</p>
      <button type="button" onClick={onNewThread} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-relay px-4 py-2.5 text-sm font-bold text-on-accent hover:bg-relay-ink">
        <Plus className="h-4 w-4" aria-hidden="true" />{tr("محادثة جديدة")}</button>
    </div>
  </div>
}

function TurnPill({ turn, sending }: { turn: CodexTurnState; sending: boolean }) {
  if (turn.active) {
    return <StatusPill tone="warning">
      <Spinner className="h-3 w-3" />
      {turn.stopping ? tr("يتم الإيقاف") : tr("Codex يفكّر")}
    </StatusPill>
  }
  if (sending) {
    return <StatusPill tone="warning">
      <Spinner className="h-3 w-3" />{tr("يبدأ Codex")}</StatusPill>
  }
  return <StatusPill tone="codex"><CircleDot className="h-3 w-3" aria-hidden="true" /> Codex</StatusPill>
}

/** Middle column: the conversation with Codex, plus the composer. */
export function CodexConversation(props: CodexConversationProps) {
  const { thread, messages, loading, turn, sending, error, draft, queued, attachments, attaching, onDraftChange, onSend, onQueue, onCancelQueue, onAttach, onRemoveAttachment, onStop, onNewThread } = props
  const [executingPlan, setExecutingPlan] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const executorChat = thread?.workflowRole === 'executor'
  const scroll = useStickyScroll(messages, thread?.id)

  return <section dir={direction()} className="flex min-h-[32rem] min-w-0 flex-col bg-paper lg:min-h-0 lg:overflow-hidden">
    {thread ? (
      <>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-card px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-ink">
              <Sparkles className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />
              <span className="truncate">{thread.title ?? thread.name ?? tr("محادثة جديدة")}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-soft">{executorChat || thread.workflow?.planner !== 'codex' ? tr("Codex · المنفّذ — تعديل الملفات والتحقق من النتيجة.") : tr("هنا محادثة التخطيط والمراجعة مع Codex.")}</p>
            {thread.directory ? <div className="mt-2 text-[10px] text-ink-soft">
              <span>{tr("مجلد هذه الجلسة:")}{' '}</span><code dir="ltr" className="ltr inline-block max-w-full truncate align-bottom" title={thread.directory}>{thread.directory}</code>
              {props.workRoot && thread.directory.replace(/[\\/]+$/, '').toLowerCase() !== props.workRoot.replace(/[\\/]+$/, '').toLowerCase() ? <p className="mt-1 text-review-ink">{tr("هذه جلسة لمشروع مختلف. لإنشاء جلسة في المجلد المختار، اضغط «+ محادثة».")}</p> : null}
            </div> : null}
          </div>
          <TurnPill turn={turn} sending={sending} />
        </header>
        <McpPanel agent="codex" busy={turn.active || sending} />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scroll.ref} onScroll={scroll.handleScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto mb-4 max-w-3xl"><ChangedFiles key={thread.id} source="codex" sessionId={thread.id} active={turn.active} files={props.fileChanges} /></div>
            {loading && messages.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft">
                <Spinner />{tr("يتم تحميل المحادثة…")}</div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <p className="max-w-sm text-sm leading-7 text-ink-soft">{executorChat || thread.workflow?.planner !== 'codex' ? tr("هذه محادثة التنفيذ. ستظهر هنا الخطة المرسلة من المفكّر.") : tr("هذه جلسة التخطيط. اكتب طلبك، ثم أرسل الخطة إلى شات التنفيذ عند جاهزيتها.")}</p>
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
          implementer={executorChat || (thread.workflow?.planner !== 'codex' && thread.workflow?.executor === 'codex')}
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
        {thread.workflow?.planner === 'codex' && thread.workflow?.executor === 'codex' && !executorChat ? <div className="shrink-0 border-t border-line bg-card px-4 py-2.5">
          <button type="button" title={tr("يرسل آخر رد من شات المفكّر إلى شات المنفّذ، ثم يعيد تقرير المنفّذ للمفكّر تلقائيًا للمراجعة.")} onClick={() => {
            if (!thread || executingPlan) return
            setExecutingPlan(true); setExecutionError(null)
            void props.onExecutePlan(thread.id).catch(failure => setExecutionError(failure instanceof Error ? failure.message : tr("تعذّر بدء محادثة التنفيذ."))).finally(() => setExecutingPlan(false))
          }} disabled={turn.active || sending || executingPlan || !messages.some(message => message.role === 'assistant')} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-ready/35 px-3 py-2 text-xs font-bold text-ready-ink hover:bg-ready-tint disabled:opacity-40">
            {executingPlan ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{tr("أرسل آخر رد إلى شات Codex للتنفيذ")}</button>
          {executionError ? <p role="alert" className="mt-2 text-xs text-review-ink">{executionError}</p> : null}
        </div> : null}
      </>
    ) : <EmptyThread onNewThread={onNewThread} />}
  </section>
}
