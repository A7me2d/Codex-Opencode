import { useEffect, useRef, useState } from 'react'
import { Bot, Brain, LoaderCircle, RefreshCw, Send, Square, Wrench } from 'lucide-react'
import { api } from '../../lib/api'
import { direction, useLocale } from '../../lib/i18n'
import { useChatHistory } from '../../hooks/useChatHistory'
import { MessageBubble } from '../../components/MessageBubble'
import { EarlierMessages } from '../../components/ui/EarlierMessages'
import { ComposerChoice } from '../../components/ui/ComposerChoice'
import type { CodexThread, WorkflowRoleView } from '../../lib/types'

/** A Cline role of the selected project conversation; no independent chat list. */
export function ClineConversation({ thread, role, view, blocked, visible, identity, onRefresh }: {
  thread: CodexThread; role: 'planner' | 'executor'; view?: WorkflowRoleView; blocked: boolean
  visible: boolean; identity?: string; onRefresh: () => Promise<unknown>
}) {
  const ar = useLocale() === 'ar'
  const data = view?.session
  const key = `${thread.id}:${role}`
  const current = useRef(key); current.current = key
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const draft = drafts[key] || ''
  const setDraft = (value: string) => setDrafts(previous => ({ ...previous, [key]: value }))
  const scroll = useChatHistory(view?.messages || [], key)
  useEffect(() => { setError('') }, [key])
  useEffect(() => {
    const insert = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string; role: string; text: string }>).detail
      if (!visible || detail?.threadId !== thread.id || detail.role !== role) return
      setDrafts(previous => ({ ...previous, [key]: [previous[key], detail.text].filter(Boolean).join('\n\n') }))
      requestAnimationFrame(() => textarea.current?.focus())
    }
    window.addEventListener('openzero:insert-cline-code', insert)
    return () => window.removeEventListener('openzero:insert-cline-code', insert)
  }, [visible, key, thread.id, role])
  async function perform(operation: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError('')
    const scope = key
    try {
      await operation()
      window.dispatchEvent(new CustomEvent('coding-room:conversation-activity', { detail: thread.id }))
      if (current.current === scope) await onRefresh()
    } catch (failure) { if (current.current === scope) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  async function send() {
    if (!draft.trim() || busy || blocked || thread.archived) return
    const text = draft, scope = key
    await perform(async () => {
      await api.sendClineRole(thread.id, role, text)
      setDrafts(previous => ({ ...previous, [scope]: '' }))
      if (current.current === scope) scroll.scrollToLatest()
    })
  }
  const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:bg-relay-tint disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40'
  const modelOption = data?.configOptions.find(option => option.id === 'model' && option.type === 'select')
  const modeOption = data?.configOptions.find(option => option.id === 'mode' && option.type === 'select')
  const choices = (option: typeof modelOption) => option?.options?.flatMap(item => item.options || (item.value ? [{ value: item.value, name: item.name }] : [])).map(item => ({ value: item.value, label: item.name })) || []
  const mode = String(modeOption?.currentValue || (role === 'planner' ? 'plan' : 'act'))
  return <section dir={direction()} className="chat-panel flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
    <header className="shrink-0 border-b border-line bg-card px-4 py-3">
      <strong className="text-sm">Cline · {role === 'planner' ? (ar ? 'المفكّر والمراجع' : 'Planner & reviewer') : (ar ? 'المنفّذ' : 'Executor')}</strong><p className="mt-1 truncate text-[11px] text-ink-soft">{thread.title || thread.name}</p>
    </header>
    <div ref={scroll.ref} onScroll={scroll.handleScroll} onWheel={scroll.handleWheel} className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <EarlierMessages count={scroll.hiddenCount} onLoad={scroll.loadOlder} />
      <div className="space-y-5">{scroll.visibleMessages.map(message => <MessageBubble key={message.id} message={{ ...message, live: Boolean(data?.active && message.id === data.messages[data.messages.length - 1]?.id) }} speaker="cline" codexIdentity={identity} />)}</div>
      {!view?.messages.length ? <p className="py-12 text-center text-sm leading-7 text-ink-soft">{role === 'planner' ? (ar ? 'اكتب طلبك هنا؛ أرسل آخر خطة إلى المنفّذ ثم راجع رده في نفس المحادثة.' : 'Plan here, send the latest plan to your executor, then review its reply in this conversation.') : (ar ? 'أرسل الخطة من الشات الرئيسي أو اكتب للمنفّذ هنا.' : 'Send the plan from the main chat or message your executor here.')}</p> : null}
      {data?.tools.length ? <details className="mt-5 text-xs text-ink-soft"><summary className="cursor-pointer">{ar ? 'الأدوات' : 'Tools'} ({data.tools.length})</summary><ul className="mt-2 space-y-2">{data.tools.map(tool => <li key={tool.id}>{tool.title} · {tool.status}</li>)}</ul></details> : null}
    </div>
    {data?.permissions.map(permission => <div key={permission.id} className="shrink-0 border-t border-line bg-card px-4 py-3"><p className="mb-2 text-xs font-semibold">{permission.title}</p><div className="flex flex-wrap gap-2">{permission.options.map(option => <button key={option.id} className={button} disabled={busy} onClick={() => void perform(() => api.permissionCline(data.id, permission.id, option.id))}>{option.name}</button>)}</div></div>)}
    <form onSubmit={event => { event.preventDefault(); void send() }} className="shrink-0 bg-transparent px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
      <div className="flex items-center gap-2.5">
        <div className="codex-input-capsule relative min-w-0 flex-1 rounded-3xl border border-line bg-transparent px-3 pb-2 pt-3 shadow-lg focus-within:border-relay/60 focus-within:ring-2 focus-within:ring-relay/10">
          <textarea ref={textarea} aria-label={ar ? 'رسالة إلى Cline' : 'Message Cline'} placeholder={ar ? 'اكتب إلى Cline…' : 'Message Cline…'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} rows={2} className="block min-h-12 w-full min-w-0 resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-ink-soft/75" />
          <div className="mt-2 flex flex-wrap items-center gap-0.5">
            <ComposerChoice ar={ar} label={ar ? 'موديل Cline' : 'Cline model'} icon={Bot} value={String(modelOption?.currentValue || thread.workflow?.[`${role}Model`] || '')} options={choices(modelOption)} searchable disabled={busy || blocked || !data || Boolean(thread.archived)} onChange={value => { if (data) void perform(() => api.configCline(data.id, 'model', value)) }} />
            <ComposerChoice ar={ar} label={ar ? 'الوضع' : 'Mode'} icon={mode === 'act' ? Wrench : Brain} value={mode} fallback={mode === 'act' ? 'Act' : 'Plan'} options={choices(modeOption)} disabled={busy || blocked || !data || Boolean(thread.archived)} onChange={value => { if (data) void perform(() => api.configCline(data.id, 'mode', value)) }} />
            <button type="button" className="ms-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-40" onClick={() => void perform(() => data ? api.connectCline(data.id) : api.ensureClineRole(thread.id, role))} disabled={busy || blocked || thread.archived} title={data ? (ar ? 'إعادة الاتصال' : 'Reconnect') : (ar ? 'تحميل خيارات Cline' : 'Load Cline options')} aria-label={data ? (ar ? 'إعادة الاتصال' : 'Reconnect') : (ar ? 'تحميل خيارات Cline' : 'Load Cline options')}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</button>
          </div>
        </div>
        {data?.active ? <button type="button" className="codex-send-or-stop inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-review text-on-accent shadow-lg hover:bg-review-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-review/50 disabled:opacity-40" disabled={busy} onClick={() => void perform(() => api.stopCline(data.id))} aria-label={ar ? 'إيقاف Cline' : 'Stop Cline'}><Square className="h-4 w-4" /></button> : <button type="submit" className="codex-send-or-stop inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-relay text-on-accent shadow-lg hover:bg-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-40" disabled={!view || !draft.trim() || busy || blocked || thread.archived} aria-label={ar ? 'إرسال' : 'Send'}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>}
      </div>
      {error || data?.error ? <p role="alert" className="mt-2 px-1 text-xs leading-5 text-review-ink">{error || data?.error}</p> : null}
    </form>
  </section>
}
