import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  ArrowDown,
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
  MessageCircleQuestion,
  PanelLeft,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TerminalSquare,
  Timer,
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
const stickyScrollThresholdPx = 72

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const raw = await response.text()
  let body: unknown
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    // A dev server without the API proxy answers unknown paths with index.html.
    throw new Error(response.ok
      ? 'استجابة غير متوقعة من الخادم — شغّل Relay Room بالأمر npm start.'
      : `Request failed (${response.status}).`)
  }
  const failure = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (!response.ok) throw new Error(typeof failure === 'string' ? failure : `Request failed (${response.status}).`)
  return body as T
}

/** Collections arrive from several bridges, so never trust the shape blindly. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
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

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Pins a chat pane to its newest message while the reader stays at the bottom,
 * and leaves the reader alone once they scroll up to read history.
 */
function useStickyScroll(content: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  const scrollToLatest = useCallback((smooth = false) => {
    const element = ref.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  }, [])

  const handleScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight <= stickyScrollThresholdPx)
  }, [])

  useEffect(() => {
    if (!following) return
    scrollToLatest()
  }, [content, following, scrollToLatest])

  return { ref, following, handleScroll, scrollToLatest }
}

type AlertTone = 'codex' | 'openCode' | 'question'

interface AgentAlert {
  id: string
  tone: AlertTone
  title: string
  detail?: string
  persistent: boolean
}

/** A turn shorter than this is noise (a rejected send, an instant stop), not news. */
const minimumTurnMs = 4_000

function desktopNotify(title: string, body?: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag: 'relay-room' })
  } catch {
    // A blocked notification must never break the in-app alert.
  }
}

/**
 * Watches both agents and reports the two moments the operator cannot see from
 * the composer: a turn that ended while they were typing, and a question that
 * is blocking the run.
 */
