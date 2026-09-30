import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  ArrowUpRight,
  Bot,
  CircleStop,
  CircleDot,
  FilePenLine,
  FileSearch,
  FolderOpen,
  GitPullRequestArrow,
  LoaderCircle,
  MessageCircleMore,
  PanelLeft,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TerminalSquare,
  TriangleAlert,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'

type RequestStatus = 'idle' | 'loading' | 'ready' | 'error'

interface RequestState<T> {
  data: T | null
  error: string | null
  status: RequestStatus
}

interface CodexStatus {
  connected: boolean
  identity?: string
  root?: string
  error?: string
}

interface OpenCodeStatus {
  online: boolean
  root?: string
  error?: string
}

interface CodexThread {
  id: string
  title?: string
  name?: string
  createdAt?: number | string
  updatedAt?: number | string
  cwd?: string
}

interface CodexItem {
  id: string
  type: string
  text?: string
  content?: unknown
  phase?: 'commentary' | 'final_answer'
  live?: boolean
}

interface CodexTurnState {
  active: boolean
  stopping?: boolean
  turnId?: string
  startedAt?: number
}

interface ProjectInfo {
  directory: string
}

interface HandoffLink {
  codexThreadId: string
  opencodeSessionId: string
  title?: string
  createdAt?: number
  updatedAt?: number
}

interface OpenCodeActivity {
  active: boolean
  kind: 'idle' | 'thinking' | 'edit' | 'command' | 'inspect' | 'tool'
  label: string
  detail?: string
  toolName?: string
  updatedAt?: number
}

interface HandoffData {
  link: HandoffLink | null
  messages: unknown[]
  forms: unknown[]
  inbox: unknown[]
  active: boolean
  activity: OpenCodeActivity
}

interface RelayEvent {
  id: string
  timestamp: number
  role: string
  kind: string
  message: string
  sessionId?: string
  codexThreadId?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  live?: boolean
}

