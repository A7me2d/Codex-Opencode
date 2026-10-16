import { useEffect, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { api } from '../../lib/api'
import { readOpenCodeChat } from '../../lib/chat'
import { readForms } from '../../lib/forms'
import { useLocale } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'
import { useChatHistory } from '../../hooks/useChatHistory'
import { EarlierMessages } from '../../components/ui/EarlierMessages'
import { MessageBubble } from '../../components/MessageBubble'
import { SettingsSelect } from '../../components/ui/SettingsSelect'
import { QuestionForm } from '../opencode/QuestionForm'
import type { ModelInfo, SuperAgentSlot, SuperAgentTeam } from '../../lib/types'

const drafts = new Map<string, string>()
export function OpenCodeSlot({ team, slot, enabled, compact, incoming, onTransfer, models, modelsError }: {
  team: SuperAgentTeam; slot: SuperAgentSlot; enabled: boolean; compact: boolean
  models: ModelInfo[]; modelsError?: string | null
  incoming: { id: number; teamId: string; slotId: string; threadId: string; text: string } | null
  onTransfer: (slot: SuperAgentSlot, text: string) => void
}) {
  const ar = useLocale() === 'ar', key = `${team.id}:${slot.id}:${slot.thread!.id}`
  const state = usePolling(enabled ? () => api.superOpenCodeState(team.id, slot.id) : null, data => data?.active ? 2500 : 7000, { resetKey: key })
  const selection = usePolling(enabled ? () => api.superOpenCodeModel(team.id, slot.id) : null, 0, { resetKey: key })
  const [currentModel, setCurrentModel] = useState(''), [savingModel, setSavingModel] = useState(false)
  useEffect(() => { if (selection.data) setCurrentModel(selection.data.model) }, [selection.data])
  const [draft, setDraft] = useState(() => drafts.get(key) || ''), [sending, setSending] = useState(false), [error, setError] = useState('')
  const messages = readOpenCodeChat(state.data?.messages), scroll = useChatHistory(messages, key)
  const active = Boolean(state.data?.active), forms = readForms(state.data?.forms)
  const update = (value: string) => { drafts.set(key, value); setDraft(value) }
  useEffect(() => {
    if (incoming?.teamId === team.id && incoming.slotId === slot.id && incoming.threadId === slot.thread?.id) update([drafts.get(key), incoming.text].filter(Boolean).join('\n\n'))
  }, [incoming?.id])
  async function send() {
    if (!enabled || team.archived || active || sending || savingModel || !draft.trim() || forms.length) return
    setSending(true); setError('')
    try { await api.sendSuperMessage(team.id, slot.id, slot.thread!.id, draft, []); update(''); await state.refresh(); scroll.scrollToLatest(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setSending(false) }
  }
  async function stop() {
    setSending(true); setError('')
    try { await api.stopSuperOpenCode(team.id, slot.id); await state.refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setSending(false) }
  }
  async function changeModel(model: string) {
    if (!enabled || active || sending || savingModel || team.archived || forms.length || model === currentModel) return
    setSavingModel(true); setError('')
    try { const result = await api.setSuperOpenCodeModel(team.id, slot.id, model); setCurrentModel(result.model); await selection.refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setSavingModel(false) }
  }
  const usableModels = models.filter(model => model.tools)
  const modelOptions = usableModels.map(model => ({ value: model.id, label: `${model.name} · ${model.providerID}` }))
  if (!modelOptions.some(option => option.value === currentModel)) modelOptions.unshift({ value: currentModel, label: currentModel || (ar ? 'جارٍ تحميل الموديل…' : 'Loading model…') })
  return <>
    <div ref={scroll.ref} onScroll={scroll.handleScroll} onWheel={scroll.handleWheel} className={`thin-scroll min-h-0 flex-1 overflow-y-auto ${compact ? 'p-2.5' : 'p-4'}`}>
      <EarlierMessages count={scroll.hiddenCount} onLoad={scroll.loadOlder} />
      <ol className="space-y-3">{scroll.visibleMessages.map(message => <li key={message.id}><MessageBubble message={message} speaker="opencode" /><button type="button" onClick={() => onTransfer(slot, message.text)} className="mt-1 rounded-md px-2 py-1 text-[10px] text-ink-soft hover:bg-relay-tint">{ar ? 'نقل إلى…' : 'Transfer to…'}</button></li>)}</ol>
      {!messages.length ? <p className="py-6 text-center text-xs text-ink-soft">{state.status === 'loading' ? ar ? 'جارٍ تحميل الرسائل…' : 'Loading messages…' : ar ? 'اكتب مهمة لهذا المكتب أو أرسلها من المدير.' : 'Write a task here or send it from the manager.'}</p> : null}
    </div>
    {!!forms.length && enabled && !team.archived ? <div className="thin-scroll max-h-56 shrink-0 overflow-y-auto p-2">{forms.map(form => <QuestionForm key={form.id} form={form} sessionId={slot.thread!.id} onAnswered={() => void state.refresh()} onNotify={() => {}} sendAnswer={(formId, answer) => api.answerSuperOpenCode(team.id, slot.id, formId, answer)} />)}</div> : null}
    {!scroll.atLatest && messages.length ? <button type="button" className="self-center rounded-full border border-line px-3 py-1 text-[10px] text-ink-soft" onClick={() => scroll.scrollToLatest(true)}>{ar ? 'آخر رسالة' : 'Latest message'}</button> : null}
    <form onSubmit={event => { event.preventDefault(); void send() }} className="super-agent-composer shrink-0 p-2">
      <div className="flex items-end gap-2"><div className="codex-input-capsule min-w-0 flex-1 rounded-2xl border border-line p-2 focus-within:border-relay/60">
        <textarea aria-label={`${ar ? 'رسالة إلى' : 'Message'} ${slot.label || `${ar ? 'مهمة' : 'Task'} ${slot.id.slice(7)}`}`} value={draft} onChange={event => update(event.target.value)} rows={compact ? 1 : 2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} placeholder={ar ? 'اكتب رسالتك…' : 'Write a message…'} className="block w-full resize-none bg-transparent px-1 text-xs leading-5 outline-none" />
        <div className="mt-1 flex min-w-0 items-center gap-2"><div className="min-w-0 max-w-64 flex-1"><SettingsSelect label={ar ? 'موديل OpenCode' : 'OpenCode model'} value={currentModel} options={modelOptions} onChange={model => void changeModel(model)} disabled={!enabled || active || sending || savingModel || team.archived || !!forms.length || !selection.data || !usableModels.length} className="!mt-0 !min-h-7 !rounded-lg !border-0 !bg-transparent !px-1 !py-1 !text-[10px]" /></div><span className="shrink-0 text-[10px] text-ink-soft">{savingModel ? ar ? 'جارٍ الحفظ…' : 'Saving…' : active ? ar ? 'يعمل…' : 'Working…' : !enabled ? ar ? 'موقوف' : 'Paused' : 'OpenCode'}</span></div>
      </div><button type={active ? 'button' : 'submit'} disabled={sending || savingModel || !enabled || team.archived || (!active && (!draft.trim() || !!forms.length))} onClick={active ? () => void stop() : undefined} aria-label={active ? ar ? 'إيقاف هذه المحادثة' : 'Stop this conversation' : ar ? 'إرسال' : 'Send'} className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-relay-tint text-relay-ink disabled:opacity-40">{active ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}</button></div>
      {error || state.error || state.data?.error || selection.error || modelsError ? <p role="alert" className="mt-2 break-words text-[11px] text-review-ink">{error || state.error || state.data?.error || selection.error || modelsError}</p> : null}
    </form>
  </>
}
