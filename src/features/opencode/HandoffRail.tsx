import { useMemo } from 'react'
import { ArrowUpRight, Bot, FileSearch, TerminalSquare, TriangleAlert } from 'lucide-react'
import { CopyButton } from '../../components/CopyButton'
import { ErrorNote } from '../../components/ui/ErrorNote'
import { MessageBubble } from '../../components/MessageBubble'
import { ScrollToLatest } from '../../components/ui/ScrollToLatest'
import { Spinner } from '../../components/ui/Spinner'
import { StateDot } from '../../components/ui/StateDot'
import { StatusPill } from '../../components/ui/StatusPill'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import type { Notify } from '../../hooks/useAgentAlerts'
import { readOpenCodeChat } from '../../lib/chat'
import { asArray } from '../../lib/guards'
import { readForms } from '../../lib/forms'
import type { CodexThread, HandoffData, OpenCodeSession, RelayEvent } from '../../lib/types'
import { OpenCodeChat } from './OpenCodeChat'
import { ChangedFiles } from './ChangedFiles'
import { ModelPicker } from './ModelPicker'
import type { ModelPickerProps } from './ModelPicker'
import { OpenCodeControls } from './OpenCodeControls'
import { QuestionForm } from './QuestionForm'
import { McpPanel } from '../../components/McpPanel'

export interface HandoffRailProps {
  thread: CodexThread | null
  handoff: HandoffData | null
  loading: boolean
  events: RelayEvent[]
  /** Ask Codex to review what OpenCode did. */
  onReview: () => void
  reviewing: boolean
  /** Re-read the handoff (after an answer, or a manual refresh). */
  onRefresh: () => void
  onNotify: Notify
  /** The OpenCode model new handoffs run on. */
  models: ModelPickerProps['models']
  model: string
  onModelChange: (id: string) => void
  /** True while the server is applying a model change. */
  changingModel: boolean
  /** Why the last model change did not stick, if it did not. */
  modelError: string | null
  /** OpenCode sessions belonging to this project, so earlier work is reachable. */
  sessions: OpenCodeSession[]
  onRefreshSessions: () => void
  /** Folders and models offered when starting a session without Codex. */
  workRoot?: string
  modelIds: string[]
}

const idleActivity = { active: false, kind: 'idle' as const, label: 'لا توجد عملية OpenCode نشطة' }