const pollCodexMessagesMs = 1_400
const pollHandoffMs = 1_200
const pollTurnStateMs = 800

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status}).`)
  return body as T
}

function usePolling<T>(url: string | null, intervalMs: number) {
  const [state, setState] = useState<RequestState<T>>({ data: null, error: null, status: 'idle' })

  const refresh = useCallback(async () => {
    if (!url) {
      setState({ data: null, error: null, status: 'idle' })
      return null
    }
    setState((previous) => ({ ...previous, status: previous.data ? 'ready' : 'loading', error: null }))
    try {
      const body = await requestJson<{ data?: T } & T>(url)
      const data = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data as T : body as T
      setState({ data, error: null, status: 'ready' })
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تحميل البيانات.'
      setState((previous) => ({ ...previous, error: message, status: previous.data ? 'ready' : 'error' }))
      return null
    }
  }, [url])

  useEffect(() => {
    void refresh()
    if (!url) return undefined
    const timer = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, refresh, url])

  return { ...state, refresh }
}

function toEpoch(value: unknown) {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function relativeTime(value: unknown) {
  const timestamp = toEpoch(value)
  if (!timestamp) return 'الآن'
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `منذ ${minutes} د`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `منذ ${hours} س`
  return `منذ ${Math.round(hours / 24)} ي`
}

function clip(text: string, max = 88) {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function readText(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((part) => readText(part, depth + 1)).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (typeof record.message === 'string') return record.message
    if (record.content) return readText(record.content, depth + 1)
  }
  return ''
}

function codexChat(items: CodexItem[] | null) {
  return (items ?? []).flatMap<ChatMessage>((item) => {
    if (item.type === 'userMessage') {
      const text = readText(item.content)
      return text ? [{ id: item.id, role: 'user', text }] : []
    }
    if (item.type === 'agentMessage') {
      const text = item.text ?? readText(item.content)
      return text ? [{ id: item.id, role: 'assistant', text, live: item.live }] : []
    }
    return []
  })
}

function openCodeChat(messages: unknown[]) {
  return messages.flatMap<ChatMessage>((message, index) => {
    const record = message && typeof message === 'object' ? message as Record<string, unknown> : {}
    const type = record.type
    if (type !== 'user' && type !== 'assistant') return []
    const content = Array.isArray(record.content)
      ? record.content.filter((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text')
      : record.content
    const text = readText(record.text ?? content ?? record.message)
    return text ? [{ id: String(record.id ?? `opencode-${index}`), role: type, text }] : []
  }).reverse()
}

function formLabel(form: unknown) {
  if (!form || typeof form !== 'object') return 'OpenCode يحتاج إلى توضيح'
  const record = form as Record<string, unknown>
  return readText(record.title ?? record.question ?? record.description) || 'OpenCode يحتاج إلى توضيح'
}

function openCodeActivityIcon(kind: OpenCodeActivity['kind']) {
  if (kind === 'edit') return <FilePenLine className="h-4 w-4" aria-hidden="true" />
  if (kind === 'command') return <TerminalSquare className="h-4 w-4" aria-hidden="true" />
  if (kind === 'inspect') return <FileSearch className="h-4 w-4" aria-hidden="true" />
  return <Sparkles className="h-4 w-4" aria-hidden="true" />
}

function relayEventHeading(event: RelayEvent) {
  if (event.kind === 'opencode-message-sent') return 'أنت → OpenCode'
  if (event.kind === 'opencode-stop-requested') return 'طلبت إيقاف OpenCode'
  return 'أرسل Codex إلى OpenCode'
}

function OpenCodeComposer({ draft, onChange, onSubmit, sending, active, disabled, error }: {
  draft: string
  onChange: (value: string) => void
  onSubmit: () => void
  sending: boolean
  active: boolean
  disabled: boolean
  error: string | null
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit() }
  const keyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit() } }
  return <form onSubmit={submit} className="border-t border-line bg-paper p-3">
    <label className="mb-2 block text-[11px] font-bold text-ready-ink">رسالة مباشرة إلى OpenCode</label>
    <div className="flex items-end gap-2 rounded-xl border border-ready/20 bg-card p-2 focus-within:border-ready/55 focus-within:ring-2 focus-within:ring-ready/10">
      <textarea value={draft} onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} disabled={disabled || sending} rows={2} placeholder={active ? 'اكتب تصحيحًا، سيصل إلى العمل الجاري…' : 'اكتب إلى OpenCode مباشرة…'} className="min-h-[3.25rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft/75 disabled:cursor-not-allowed" />
      <button type="submit" disabled={disabled || sending || !draft.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ready text-white transition-colors hover:bg-ready-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label="إرسال إلى OpenCode">{sending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}</button>
    </div>
    <p className="mt-2 px-1 text-[10px] leading-5 text-ink-soft">{active ? 'ستوجّه رسالتك العمل الجاري مباشرة، وإذا أردت إيقافه استخدم زر الإيقاف أعلاه.' : 'ستدخل رسالتك إلى جلسة OpenCode المرتبطة بهذه المحادثة.'}</p>
    {error ? <div className="mt-2 flex items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}</div> : null}
  </form>
}

function StateDot({ active, warning = false }: { active: boolean; warning?: boolean }) {
  return <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', active ? 'bg-ready' : warning ? 'bg-review' : 'bg-line-strong')} />
}

function StatusPill({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'codex' | 'openCode' | 'warning' }) {
  const tones = {
    quiet: 'border-line bg-paper text-ink-soft',
    codex: 'border-relay/20 bg-relay-tint text-relay-ink',
    openCode: 'border-ready/20 bg-ready-tint text-ready-ink',
    warning: 'border-review/20 bg-review-tint text-review-ink',
  }
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', tones[tone])}>{children}</span>
}

function SessionList({ threads, selectedId, onSelect, onCreate, creating, connected, projectDirectory, onOpenProject, openingProject }: {
  threads: CodexThread[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  creating: boolean
  connected: boolean
  projectDirectory?: string
  onOpenProject: () => void
  openingProject: boolean
}) {
  return (
    <aside dir="rtl" className="flex min-h-[14rem] flex-col border-b border-line bg-card lg:min-h-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between border-b border-line px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink"><PanelLeft className="h-4 w-4 text-relay" aria-hidden="true" /> جلسات Codex</div>
        <button type="button" onClick={onCreate} disabled={!connected || creating} className="inline-flex items-center gap-1.5 rounded-lg bg-relay px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45">
          {creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          محادثة
        </button>
      </div>
      <div className="border-b border-line px-4 py-3 text-xs text-ink-soft"><div className="flex items-center gap-2"><StateDot active={connected} warning={!connected} />{connected ? 'مرتبطة بـ Codex Desktop المحلي' : 'تعذر الاتصال بـ Codex Desktop'}</div></div>
      <div className="border-b border-line p-3">
        <button type="button" onClick={onOpenProject} disabled={openingProject} className="flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2.5 text-right text-xs text-ink transition-colors hover:border-relay/35 hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-55" aria-label="فتح مجلد المشروع في مستكشف الملفات">
          {openingProject ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-relay" aria-hidden="true" /> : <FolderOpen className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />}
          <span className="min-w-0 flex-1"><span className="block font-bold">فتح ملفات المشروع</span>{projectDirectory ? <code dir="ltr" className="mt-0.5 block truncate text-[10px] font-normal text-ink-soft" title={projectDirectory}>{projectDirectory}</code> : <span className="mt-0.5 block text-[10px] text-ink-soft">يتم تحديد المسار…</span>}</span>
        </button>
      </div>
      <nav aria-label="جلسات Codex" className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? <div className="px-3 py-6 text-center text-xs leading-6 text-ink-soft">لا توجد جلسات هنا بعد.<br />ابدأ محادثة لكي تظهر في هذه القائمة.</div> : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const selected = thread.id === selectedId
              const title = thread.title ?? thread.name ?? 'محادثة جديدة'
              return <button type="button" key={thread.id} onClick={() => onSelect(thread.id)} className={cx('w-full rounded-lg px-3 py-3 text-right transition-colors', selected ? 'bg-relay-tint text-relay-ink' : 'text-ink hover:bg-paper')}>
                <div className="flex items-start gap-2"><MessageCircleMore className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-relay' : 'text-ink-soft')} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{clip(title, 52)}</span><span className={cx('mt-1 block text-[10px]', selected ? 'text-relay-ink/75' : 'text-ink-soft')}>{relativeTime(thread.updatedAt)}</span></span></div>
              </button>
            })}
          </div>
        )}
      </nav>
      <div className="border-t border-line px-4 py-3 text-[10px] leading-5 text-ink-soft">تظهر هنا الجلسات التي أنشأها Relay Room فقط، حتى لا تختلط مع محادثاتك الأخرى.</div>
    </aside>
  )
}

function MessageBubble({ message, speaker }: { message: ChatMessage; speaker: 'codex' | 'opencode' }) {
  const isUser = message.role === 'user'
  const agentName = speaker === 'codex' ? 'Codex' : 'OpenCode'
  const agentIcon = speaker === 'codex' ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <Bot className="h-3.5 w-3.5" aria-hidden="true" />
  return (
    <article className={cx('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cx('mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', isUser ? 'bg-ink text-white' : speaker === 'codex' ? 'bg-relay-tint text-relay-ink' : 'bg-ready-tint text-ready-ink')} aria-hidden="true">{isUser ? <UserRound className="h-3.5 w-3.5" /> : agentIcon}</div>
      <div className={cx('min-w-0 max-w-[85%]', isUser ? 'text-right' : 'text-right')}>
        <div className={cx('mb-1 flex items-center gap-1.5 text-[10px] font-bold text-ink-soft', isUser ? 'justify-start' : '')}><span>{isUser ? 'أنت' : agentName}</span>{message.live ? <LoaderCircle className="h-3 w-3 animate-spin text-relay" aria-label="يكتب الآن" /> : null}</div>
        <div className={cx('whitespace-pre-wrap rounded-xl px-3.5 py-3 text-[13px] leading-7 shadow-[0_1px_1px_rgba(25,35,48,0.04)]', isUser ? 'bg-ink text-white' : 'border border-line bg-card text-ink')}>{message.text}</div>
      </div>
    </article>
  )
}

function Composer({ draft, onChange, onSubmit, sending, disabled, error, attachments, onAttach, onRemoveAttachment, attaching, turn, onStop }: {
  draft: string
  onChange: (value: string) => void
  onSubmit: () => void
  sending: boolean
  disabled: boolean
  error: string | null
  attachments: string[]
  onAttach: () => void
  onRemoveAttachment: (path: string) => void
  attaching: boolean
  turn: CodexTurnState
  onStop: () => void
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit() }
  const keyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit() } }
  const isDelegation = /(?:^|\s)\$opencode\b/i.test(draft)
  const busy = sending || turn.active
  const starting = sending && !turn.active
  const canSend = !disabled && !busy && Boolean(draft.trim() || attachments.length)
  return <form onSubmit={submit} className="border-t border-line bg-card p-3 sm:p-4">
    {attachments.length > 0 ? <div className="mb-2 rounded-lg border border-relay/20 bg-relay-tint/55 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-relay-ink"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />ملف مرتبط بالرسالة</div>
      <p className="mt-1 text-[10px] leading-5 text-relay-ink/80">سيُرسل المسار فقط إلى Codex، ولن يُرفع محتوى الملف.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{attachments.map((path) => <span key={path} className="inline-flex max-w-full items-center gap-1 rounded-md border border-relay/20 bg-card py-1 pl-1 pr-2 text-[11px] text-ink"><Paperclip className="h-3 w-3 shrink-0 text-relay" aria-hidden="true" /><code dir="ltr" className="min-w-0 truncate" title={path}>{path}</code><button type="button" onClick={() => onRemoveAttachment(path)} disabled={busy} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-paper hover:text-ink disabled:cursor-not-allowed" aria-label={`إزالة ${path}`}><X className="h-3 w-3" aria-hidden="true" /></button></span>)}</div>
    </div> : null}
    <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-2 focus-within:border-relay/60 focus-within:ring-2 focus-within:ring-relay/10">
      <button type="button" onClick={onAttach} disabled={disabled || busy || attaching} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label="اختيار ملف من المشروع وإرسال مساره فقط" title="إرسال مسار ملف فقط">{attaching ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}</button>
      <textarea value={draft} onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} disabled={disabled || busy} rows={2} placeholder="اكتب إلى Codex… أضف $opencode عندما تريد إرسال التنفيذ إلى OpenCode." className="min-h-[3.4rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft/75 disabled:cursor-not-allowed" />
      {turn.active ? <button type="button" onClick={onStop} disabled={turn.stopping} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-review text-white transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-55" aria-label="إيقاف Codex فورًا" title="إيقاف Codex فورًا">{turn.stopping ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleStop className="h-4 w-4" aria-hidden="true" />}</button> : <button type="submit" disabled={!canSend} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-relay text-white transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label="إرسال إلى Codex">{sending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}</button>}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-soft"><span>Enter للإرسال · Shift + Enter لسطر جديد</span>{turn.active ? <span role="status" className="inline-flex items-center gap-1.5 font-bold text-review-ink"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{turn.stopping ? 'يجري إيقاف Codex…' : 'Codex يفكّر الآن، ويمكنك إيقافه فورًا.'}</span> : starting ? <span role="status" className="inline-flex items-center gap-1.5 font-bold text-relay-ink"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />جارٍ بدء دور Codex…</span> : isDelegation ? <span className="font-mono text-relay-ink">$opencode ← سيظهر التفويض في المسار الجانبي</span> : <span>Codex يفكر ويراجع؛ OpenCode لا يعمل إلا بالوسم.</span>}</div>
    {error ? <div className="mt-2 flex items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}</div> : null}
  </form>
}

function CodexConversation({ thread, messages, loading, draft, onDraftChange, onSend, sending, error, onNewThread, attachments, onAttach, onRemoveAttachment, attaching, turn, onStop }: {
  thread: CodexThread | null
  messages: ChatMessage[]
  loading: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  sending: boolean
  error: string | null
  onNewThread: () => void
  attachments: string[]
  onAttach: () => void
  onRemoveAttachment: (path: string) => void
  attaching: boolean
  turn: CodexTurnState
  onStop: () => void
}) {
  const transcriptRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const element = transcriptRef.current; if (element) element.scrollTop = element.scrollHeight }, [messages.length, messages[messages.length - 1]?.text])
  if (!thread) return <section dir="rtl" className="flex min-h-[32rem] min-w-0 flex-col bg-paper lg:min-h-0"><div className="flex h-full flex-1 items-center justify-center px-8 text-center"><div className="max-w-md"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-relay-tint text-relay-ink"><Sparkles className="h-6 w-6" aria-hidden="true" /></div><h1 className="mt-5 text-xl font-bold text-ink">ابدأ من شات Codex</h1><p className="mt-3 text-sm leading-7 text-ink-soft">اكتب طلبك هنا. إذا أردت أن ينفّذ OpenCode، أضف <code className="rounded bg-card px-1.5 py-0.5 font-mono text-relay-ink">$opencode</code> داخل الرسالة، وسترى التسليم والرد في المساحة الجانبية.</p><button type="button" onClick={onNewThread} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-relay px-4 py-2.5 text-sm font-bold text-white hover:bg-relay-ink"><Plus className="h-4 w-4" aria-hidden="true" />محادثة Codex جديدة</button></div></div></section>
  return <section dir="rtl" className="flex min-h-[32rem] min-w-0 flex-col bg-paper lg:min-h-0">
    <header className="flex items-center justify-between gap-4 border-b border-line bg-card px-4 py-3.5 sm:px-5"><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-bold text-ink"><Sparkles className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" /><span className="truncate">{thread.title ?? thread.name ?? 'محادثة جديدة'}</span></div><p className="mt-1 text-[11px] text-ink-soft">هنا تتحدث مع Codex — التخطيط، المنطق، والمراجعة.</p></div>{turn.active ? <StatusPill tone="warning"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />{turn.stopping ? 'يتم الإيقاف' : 'Codex يفكّر'}</StatusPill> : sending ? <StatusPill tone="warning"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />يبدأ Codex</StatusPill> : <StatusPill tone="codex"><CircleDot className="h-3 w-3" aria-hidden="true" /> Codex</StatusPill>}</header>
    <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      {loading && messages.length === 0 ? <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />يتم تحميل المحادثة…</div> : messages.length === 0 ? <div className="flex h-full items-center justify-center text-center"><p className="max-w-sm text-sm leading-7 text-ink-soft">هذه جلسة جديدة. اكتب ما تريد من Codex أن يفهمه أو يخطط له.</p></div> : <div className="mx-auto flex max-w-3xl flex-col gap-5">{messages.map((message) => <MessageBubble key={message.id} message={message} speaker="codex" />)}</div>}
    </div>
    <Composer draft={draft} onChange={onDraftChange} onSubmit={onSend} sending={sending} disabled={false} error={error} attachments={attachments} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} attaching={attaching} turn={turn} onStop={onStop} />
  </section>
}

function HandoffRail({ thread, handoff, loading, events, onReview, reviewing, openCodeDraft, onOpenCodeDraftChange, onSendOpenCode, sendingOpenCode, openCodeError, onStopOpenCode, stoppingOpenCode }: {
  thread: CodexThread | null
  handoff: HandoffData | null
  loading: boolean
  events: RelayEvent[]
  onReview: () => void
  reviewing: boolean
  openCodeDraft: string
  onOpenCodeDraftChange: (value: string) => void
  onSendOpenCode: () => void
  sendingOpenCode: boolean
  openCodeError: string | null
  onStopOpenCode: () => void
  stoppingOpenCode: boolean
}) {
  const openCodeMessages = useMemo(() => openCodeChat(handoff?.messages ?? []), [handoff?.messages])
  const threadEvents = useMemo(() => events.filter((event) => event.codexThreadId === thread?.id && event.kind === 'handoff-sent').sort((a, b) => a.timestamp - b.timestamp), [events, thread?.id])
  const activity = handoff?.activity ?? { active: false, kind: 'idle' as const, label: 'لا توجد عملية OpenCode نشطة' }
  const requiresAttention = Boolean(handoff?.forms.length)
  return <aside dir="rtl" className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card lg:min-h-0 lg:border-l lg:border-t-0">
    <div className="border-b border-line px-4 py-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold text-ink"><ArrowUpRight className="h-4 w-4 text-ready" aria-hidden="true" />مسار التفويض</div><StatusPill tone="openCode"><Bot className="h-3 w-3" aria-hidden="true" /> Big Pickle</StatusPill></div><p className="mt-2 text-[11px] leading-5 text-ink-soft">ما يرسله Codex إلى OpenCode، وما يرد به، يظهر هنا كما هو.</p></div>
    {!thread ? <div className="flex flex-1 items-center justify-center px-6 text-center text-sm leading-7 text-ink-soft">اختر جلسة Codex أولًا لرؤية أي تفويض مرتبط بها.</div> : loading && !handoff ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />يتم فحص مسار التفويض…</div> : !handoff?.link ? <div className="flex flex-1 items-center justify-center px-6 text-center"><div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-ready-tint text-ready-ink"><TerminalSquare className="h-5 w-5" aria-hidden="true" /></div><h2 className="mt-4 text-sm font-bold text-ink">لم يُفوَّض OpenCode في هذه الجلسة</h2><p className="mt-2 text-xs leading-6 text-ink-soft">في شات Codex اكتب <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-relay-ink">$opencode</code> ثم طلب التنفيذ. لن يبدأ OpenCode بدون هذا الوسم.</p></div></div> : <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line bg-paper px-4 py-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-bold text-ink"><StateDot active={handoff.active} warning={handoff.forms.length > 0} />{handoff.forms.length > 0 ? 'OpenCode يحتاج توضيحًا' : handoff.active ? 'OpenCode يعمل الآن' : 'لا توجد عملية OpenCode نشطة'}</div><code className="ltr max-w-[8rem] truncate text-[10px] text-ink-soft">{handoff.link.opencodeSessionId}</code></div></div>
      <div className="space-y-4 px-4 py-4">
        {threadEvents.length > 0 ? <div className="border-b border-line pb-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-relay-ink">Codex ←→ OpenCode</p><div className="space-y-2">{threadEvents.slice(-2).map((event) => <div key={event.id} className="rounded-lg bg-relay-tint px-3 py-2.5 text-xs leading-6 text-relay-ink"><span className="mb-1 block text-[10px] font-bold">أرسل Codex إلى OpenCode</span>{event.message}</div>)}</div></div> : null}
        {openCodeMessages.length === 0 ? <div className="py-4 text-center text-xs leading-6 text-ink-soft">تم إنشاء رابط OpenCode، لكن لا توجد رسالة مرئية منه بعد. ستظهر أول رسالة فعلية هنا تلقائيًا.</div> : <div className="space-y-4">{openCodeMessages.map((message) => <MessageBubble key={message.id} message={message} speaker="opencode" />)}</div>}
        {handoff.forms.length > 0 ? <div className="rounded-lg border border-review/25 bg-review-tint px-3 py-3 text-xs text-review-ink"><div className="flex items-center gap-2 font-bold"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />OpenCode ينتظر توضيحًا</div><ul className="mt-2 list-inside list-disc space-y-1 leading-5">{handoff.forms.map((form, index) => <li key={index}>{formLabel(form)}</li>)}</ul></div> : null}
        {!handoff.active && handoff.forms.length === 0 && openCodeMessages.length > 0 ? <button type="button" onClick={onReview} disabled={reviewing} className="flex w-full items-center justify-center gap-2 rounded-lg border border-relay/30 bg-card px-3 py-2.5 text-xs font-bold text-relay-ink transition-colors hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-45">{reviewing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />}اطلب من Codex مراجعة التنفيذ</button> : null}
      </div>
    </div>}
  </aside>
}

export default function App() {
  const codexStatus = usePolling<CodexStatus>('/api/codex/status', 10_000)
  const openCodeStatus = usePolling<OpenCodeStatus>('/api/health', 10_000)
  const projectRequest = usePolling<ProjectInfo>('/api/project', 60_000)
  const threadRequest = usePolling<CodexThread[]>('/api/codex/threads', 5_000)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedThread = useMemo(() => (threadRequest.data ?? []).find((thread) => thread.id === selectedId) ?? null, [selectedId, threadRequest.data])
  const codexMessagesRequest = usePolling<CodexItem[]>(selectedId ? `/api/codex/threads/${selectedId}/messages` : null, pollCodexMessagesMs)
  const turnStatusRequest = usePolling<CodexTurnState>(selectedId ? `/api/codex/threads/${selectedId}/status` : null, pollTurnStateMs)
  const handoffRequest = usePolling<HandoffData>(selectedId ? `/api/codex/threads/${selectedId}/handoff` : null, pollHandoffMs)
  const relayEventsRequest = usePolling<RelayEvent[]>('/api/relay-events', 3_000)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [openingProject, setOpeningProject] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)

  useEffect(() => { if (!selectedId && threadRequest.data?.length) setSelectedId(threadRequest.data[0].id) }, [selectedId, threadRequest.data])
  useEffect(() => { setDraft(''); setAttachments([]); setComposerError(null) }, [selectedId])

  const createThread = useCallback(async () => {
    if (creating || !codexStatus.data?.connected) return
    setCreating(true); setComposerError(null)
    try {
      const response = await requestJson<{ data: CodexThread }>('/api/codex/threads', { method: 'POST', body: JSON.stringify({ title: 'محادثة جديدة' }) })
      setSelectedId(response.data.id)
      await threadRequest.refresh()
    } catch (error) { setComposerError(error instanceof Error ? error.message : 'تعذر إنشاء جلسة Codex.') } finally { setCreating(false) }
  }, [codexStatus.data?.connected, creating, threadRequest])

  const turnState = turnStatusRequest.data ?? { active: false }
  const activeTurn: CodexTurnState = { ...turnState, stopping: Boolean(turnState.stopping || stopping) }

  const openProject = useCallback(async () => {
    if (openingProject) return
    setOpeningProject(true)
    setComposerError(null)
    try {
      await requestJson('/api/project/open', { method: 'POST' })
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'تعذر فتح ملفات المشروع.')
    } finally {
      setOpeningProject(false)
    }
  }, [openingProject])

  const attachProjectFile = useCallback(async () => {
    if (!selectedId || attaching || sending || activeTurn.active) return
    setAttaching(true)
    setComposerError(null)
    try {
      const response = await requestJson<{ data: { path: string } | null }>('/api/project/select-file', { method: 'POST' })
      const selectedPath = response.data?.path
      if (selectedPath) setAttachments((current) => current.includes(selectedPath) ? current : [...current, selectedPath])
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'تعذر اختيار ملف من المشروع.')
    } finally {
      setAttaching(false)
    }
  }, [activeTurn.active, attaching, selectedId, sending])

  const removeAttachment = useCallback((path: string) => {
    setAttachments((current) => current.filter((entry) => entry !== path))
  }, [])

  const sendMessage = useCallback(async (override?: string) => {
    const text = override ?? [draft.trim(), ...attachments].filter(Boolean).join('\n')
    if (!selectedId || !text || sending || activeTurn.active) return
    setSending(true); setComposerError(null)
    try {
      await requestJson(`/api/codex/threads/${selectedId}/messages`, { method: 'POST', body: JSON.stringify({ text }) })
      if (!override) { setDraft(''); setAttachments([]) }
      await Promise.all([codexMessagesRequest.refresh(), turnStatusRequest.refresh(), handoffRequest.refresh(), threadRequest.refresh()])
    } catch (error) { setComposerError(error instanceof Error ? error.message : 'تعذر إرسال الرسالة إلى Codex.') } finally { setSending(false) }
  }, [activeTurn.active, attachments, codexMessagesRequest, draft, handoffRequest, selectedId, sending, threadRequest, turnStatusRequest])

  const stopCodexTurn = useCallback(async () => {
    if (!selectedId || !activeTurn.active || activeTurn.stopping) return
    setStopping(true)
    setComposerError(null)
    try {
      await requestJson(`/api/codex/threads/${selectedId}/stop`, { method: 'POST' })
      await Promise.all([turnStatusRequest.refresh(), codexMessagesRequest.refresh(), handoffRequest.refresh()])
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'تعذر إيقاف Codex.')
    } finally {
      setStopping(false)
    }
  }, [activeTurn.active, activeTurn.stopping, codexMessagesRequest, handoffRequest, selectedId, turnStatusRequest])

  const requestReview = useCallback(() => { void sendMessage('راجع الآن آخر تنفيذ من OpenCode: افحص git diff، وشغّل الاختبار أو build أو lint المناسب إن أمكن، ثم اذكر النتيجة وما يحتاج تصحيحًا بدليل واضح.') }, [sendMessage])
  const refreshAll = useCallback(() => { void Promise.all([codexStatus.refresh(), openCodeStatus.refresh(), projectRequest.refresh(), threadRequest.refresh(), codexMessagesRequest.refresh(), turnStatusRequest.refresh(), handoffRequest.refresh(), relayEventsRequest.refresh()]) }, [codexMessagesRequest, codexStatus, handoffRequest, openCodeStatus, projectRequest, relayEventsRequest, threadRequest, turnStatusRequest])
  const messages = useMemo(() => codexChat(codexMessagesRequest.data), [codexMessagesRequest.data])
  const codexConnected = Boolean(codexStatus.data?.connected)
  const openCodeOnline = Boolean(openCodeStatus.data?.online)

  return <div dir="rtl" className="min-h-screen bg-paper text-ink">
    <header className="border-b border-line bg-card px-4 py-3.5 sm:px-6"><div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-6 gap-y-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white"><GitPullRequestArrow className="h-4.5 w-4.5" aria-hidden="true" /></div><div><div className="text-sm font-extrabold tracking-tight text-ink">Relay Room</div><div className="text-[11px] text-ink-soft">شات Codex ومراقبة تسليم OpenCode</div></div></div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={codexConnected ? 'codex' : 'warning'}>{codexConnected ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}{codexConnected ? 'Codex Desktop متصل' : 'Codex غير متصل'}</StatusPill><StatusPill tone={openCodeOnline ? 'openCode' : 'warning'}><StateDot active={openCodeOnline} warning={!openCodeOnline} />{openCodeOnline ? 'OpenCode متاح' : 'OpenCode لا يرد'}</StatusPill><button type="button" onClick={refreshAll} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft hover:border-relay/40 hover:text-relay-ink"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />تحديث</button></div></div>{!codexConnected && codexStatus.data?.error ? <div className="mx-auto mt-3 max-w-[1800px] rounded-lg bg-review-tint px-3 py-2 text-xs text-review-ink">افتح Codex Desktop وسجّل الدخول ثم اضغط تحديث. {codexStatus.data.error}</div> : null}</header>
    <main dir="ltr" className="mx-auto grid min-h-[calc(100vh-82px)] max-w-[1800px] grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_23rem]">
      <SessionList threads={threadRequest.data ?? []} selectedId={selectedId} onSelect={setSelectedId} onCreate={() => void createThread()} creating={creating} connected={codexConnected} projectDirectory={projectRequest.data?.directory} onOpenProject={() => void openProject()} openingProject={openingProject} />
      <CodexConversation thread={selectedThread} messages={messages} loading={codexMessagesRequest.status === 'loading'} draft={draft} onDraftChange={setDraft} onSend={() => void sendMessage()} sending={sending} error={composerError} onNewThread={() => void createThread()} attachments={attachments} onAttach={() => void attachProjectFile()} onRemoveAttachment={removeAttachment} attaching={attaching} turn={activeTurn} onStop={() => void stopCodexTurn()} />
      <HandoffRail thread={selectedThread} handoff={handoffRequest.data} loading={handoffRequest.status === 'loading'} events={relayEventsRequest.data ?? []} onReview={requestReview} reviewing={sending || activeTurn.active} />
    </main>
  </div>
}
