import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MessageCircle, Send, X, RefreshCw } from 'lucide-react'
import { useLocale } from '../lib/i18n'
import { persistPreference, preferenceKeys } from '../lib/preferences'

const endpoint = (import.meta.env.VITE_SUPPORT_API_URL || 'https://license-console-mauve.vercel.app/api/support/messages').replace(/\/$/, '')
const storageKey = 'coding-room-support-token'
type Message = { id: string; sender: 'user' | 'admin'; text: string; createdAt: string }
type Conversation = { name: string; messages: Message[] }
export function openSupport(name?: string) {
  window.dispatchEvent(new CustomEvent('coding-room:open-support', { detail: { name } }))
}
export function SupportButton() {
  const ar = useLocale() === 'ar'
  return <button type="button" onClick={() => openSupport()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-bold text-relay-ink hover:bg-relay-tint"><MessageCircle className="h-4 w-4" />{ar ? 'شات الدعم · اطلب مفتاح' : 'Support chat · Request a key'}</button>
}
export function SupportChat() {
  const ar = useLocale() === 'ar'
  const dialog = useRef<HTMLDialogElement>(null), bottom = useRef<HTMLDivElement>(null)
  const token = useRef('')
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const nameEdited = useRef(false)
  async function request(body?: object, signal?: AbortSignal): Promise<Conversation> {
    const response = await fetch(endpoint, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.current}` }, body: body ? JSON.stringify(body) : undefined, signal })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || (ar ? 'تعذر الاتصال بالدعم.' : 'Could not connect to support.'))
    return result
  }
  useEffect(() => {
    const show = (event: Event) => {
      try {
        token.current = localStorage.getItem(storageKey) || Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
        persistPreference(preferenceKeys.supportToken, token.current)
        setName(localStorage.getItem('coding-room-support-name') || (event as CustomEvent<{ name?: string }>).detail?.name || '')
        setError(''); nameEdited.current = false
      } catch { setError(ar ? 'اسمح بحفظ البيانات المحلية لمتابعة المحادثة.' : 'Allow local storage to keep this conversation.'); return }
      dialog.current?.showModal(); setOpen(true)
    }
    window.addEventListener('coding-room:open-support', show)
    return () => window.removeEventListener('coding-room:open-support', show)
  }, [ar])
  useEffect(() => {
    if (!open || busy) return
    const controller = new AbortController()
    let running = false
    const refresh = async () => {
      if (running || document.hidden) return
      running = true
      try {
        const result = await request(undefined, controller.signal)
        if (controller.signal.aborted) return
        setMessages(result.messages)
        if (result.name && !nameEdited.current) setName(result.name)
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
      finally { running = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [open, busy])
  useEffect(() => { if (open) bottom.current?.scrollIntoView({ block: 'nearest' }) }, [open, messages[messages.length - 1]?.id])
  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !name.trim() || !draft.trim()) return
    setBusy(true); setError('')
    try {
      const result = await request({ name: name.trim(), text: draft.trim() })
      persistPreference(preferenceKeys.supportName, name.trim())
      setMessages(result.messages); setDraft('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="support-title" dir={ar ? 'rtl' : 'ltr'} style={{ WebkitAppRegion: 'no-drag' } as CSSProperties} className="fixed inset-0 m-auto w-[min(94vw,520px)] rounded-2xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-overlay/40">
    <header className="flex items-center justify-between border-b border-line px-5 py-4"><h2 id="support-title" className="flex items-center gap-2 text-base font-bold"><MessageCircle className="h-5 w-5 text-relay-ink" />{ar ? 'شات الدعم' : 'Support chat'}</h2><button type="button" onClick={() => dialog.current?.close()} aria-label={ar ? 'إغلاق' : 'Close'} className="rounded-lg p-2 hover:bg-paper"><X className="h-4 w-4" /></button></header>
    <div className="px-5 pt-4"><p className="text-xs leading-5 text-ink-soft">{ar ? 'اطلب مفتاح تفعيل أو اسأل عن مشكلة. الردود تظهر هنا، والمحادثة لا تستهلك رصيدك.' : 'Request an activation key or ask for help. Replies appear here. Support does not use your message quota.'}</p><label className="mt-3 block text-xs font-semibold">{ar ? 'اسمك' : 'Your name'}<input required maxLength={100} value={name} onChange={event => { nameEdited.current = true; setName(event.target.value) }} className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-relay" /></label></div>
    <div aria-live="polite" className="mt-4 max-h-[40dvh] min-h-40 space-y-3 overflow-y-auto border-y border-line bg-paper/40 p-5">
      {!messages.length && <p className="py-8 text-center text-xs text-ink-soft">{ar ? 'اكتب رسالتك لبدء المحادثة مع الدعم.' : 'Send a message to start a conversation with support.'}</p>}
      {messages.map(message => <article key={message.id} className={`max-w-[90%] rounded-xl px-3 py-2.5 ${message.sender === 'user' ? 'ms-auto bg-relay-tint' : 'border border-line bg-card'}`}><p className="mb-1 text-[10px] font-bold text-relay-ink">{message.sender === 'admin' ? (ar ? 'الدعم' : 'Support') : (ar ? 'أنت' : 'You')}</p><p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p><time className="mt-1 block text-[10px] text-ink-soft">{new Date(message.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-US')}</time></article>)}<div ref={bottom} />
    </div>
    <form onSubmit={send} className="p-4">{error && <p role="alert" className="mb-3 text-xs text-review-ink">{error}</p>}<div className="flex items-end gap-2"><textarea aria-label={ar ? 'رسالتك للدعم' : 'Message to support'} required maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} placeholder={ar ? 'اكتب رسالتك…' : 'Write your message…'} className="min-h-20 flex-1 resize-none rounded-lg border border-line bg-paper p-3 text-sm outline-none focus:border-relay" /><button disabled={busy || !name.trim() || !draft.trim()} aria-label={ar ? 'إرسال' : 'Send'} className="rounded-lg bg-relay p-3 text-on-accent hover:bg-relay-ink disabled:opacity-50">{busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div></form>
  </dialog>
}
