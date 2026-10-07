import { direction, tr } from '../../lib/i18n'
import { useMemo, useState } from 'react'
import { Send, ArrowUpRight, FileSearch, CircleStop } from 'lucide-react'
import { api } from '../../lib/api'
import { readOpenCodeChat } from '../../lib/chat'
import { readForms } from '../../lib/forms'
import { MessageBubble } from '../../components/MessageBubble'
import { McpPanel } from '../../components/McpPanel'
import { Spinner } from '../../components/ui/Spinner'
import { ScrollToLatest } from '../../components/ui/ScrollToLatest'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import { ModelPicker } from './ModelPicker'
import { QuestionForm } from './QuestionForm'
import type { HandoffRailProps } from './HandoffRail'

export function PlannerConversation(props: HandoffRailProps & { codexActive: boolean; codexHasReply: boolean }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messages = useMemo(() => readOpenCodeChat(props.handoff?.messages), [props.handoff?.messages])
  const forms = useMemo(() => readForms(props.handoff?.forms), [props.handoff?.forms])
  const scroll = useStickyScroll(messages, props.thread?.id)
  const active = props.handoff?.active ?? false
  const busy = sending || active || props.codexActive
  const sessionId = props.handoff?.link?.opencodeSessionId
  async function action(kind: 'plan' | 'execute' | 'review') {
    if (!props.thread || busy || (kind === 'plan' && !draft.trim())) return
    setSending(true); setError(null)
    try {
      await api.workflowAction(props.thread.id, kind, kind === 'plan' ? draft : undefined)
      if (kind === 'plan') setDraft('')
      props.onRefresh(); props.onRefreshSessions()
      props.onNotify(kind === 'execute' ? tr("أُرسلت خطة OpenCode إلى Codex للتنفيذ") : kind === 'review' ? tr("أُرسلت نتيجة Codex إلى OpenCode للمراجعة") : tr("أُرسلت الرسالة إلى OpenCode"))
    } catch (failure) { setError(failure instanceof Error ? failure.message : tr("تعذّر إرسال الطلب.")) }
    finally { setSending(false) }
  }
  async function stop() {
    if (!props.thread || sending) return
    setSending(true); setError(null)
    try { await api.stopOpenCode(props.thread.id); props.onRefresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : tr("تعذّر الإيقاف.")) }
    finally { setSending(false) }
  }
  return <section dir={direction()} aria-label={tr("OpenCode المفكّر والمراجع")} className="flex min-h-[22rem] min-w-0 flex-col bg-paper lg:min-h-0 lg:overflow-hidden">
    <header className="shrink-0 border-b border-line bg-card px-4 py-4"><h2 className="text-sm font-bold">{tr("OpenCode · المفكّر والمراجع")}</h2><p className="mt-1 text-[11px] leading-5 text-ink-soft">{tr("خطط مع OpenCode، أرسل خطته إلى Codex للتنفيذ، ثم اطلب مراجعة النتيجة.")}</p><code dir="ltr" className="mt-2 block truncate text-[10px] text-ink-soft">{props.thread?.directory ?? props.workRoot}</code>
      <details className="mt-3 rounded-lg border border-line bg-paper"><summary className="cursor-pointer px-3 py-2 text-xs font-bold">{tr("موديل OpenCode")}</summary><div className="p-2"><ModelPicker models={props.models} selected={props.model} onSelect={props.onModelChange} disabled={busy || props.changingModel} />{props.modelError ? <p role="alert" className="text-xs text-review-ink">{props.modelError}</p> : null}</div></details>
    </header>
    <McpPanel agent="opencode" busy={busy} />
    <div className="relative flex min-h-0 flex-1 flex-col"><div ref={scroll.ref} onScroll={scroll.handleScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5">
      {messages.length ? <ol className="mx-auto flex max-w-3xl flex-col gap-5">{messages.map(message => <li key={message.id}><MessageBubble message={message} speaker="opencode" /></li>)}</ol> : <p className="py-10 text-center text-sm text-ink-soft">{tr("اكتب طلبك إلى OpenCode ليحلله ويجهّز خطة التنفيذ.")}</p>}
      {sessionId ? forms.map(form => <QuestionForm key={form.id} sessionId={sessionId} form={form} onAnswered={props.onRefresh} onNotify={props.onNotify} />) : null}
    </div><ScrollToLatest visible={!scroll.following && messages.length > 0} onClick={() => scroll.scrollToLatest(true)} /></div>
    <footer className="shrink-0 space-y-3 border-t border-line bg-card p-3">
      {active ? <div className="flex items-center justify-between text-xs text-ready-ink"><span className="inline-flex items-center gap-2"><Spinner />{props.handoff?.activity.label ?? tr("OpenCode يفكّر…")}</span><button onClick={() => void stop()} disabled={sending} aria-label={tr("إيقاف OpenCode")} className="rounded-lg bg-review px-2 py-1 text-on-accent"><CircleStop className="h-4 w-4" /></button></div> : null}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void action('execute')} disabled={busy || !messages.some(message => message.role === 'assistant')} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-relay/30 px-3 py-2 text-xs font-bold text-relay-ink hover:bg-relay-tint disabled:opacity-40"><ArrowUpRight className="h-4 w-4" />{tr("أرسل الخطة إلى Codex للتنفيذ")}</button>
        <button onClick={() => void action('review')} disabled={busy || !props.codexHasReply} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-ready/30 px-3 py-2 text-xs font-bold text-ready-ink hover:bg-ready-tint disabled:opacity-40"><FileSearch className="h-4 w-4" />{tr("اطلب من OpenCode المراجعة")}</button>
      </div>
      <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-2"><textarea aria-label={tr("رسالة إلى OpenCode المفكّر")} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void action('plan') } }} rows={2} placeholder={tr("اكتب إلى OpenCode…")} className="min-h-14 flex-1 resize-none bg-transparent p-1 text-sm outline-none" /><button aria-label={tr("إرسال إلى OpenCode المفكّر")} onClick={() => void action('plan')} disabled={busy || !draft.trim()} className="rounded-lg bg-ready p-3 text-on-accent disabled:opacity-40">{sending ? <Spinner /> : <Send className="h-4 w-4" />}</button></div>
      {error ? <p role="alert" className="text-xs leading-5 text-review-ink">{tr(error)}</p> : null}
    </footer>
  </section>
}