/** Right column: what Codex delegated to OpenCode, and what OpenCode said back. */
export function HandoffRail({ thread, handoff, loading, events, onReview, reviewing, onRefresh, onNotify, models, model, onModelChange, changingModel, modelError, sessions, onRefreshSessions, workRoot, modelIds }: HandoffRailProps) {
  const messages = useMemo(() => readOpenCodeChat(handoff?.messages), [handoff?.messages])
  const forms = useMemo(() => readForms(handoff?.forms), [handoff?.forms])
  const activity = handoff?.activity ?? idleActivity
  const scroll = useStickyScroll(messages, handoff?.link?.opencodeSessionId)

  const handoffs = useMemo(() => asArray<RelayEvent>(events)
    .filter((event) => event.codexThreadId === thread?.id && event.kind === 'handoff-sent')
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-2), [events, thread?.id])

  // Stop the pane from mounting an unanswerable card if the link disappears.
  const sessionId = handoff?.link?.opencodeSessionId ?? ''
  // Show the provider's own name so the rail says what is really running.
  const modelLabel = models.find((entry) => entry.id === model)?.name ?? model ?? 'OpenCode'

  return <aside dir="rtl" className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">
    <div className="shrink-0 border-b border-line px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <ArrowUpRight className="h-4 w-4 text-ready" aria-hidden="true" />مسار التفويض
        </div>
        <StatusPill tone="openCode"><Bot className="h-3 w-3" aria-hidden="true" /> {modelLabel}</StatusPill>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-soft">ما يرسله Codex إلى OpenCode، وما يرد به، يظهر هنا كما هو.</p>
      {/* The model belongs to the conversation, not to the OpenCode session, so
          it is choosable before the first handoff — the choice is applied when
          that handoff creates the session. */}
      <details className="mt-3 rounded-lg border border-line bg-paper">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[11px] font-bold text-ink-soft marker:content-none">
          إعدادات التنفيذ
          <span className="text-[10px] font-normal text-ink-soft">غيّر الموديل عند الحاجة</span>
        </summary>
        <div className="border-t border-line p-2.5">
          <ModelPicker models={models} selected={model} onSelect={onModelChange} disabled={activity.active || changingModel} />
          {modelError ? <ErrorNote>{modelError}</ErrorNote> : null}
        </div>
      </details>
    </div>
    <McpPanel agent="opencode" busy={activity.active || sessions.some((session) => session.active && session.inProject)} />

    {!thread ? <Empty>اختر جلسة Codex أولًا لرؤية أي تفويض مرتبط بها.</Empty>
      : loading && !handoff ? <Empty><Spinner />يتم فحص مسار التفويض…</Empty>
        : !handoff?.link ? <>
          <NoHandoff />
          <OpenCodeChat
            sessions={sessions}
            model={model}
            models={modelIds}
            workRoot={workRoot}
            onNotify={onNotify}
            onRefreshSessions={onRefreshSessions}
          />
        </>
        : <>

          {/* Current status, the session, and which model new work runs on. */}
          <div className="shrink-0 border-b border-line bg-paper px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-ink">
                <StateDot active={activity.active} warning={forms.length > 0} />
                <span className="truncate">{forms.length > 0 ? 'OpenCode يحتاج توضيحًا' : activity.active ? activity.label : 'لا توجد عملية OpenCode نشطة'}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <code dir="ltr" className="ltr max-w-[7rem] truncate text-[10px] text-ink-soft" title={sessionId}>{sessionId}</code>
                <CopyButton value={sessionId} label="معرّف" />
              </div>
            </div>
          </div>

          {forms.length > 0 ? (
            <section aria-label="أسئلة OpenCode المفتوحة" className="thin-scroll max-h-[45%] shrink-0 space-y-2.5 overflow-y-auto border-b border-line bg-review-tint/45 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-review-ink">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />OpenCode متوقف على سؤال — التنفيذ محتاج ردّك
              </p>
              {forms.map((form) => <QuestionForm key={form.id} form={form} sessionId={sessionId} onAnswered={onRefresh} onNotify={onNotify} />)}
            </section>
          ) : null}

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scroll.ref} onScroll={scroll.handleScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 px-4 py-4">
                <ChangedFiles key={sessionId} sessionId={sessionId} active={handoff.active} />
                {handoffs.length > 0 ? (
                  <section className="border-b border-line pb-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-relay-ink">Codex ←→ OpenCode</p>
                    <ul className="space-y-2">
                      {handoffs.map((event) => <li key={event.id} className="rounded-lg bg-relay-tint px-3 py-2.5 text-xs leading-6 text-relay-ink">
                        <span className="mb-1 block text-[10px] font-bold">أرسل Codex إلى OpenCode</span>
                        {event.message}
                      </li>)}
                    </ul>
                  </section>
                ) : null}

                {messages.length === 0 ? (
                  <p className="py-4 text-center text-xs leading-6 text-ink-soft">تم إنشاء رابط OpenCode، لكن لا توجد رسالة مرئية منه بعد. ستظهر أول رسالة فعلية هنا تلقائيًا.</p>
                ) : (
                  <ol className="space-y-4">
                    {messages.map((message) => <li key={message.id}><MessageBubble message={message} speaker="opencode" /></li>)}
                  </ol>
                )}

                {!handoff.active && forms.length === 0 && messages.length > 0 ? (
                  <button type="button" onClick={onReview} disabled={reviewing} className="flex w-full items-center justify-center gap-2 rounded-lg border border-relay/30 bg-card px-3 py-2.5 text-xs font-bold text-relay-ink transition-colors hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-45">
                    {reviewing ? <Spinner className="h-3.5 w-3.5" /> : <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />}
                    اطلب من Codex مراجعة الرد
                  </button>
                ) : null}
              </div>
            </div>
            <ScrollToLatest tone="ready" visible={!scroll.following && (messages.length > 0 || handoffs.length > 0)} onClick={() => scroll.scrollToLatest(true)} />
          </div>

          <OpenCodeControls threadId={thread.id} sessionId={sessionId} active={handoff.active} onNotify={onNotify} />

        </>}
  </aside>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm leading-7 text-ink-soft">{children}</div>
}

function NoHandoff() {
  return <section className="shrink-0 border-b border-line bg-paper px-4 py-3">
    <div>
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-ready-tint text-ready-ink">
        <TerminalSquare className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-sm font-bold text-ink">لم يُفوَّض OpenCode في هذه الجلسة</h2>
      <p className="mt-2 text-xs leading-6 text-ink-soft">
        في شات Codex اكتب <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-relay-ink">$opencode</code> ثم طلب التنفيذ. لن يبدأ OpenCode بدون هذا الوسم.
        اختر موديل التنفيذ من الأعلى الآن، وسيُستخدم عند أول تفويض.
      </p>
    </div>
  </section>
}