function useAgentAlerts({ codexActive, openCodeActive, questionCount, subject, scope }: {
  codexActive: boolean
  openCodeActive: boolean
  questionCount: number
  subject: string
  scope: string
}) {
  const [alerts, setAlerts] = useState<AgentAlert[]>([])
  const [unread, setUnread] = useState(0)
  const previous = useRef({ codexActive: false, openCodeActive: false, questionCount: 0, startedAt: 0, scope })

  const dismiss = useCallback((id: string) => {
    setAlerts((current) => current.filter((alert) => alert.id !== id))
  }, [])

  const push = useCallback((tone: AlertTone, title: string, detail?: string, persistent = false) => {
    setAlerts((current) => {
      if (current.some((alert) => alert.title === title && alert.detail === detail)) return current
      const next = [...current, { id: `${tone}-${Date.now()}-${current.length}`, tone, title, detail, persistent }]
      return next.length > 3 ? next.slice(next.length - 3) : next
    })
    setUnread((count) => count + 1)
    desktopNotify(title, detail)
  }, [])

  const notify = useCallback((title: string, detail?: string, tone: AlertTone = 'openCode') => push(tone, title, detail), [push])

  useEffect(() => {
    const before = previous.current
    const state = { codexActive, openCodeActive, questionCount, startedAt: before.startedAt, scope }
    if (before.scope !== scope) {
      // A different conversation: its history is not a turn that just ended here.
      if (codexActive) state.startedAt = Date.now()
      previous.current = state
      return
    }
    if (codexActive && !before.codexActive) before.startedAt = Date.now()
    if (before.codexActive && !codexActive && Date.now() - before.startedAt >= minimumTurnMs) {
      push('codex', 'Codex خلّص دوره', subject)
    }
    if (before.openCodeActive && !openCodeActive) {
      push('openCode', 'OpenCode خلّص شغله', subject)
    }
    if (questionCount > before.questionCount) {
      push('question', 'OpenCode ينتظر إجابتك', questionCount > 1 ? `${questionCount} أسئلة مفتوحة` : 'شوف السؤال في المسار الجانبي', true)
    }
    previous.current = state
  }, [codexActive, openCodeActive, push, questionCount, scope, subject])

  useEffect(() => {
    const dismissible = alerts.filter((alert) => !alert.persistent)
    if (dismissible.length === 0) return undefined
    const timers = dismissible.map((alert) => window.setTimeout(() => dismiss(alert.id), 9_000))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [alerts, dismiss])

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Relay Room` : 'Relay Room'
  }, [unread])

  useEffect(() => {
    const markSeen = () => setUnread(0)
    window.addEventListener('focus', markSeen)
    return () => window.removeEventListener('focus', markSeen)
  }, [])

  return { alerts, unread, dismiss, notify }
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
  return asArray<CodexItem>(items).flatMap<ChatMessage>((item) => {
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
  return asArray<Record<string, unknown>>(messages).flatMap<ChatMessage>((message, index) => {
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

interface FormOption {
  value: string
  label: string
  description?: string
}

interface FormField {
  key: string
  title: string
  description?: string
  type: string
  options: FormOption[]
}

interface OpenCodeForm {
  id: string
  title: string
  fields: FormField[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** OpenCode sends `{ fields: [{ key, title, description, type, options }] }`; stay tolerant of anything else. */
function readForm(value: unknown, index: number): OpenCodeForm | null {
  const record = asRecord(value)
  const id = typeof record.id === 'string' ? record.id : ''
  if (!/^frm_[A-Za-z0-9]+$/.test(id)) return null

  const raw = asArray(record.fields ?? record.questions ?? record.input)
  const fields = raw.flatMap<FormField>((entry, position) => {
    const field = asRecord(entry)
    const options = asArray(field.options).flatMap<FormOption>((option, optionIndex) => {
      const optionRecord = asRecord(option)
      const optionValue = typeof optionRecord.value === 'string' ? optionRecord.value : typeof optionRecord.label === 'string' ? optionRecord.label : ''
      if (!optionValue) return []
      return [{
        value: optionValue,
        label: typeof optionRecord.label === 'string' && optionRecord.label ? optionRecord.label : optionValue,
        description: typeof optionRecord.description === 'string' && optionRecord.description ? optionRecord.description : undefined,
      }]
    })
    const key = typeof field.key === 'string' && field.key ? field.key : `q${position}`
    const title = readText(field.title ?? field.label ?? field.question) || `سؤال ${position + 1}`
    const type = typeof field.type === 'string' ? field.type : options.length > 0 ? 'select' : 'string'
    return [{ key, title, description: readText(field.description) || undefined, type, options }]
  })

  return {
    id,
    title: readText(record.title) || 'OpenCode يحتاج إلى توضيح',
    fields: fields.length > 0 ? fields : [{ key: 'answer', title: readText(record.description) || 'اكتب ردّك', type: 'string', options: [] }],
  }
}

function readForms(value: unknown) {
  return asArray(value).flatMap<OpenCodeForm>((entry, index) => {
    const form = readForm(entry, index)
    return form ? [form] : []
  })
}

/** Boolean questions arrive without options, so offer the two honest answers. */
function fieldOptions(field: FormField): FormOption[] {
  if (field.options.length > 0) return field.options
  if (field.type === 'boolean') return [{ value: 'true', label: 'نعم' }, { value: 'false', label: 'لا' }]
  return []
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

function QuestionForm({ form, sessionId, onAnswered, onNotify }: {
  form: OpenCodeForm
  sessionId: string
  onAnswered: () => void
  onNotify: (title: string, detail?: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    const answer: Record<string, string> = {}
    for (const field of form.fields) {
      const value = values[field.key]?.trim() ?? ''
      if (!value) {
        setError('جاوب على كل الأسئلة عشان OpenCode يكمّل.')
        return
      }
      answer[field.key] = value
    }
    setSending(true)
    setError(null)
    try {
      await requestJson(`/api/sessions/${sessionId}/forms/${form.id}/reply`, { method: 'POST', body: JSON.stringify({ answer }) })
      setValues({})
      onAnswered()
      onNotify('تم إرسال إجابتك إلى OpenCode', 'متابعة التنفيذ الآن')
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'تعذر إرسال الإجابة.'
      setError(message)
      onAnswered()
    } finally {
      setSending(false)
    }
  }

  return <form onSubmit={submit} className="rounded-xl border border-review/35 bg-card p-3">
    <div className="flex items-start justify-between gap-2">
      <p className="text-[12px] font-bold leading-6 text-review-ink">{form.title}</p>
      <code dir="ltr" className="ltr shrink-0 text-[9px] text-ink-soft">{form.id}</code>
    </div>
    <div className="mt-2.5 space-y-3">
      {form.fields.map((field) => <fieldset key={field.key} className="space-y-1.5">
        <legend className="text-[12px] font-bold leading-6 text-ink">{field.title}</legend>
        {field.description ? <p className="text-[11px] leading-5 text-ink-soft">{field.description}</p> : null}
        {fieldOptions(field).length > 0 ? <div className="space-y-1.5">
          {fieldOptions(field).map((option) => <label key={option.value} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors', values[field.key] === option.value ? 'border-relay/50 bg-relay-tint' : 'border-line bg-paper hover:border-relay/30')}>
            <input type="radio" name={`${form.id}-${field.key}`} value={option.value} checked={values[field.key] === option.value} onChange={() => setValues((current) => ({ ...current, [field.key]: option.value }))} className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-relay)]" />
            <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold leading-5 text-ink">{option.label}</span>{option.description ? <span className="mt-0.5 block text-[10px] leading-5 text-ink-soft">{option.description}</span> : null}</span>
          </label>)}
        </div> : <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={values[field.key] ?? ''}
          onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
          placeholder="اكتب إجابتك…"
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-6 text-ink outline-none placeholder:text-ink-soft/70 focus:border-relay/55 focus:ring-2 focus:ring-relay/10"
        />}
      </fieldset>)}
    </div>
    {error ? <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-review-tint px-2.5 py-2 text-[11px] leading-5 text-review-ink"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}</div> : null}
    <button type="submit" disabled={sending} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-review px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-55">{sending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}أرسل الإجابة وأكمل</button>
  </form>
}

function AlertStack({ alerts, onDismiss }: { alerts: AgentAlert[]; onDismiss: (id: string) => void }) {
  if (alerts.length === 0) return null
  const tones = {
    codex: 'border-relay/30 bg-card text-relay-ink',
    openCode: 'border-ready/30 bg-card text-ready-ink',
    question: 'border-review/40 bg-review-tint text-review-ink',
  }
  const icons = {
    codex: <CircleDot className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />,
    openCode: <Bot className="h-4 w-4 shrink-0 text-ready" aria-hidden="true" />,
    question: <MessageCircleQuestion className="h-4 w-4 shrink-0 text-review" aria-hidden="true" />,
  }
  return <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
    {alerts.map((alert) => <div key={alert.id} className={cx('pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-[0_10px_30px_rgba(25,35,48,0.16)]', tones[alert.tone])}>
      {icons[alert.tone]}
      <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-6">{alert.title}</p>{alert.detail ? <p className="mt-0.5 truncate text-[11px] text-ink-soft" title={alert.detail}>{alert.detail}</p> : null}</div>
      <button type="button" onClick={() => onDismiss(alert.id)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-paper hover:text-ink" aria-label="إخفاء التنبيه"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </div>)}
  </div>
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
  return <form onSubmit={submit} className="shrink-0 border-t border-line bg-paper p-3">
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

function ScrollToLatest({ visible, onClick, tone = 'relay' }: { visible: boolean; onClick: () => void; tone?: 'relay' | 'ready' }) {
  return <button type="button" onClick={onClick} tabIndex={visible ? 0 : -1} aria-hidden={visible ? undefined : true} className={cx('pointer-events-none absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[11px] font-bold opacity-0 shadow-[0_6px_18px_rgba(25,35,48,0.14)] transition-opacity duration-200', tone === 'ready' ? 'border-ready/35 text-ready-ink' : 'border-relay/35 text-relay-ink', visible && 'pointer-events-auto opacity-100')}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />آخر رسالة</button>
}

function StatusPill({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'codex' | 'openCode' | 'warning' }) {  const tones = {
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
    <aside dir="rtl" className="flex min-h-[14rem] flex-col border-b border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink"><PanelLeft className="h-4 w-4 text-relay" aria-hidden="true" /> جلسات Codex</div>
        <button type="button" onClick={onCreate} disabled={!connected || creating} className="inline-flex items-center gap-1.5 rounded-lg bg-relay px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45">
          {creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          محادثة
        </button>
      </div>
      <div className="shrink-0 border-b border-line px-4 py-3 text-xs text-ink-soft"><div className="flex items-center gap-2"><StateDot active={connected} warning={!connected} />{connected ? 'مرتبطة بـ Codex Desktop المحلي' : 'تعذر الاتصال بـ Codex Desktop'}</div></div>
      <div className="shrink-0 border-b border-line p-3">
        <button type="button" onClick={onOpenProject} disabled={openingProject} className="flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2.5 text-right text-xs text-ink transition-colors hover:border-relay/35 hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-55" aria-label="فتح مجلد المشروع في مستكشف الملفات">
          {openingProject ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-relay" aria-hidden="true" /> : <FolderOpen className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" />}
          <span className="min-w-0 flex-1"><span className="block font-bold">فتح ملفات المشروع</span>{projectDirectory ? <code dir="ltr" className="mt-0.5 block truncate text-[10px] font-normal text-ink-soft" title={projectDirectory}>{projectDirectory}</code> : <span className="mt-0.5 block text-[10px] text-ink-soft">يتم تحديد المسار…</span>}</span>
        </button>
      </div>
      <nav aria-label="جلسات Codex" className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
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
      <div className="shrink-0 border-t border-line px-4 py-3 text-[10px] leading-5 text-ink-soft">تظهر هنا الجلسات التي أنشأها Relay Room فقط، حتى لا تختلط مع محادثاتك الأخرى.</div>
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

function Composer({ draft, onChange, onSubmit, onQueue, onCancelQueue, queued, sending, disabled, error, attachments, onAttach, onRemoveAttachment, attaching, turn, onStop }: {
  draft: string
  onChange: (value: string) => void
  onSubmit: () => void
  onQueue: () => void
  onCancelQueue: () => void
  queued: string | null
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
  const busy = sending || turn.active
  const isDelegation = /(?:^|\s)\$opencode\b/i.test(draft)
  const starting = sending && !turn.active
  const hasContent = Boolean(draft.trim() || attachments.length)
  const deliver = () => { if (busy) onQueue(); else onSubmit() }
  const submit = (event: FormEvent) => { event.preventDefault(); deliver() }
  const keyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); deliver() } }
  return <form onSubmit={submit} className="shrink-0 border-t border-line bg-card p-3 sm:p-4">
    {queued ? <div className="mb-2 flex items-center gap-2 rounded-lg border border-review/25 bg-review-tint px-3 py-2.5">
      <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-review" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-review-ink" title={queued}>في انتظار الإرسال — هتروح أول ما دور Codex يخلص</span>
      <button type="button" onClick={onCancelQueue} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-review-ink/70 hover:bg-card" aria-label="إلغاء الرسالة المحفوظة"><X className="h-3 w-3" aria-hidden="true" /></button>
    </div> : null}
    {attachments.length > 0 ? <div className="mb-2 rounded-lg border border-relay/20 bg-relay-tint/55 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-relay-ink"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />ملف مرتبط بالرسالة</div>
      <p className="mt-1 text-[10px] leading-5 text-relay-ink/80">سيُرسل المسار فقط إلى Codex، ولن يُرفع محتوى الملف.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{attachments.map((path) => <span key={path} className="inline-flex max-w-full items-center gap-1 rounded-md border border-relay/20 bg-card py-1 pl-1 pr-2 text-[11px] text-ink"><Paperclip className="h-3 w-3 shrink-0 text-relay" aria-hidden="true" /><code dir="ltr" className="min-w-0 truncate" title={path}>{path}</code><button type="button" onClick={() => onRemoveAttachment(path)} disabled={busy} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-paper hover:text-ink disabled:cursor-not-allowed" aria-label={`إزالة ${path}`}><X className="h-3 w-3" aria-hidden="true" /></button></span>)}</div>
    </div> : null}
    <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-2 focus-within:border-relay/60 focus-within:ring-2 focus-within:ring-relay/10">
      <button type="button" onClick={onAttach} disabled={disabled || busy || attaching} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-ink-soft transition-colors hover:border-relay/40 hover:text-relay-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label="اختيار ملف من المشروع وإرسال مساره فقط" title="إرسال مسار ملف فقط">{attaching ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}</button>
      <textarea value={draft} onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} disabled={disabled} rows={2} placeholder="اكتب إلى Codex… أضف $opencode عندما تريد إرسال التنفيذ إلى OpenCode." className="min-h-[3.4rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft/75 disabled:cursor-not-allowed" />
      {turn.active ? <button type="button" onClick={onStop} disabled={turn.stopping} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-review text-white transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-55" aria-label="إيقاف Codex فورًا" title="إيقاف Codex فورًا">{turn.stopping ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleStop className="h-4 w-4" aria-hidden="true" />}</button> : <button type="submit" disabled={disabled || sending || !hasContent} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-relay text-white transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-45" aria-label={busy ? 'حفظ الرسالة وإرسالها فور انتهاء دور Codex' : 'إرسال إلى Codex'} title={busy ? 'يُرسل تلقائيًا فور انتهاء دور Codex' : 'إرسال إلى Codex'}>{sending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : busy ? <Timer className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}</button>}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-soft"><span>Enter للإرسال · Shift + Enter لسطر جديد</span>{turn.active ? <span role="status" className="inline-flex items-center gap-1.5 font-bold text-review-ink"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{turn.stopping ? 'يجري إيقاف Codex…' : 'اكتب وأنت مستني — الرسالة تروح أول ما يخلص.'}</span> : starting ? <span role="status" className="inline-flex items-center gap-1.5 font-bold text-relay-ink"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />جارٍ بدء دور Codex…</span> : isDelegation ? <span className="font-mono text-relay-ink">$opencode ← سيظهر التفويض في المسار الجانبي</span> : <span>Codex يفكر ويراجع؛ OpenCode لا يعمل إلا بالوسم.</span>}</div>
    {error ? <div className="mt-2 flex items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}</div> : null}
  </form>
}

function CodexConversation({ thread, messages, loading, draft, onDraftChange, onSend, onQueue, onCancelQueue, queued, sending, error, onNewThread, attachments, onAttach, onRemoveAttachment, attaching, turn, onStop }: {
  thread: CodexThread | null
  messages: ChatMessage[]
  loading: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onQueue: () => void
  onCancelQueue: () => void
  queued: string | null
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
  const scroll = useStickyScroll(messages)
  if (!thread) return <section dir="rtl" className="flex min-h-[32rem] min-w-0 flex-col bg-paper lg:min-h-0 lg:overflow-hidden"><div className="flex h-full flex-1 items-center justify-center px-8 text-center"><div className="max-w-md"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-relay-tint text-relay-ink"><Sparkles className="h-6 w-6" aria-hidden="true" /></div><h1 className="mt-5 text-xl font-bold text-ink">ابدأ من شات Codex</h1><p className="mt-3 text-sm leading-7 text-ink-soft">اكتب طلبك هنا. إذا أردت أن ينفّذ OpenCode، أضف <code className="rounded bg-card px-1.5 py-0.5 font-mono text-relay-ink">$opencode</code> داخل الرسالة، وسترى التسليم والرد في المساحة الجانبية.</p><button type="button" onClick={onNewThread} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-relay px-4 py-2.5 text-sm font-bold text-white hover:bg-relay-ink"><Plus className="h-4 w-4" aria-hidden="true" />محادثة Codex جديدة</button></div></div></section>
  return <section dir="rtl" className="flex min-h-[32rem] min-w-0 flex-col bg-paper lg:min-h-0 lg:overflow-hidden">
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-card px-4 py-3.5 sm:px-5"><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-bold text-ink"><Sparkles className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" /><span className="truncate">{thread.title ?? thread.name ?? 'محادثة جديدة'}</span></div><p className="mt-1 text-[11px] text-ink-soft">هنا تتحدث مع Codex — التخطيط، المنطق، والمراجعة.</p></div>{turn.active ? <StatusPill tone="warning"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />{turn.stopping ? 'يتم الإيقاف' : 'Codex يفكّر'}</StatusPill> : sending ? <StatusPill tone="warning"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />يبدأ Codex</StatusPill> : <StatusPill tone="codex"><CircleDot className="h-3 w-3" aria-hidden="true" /> Codex</StatusPill>}</header>
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroll.ref} onScroll={scroll.handleScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {loading && messages.length === 0 ? <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />يتم تحميل المحادثة…</div> : messages.length === 0 ? <div className="flex h-full items-center justify-center text-center"><p className="max-w-sm text-sm leading-7 text-ink-soft">هذه جلسة جديدة. اكتب ما تريد من Codex أن يفهمه أو يخطط له.</p></div> : <div className="mx-auto flex max-w-3xl flex-col gap-5">{messages.map((message) => <MessageBubble key={message.id} message={message} speaker="codex" />)}</div>}
      </div>
      <ScrollToLatest visible={!scroll.following && messages.length > 0} onClick={() => scroll.scrollToLatest(true)} />
    </div>
    <Composer draft={draft} onChange={onDraftChange} onSubmit={onSend} onQueue={onQueue} onCancelQueue={onCancelQueue} queued={queued} sending={sending} disabled={false} error={error} attachments={attachments} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} attaching={attaching} turn={turn} onStop={onStop} />
  </section>
}

function HandoffRail({ thread, handoff, loading, events, onReview, reviewing, onAnswered, onNotify }: {
  thread: CodexThread | null
  handoff: HandoffData | null
  loading: boolean
  events: RelayEvent[]
  onReview: () => void
  reviewing: boolean
  onAnswered: () => void
  onNotify: (title: string, detail?: string) => void
}) {
  const openCodeMessages = useMemo(() => openCodeChat(asArray(handoff?.messages)), [handoff?.messages])
  const threadEvents = useMemo(() => asArray<RelayEvent>(events).filter((event) => event.codexThreadId === thread?.id && event.kind === 'handoff-sent').sort((a, b) => a.timestamp - b.timestamp), [events, thread?.id])
  const forms = useMemo(() => readForms(handoff?.forms), [handoff?.forms])
  const activity = handoff?.activity ?? { active: false, kind: 'idle' as const, label: 'لا توجد عملية OpenCode نشطة' }
  const scroll = useStickyScroll(openCodeMessages)
  const stream = !thread
    ? <div className="flex flex-1 items-center justify-center px-6 text-center text-sm leading-7 text-ink-soft">اختر جلسة Codex أولًا لرؤية أي تفويض مرتبط بها.</div>
    : loading && !handoff
      ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />يتم فحص مسار التفويض…</div>
      : !handoff?.link
        ? <div className="flex flex-1 items-center justify-center px-6 text-center"><div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-ready-tint text-ready-ink"><TerminalSquare className="h-5 w-5" aria-hidden="true" /></div><h2 className="mt-4 text-sm font-bold text-ink">لم يُفوَّض OpenCode في هذه الجلسة</h2><p className="mt-2 text-xs leading-6 text-ink-soft">في شات Codex اكتب <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-relay-ink">$opencode</code> ثم طلب التنفيذ. لن يبدأ OpenCode بدون هذا الوسم.</p></div></div>
        : <><div className="shrink-0 border-b border-line bg-paper px-4 py-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-bold text-ink"><StateDot active={handoff.active} warning={forms.length > 0} />{forms.length > 0 ? 'OpenCode يحتاج توضيحًا' : handoff.active ? 'OpenCode يعمل الآن' : 'لا توجد عملية OpenCode نشطة'}</div><code className="ltr max-w-[8rem] truncate text-[10px] text-ink-soft">{handoff.link.opencodeSessionId}</code></div></div>
          {forms.length > 0 ? <div className="thin-scroll max-h-[55%] shrink-0 space-y-2.5 overflow-y-auto border-b border-line bg-review-tint/45 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-review-ink"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />OpenCode متوقف على سؤال — التنفيذ محتاج ردّك</div>
            {forms.map((form) => <QuestionForm key={form.id} form={form} sessionId={handoff.link?.opencodeSessionId ?? ''} onAnswered={onAnswered} onNotify={onNotify} />)}
          </div> : null}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scroll.ref} onScroll={scroll.handleScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 px-4 py-4">
                {threadEvents.length > 0 ? <div className="border-b border-line pb-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-relay-ink">Codex ←→ OpenCode</p><div className="space-y-2">{threadEvents.slice(-2).map((event) => <div key={event.id} className="rounded-lg bg-relay-tint px-3 py-2.5 text-xs leading-6 text-relay-ink"><span className="mb-1 block text-[10px] font-bold">أرسل Codex إلى OpenCode</span>{event.message}</div>)}</div></div> : null}
                {openCodeMessages.length === 0 ? <div className="py-4 text-center text-xs leading-6 text-ink-soft">تم إنشاء رابط OpenCode، لكن لا توجد رسالة مرئية منه بعد. ستظهر أول رسالة فعلية هنا تلقائيًا.</div> : <div className="space-y-4">{openCodeMessages.map((message) => <MessageBubble key={message.id} message={message} speaker="opencode" />)}</div>}
                {!handoff.active && forms.length === 0 && openCodeMessages.length > 0 ? <button type="button" onClick={onReview} disabled={reviewing} className="flex w-full items-center justify-center gap-2 rounded-lg border border-relay/30 bg-card px-3 py-2.5 text-xs font-bold text-relay-ink transition-colors hover:bg-relay-tint disabled:cursor-not-allowed disabled:opacity-45">{reviewing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />}اطلب من Codex مراجعة التنفيذ</button> : null}
              </div>
            </div>
            <ScrollToLatest tone="ready" visible={!scroll.following && (openCodeMessages.length > 0 || threadEvents.length > 0 || forms.length > 0)} onClick={() => scroll.scrollToLatest(true)} />
          </div></>
  return <aside dir="rtl" className="flex min-h-[22rem] min-w-0 flex-col border-t border-line bg-card lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0">
    <div className="shrink-0 border-b border-line px-4 py-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold text-ink"><ArrowUpRight className="h-4 w-4 text-ready" aria-hidden="true" />مسار التفويض</div><StatusPill tone="openCode"><Bot className="h-3 w-3" aria-hidden="true" /> Big Pickle</StatusPill></div><p className="mt-2 text-[11px] leading-5 text-ink-soft">ما يرسله Codex إلى OpenCode، وما يرد به، يظهر هنا كما هو.</p></div>
    {stream}
  </aside>
}

export default function App() {
  const codexStatus = usePolling<CodexStatus>('/api/codex/status', 10_000)
  const openCodeStatus = usePolling<OpenCodeStatus>('/api/health', 10_000)
  const projectRequest = usePolling<ProjectInfo>('/api/project', 60_000)
  const threadRequest = usePolling<CodexThread[]>('/api/codex/threads', 5_000)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const threads = useMemo(() => asArray<CodexThread>(threadRequest.data), [threadRequest.data])
  const selectedThread = useMemo(() => threads.find((thread) => thread.id === selectedId) ?? null, [selectedId, threads])
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
  const [queued, setQueued] = useState<{ threadId: string; text: string } | null>(null)

  useEffect(() => { if (!selectedId && threads.length) setSelectedId(threads[0].id) }, [selectedId, threads])
  useEffect(() => { setDraft(''); setAttachments([]); setComposerError(null); setQueued(null) }, [selectedId])

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
    if (!selectedId || !text || sending || activeTurn.active) return false
    setSending(true); setComposerError(null)
    try {
      await requestJson(`/api/codex/threads/${selectedId}/messages`, { method: 'POST', body: JSON.stringify({ text }) })
      if (!override) { setDraft(''); setAttachments([]) }
      await Promise.all([codexMessagesRequest.refresh(), turnStatusRequest.refresh(), handoffRequest.refresh(), threadRequest.refresh()])
      return true
    } catch (error) { setComposerError(error instanceof Error ? error.message : 'تعذر إرسال الرسالة إلى Codex.'); return false } finally { setSending(false) }
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

  // Drafting must never be blocked by a running turn: hold the text, then send it the moment Codex is free.
  const queueMessage = useCallback(() => {
    if (!selectedId) return
    const text = [draft.trim(), ...attachments].filter(Boolean).join('\n')
    if (!text) return
    setQueued({ threadId: selectedId, text })
    setDraft('')
    setAttachments([])
  }, [attachments, draft, selectedId])

  const cancelQueue = useCallback(() => setQueued(null), [])

  useEffect(() => {
    if (!queued || queued.threadId !== selectedId || activeTurn.active || sending) return
    const { text } = queued
    setQueued(null)
    void sendMessage(text).then((delivered) => {
      // Never swallow what the operator typed: a failed hand-off goes back to the box.
      if (!delivered) setDraft((current) => (current.trim() ? current : text))
    })
  }, [activeTurn.active, queued, selectedId, sendMessage, sending])

  const refreshHandoff = useCallback(() => { void handoffRequest.refresh() }, [handoffRequest])
  const refreshAll = useCallback(() => { void Promise.all([codexStatus.refresh(), openCodeStatus.refresh(), projectRequest.refresh(), threadRequest.refresh(), codexMessagesRequest.refresh(), turnStatusRequest.refresh(), handoffRequest.refresh(), relayEventsRequest.refresh()]) }, [codexMessagesRequest, codexStatus, handoffRequest, openCodeStatus, projectRequest, relayEventsRequest, threadRequest, turnStatusRequest])
  const messages = useMemo(() => codexChat(codexMessagesRequest.data), [codexMessagesRequest.data])
  const relayEvents = useMemo(() => asArray<RelayEvent>(relayEventsRequest.data), [relayEventsRequest.data])
  const pendingQuestions = useMemo(() => readForms(handoffRequest.data?.forms).length, [handoffRequest.data?.forms])
  const alerts = useAgentAlerts({
    codexActive: activeTurn.active,
    openCodeActive: Boolean(handoffRequest.data?.active),
    questionCount: pendingQuestions,
    subject: selectedThread?.title ?? selectedThread?.name ?? 'محادثة Codex',
    scope: selectedId ?? '',
  })
  const codexConnected = Boolean(codexStatus.data?.connected)
  const openCodeOnline = Boolean(openCodeStatus.data?.online)

  return <div dir="rtl" className="flex min-h-screen flex-col bg-paper text-ink lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <AlertStack alerts={alerts.alerts} onDismiss={alerts.dismiss} />
    <header className="shrink-0 border-b border-line bg-card px-4 py-3.5 sm:px-6"><div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-6 gap-y-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white"><GitPullRequestArrow className="h-4.5 w-4.5" aria-hidden="true" /></div><div><div className="text-sm font-extrabold tracking-tight text-ink">Relay Room</div><div className="text-[11px] text-ink-soft">شات Codex ومراقبة تسليم OpenCode</div></div></div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={codexConnected ? 'codex' : 'warning'}>{codexConnected ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}{codexConnected ? 'Codex Desktop متصل' : 'Codex غير متصل'}</StatusPill><StatusPill tone={openCodeOnline ? 'openCode' : 'warning'}><StateDot active={openCodeOnline} warning={!openCodeOnline} />{openCodeOnline ? 'OpenCode متاح' : 'OpenCode لا يرد'}</StatusPill><button type="button" onClick={refreshAll} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft hover:border-relay/40 hover:text-relay-ink"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />تحديث</button></div></div>{!codexConnected && codexStatus.data?.error ? <div className="mx-auto mt-3 max-w-[1800px] rounded-lg bg-review-tint px-3 py-2 text-xs text-review-ink">افتح Codex Desktop وسجّل الدخول ثم اضغط تحديث. {codexStatus.data.error}</div> : null}</header>
    <main dir="ltr" className="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)_23rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <SessionList threads={threads} selectedId={selectedId} onSelect={setSelectedId} onCreate={() => void createThread()} creating={creating} connected={codexConnected} projectDirectory={projectRequest.data?.directory} onOpenProject={() => void openProject()} openingProject={openingProject} />
      <CodexConversation thread={selectedThread} messages={messages} loading={codexMessagesRequest.status === 'loading'} draft={draft} onDraftChange={setDraft} onSend={() => void sendMessage()} onQueue={queueMessage} onCancelQueue={cancelQueue} queued={queued?.threadId === selectedId ? queued.text : null} sending={sending} error={composerError} onNewThread={() => void createThread()} attachments={attachments} onAttach={() => void attachProjectFile()} onRemoveAttachment={removeAttachment} attaching={attaching} turn={activeTurn} onStop={() => void stopCodexTurn()} />
      <HandoffRail thread={selectedThread} handoff={handoffRequest.data} loading={handoffRequest.status === 'loading'} events={relayEvents} onReview={requestReview} reviewing={sending || activeTurn.active} onAnswered={refreshHandoff} onNotify={alerts.notify} />
    </main>
  </div>
}
