import { useEffect, useState } from 'react'
import { RefreshCw, Send, Square } from 'lucide-react'
import { api } from '../../lib/api'
import { useLocale } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'
import { useChatHistory } from '../../hooks/useChatHistory'
import { EarlierMessages } from '../../components/ui/EarlierMessages'
import { SuperMessage } from './SuperMessage'
import { SettingsSelect } from '../../components/ui/SettingsSelect'
import type { ClineOption, SuperAgentSlot, SuperAgentTeam } from '../../lib/types'

const drafts = new Map<string, string>()

/** Only the options the Cline session advertises; never invented locally. */
function optionChoices(option: ClineOption | undefined) {
  const items = option?.options?.flatMap(item => item.options ?? (item.value ? [{ value: item.value, name: item.name }] : [])) ?? []
  return items.map(item => ({ value: item.value, label: item.name }))
}

/** Embedded Cline chat for a worker desk. Sending uses the current Super Agent message path. */
export function ClineSlot({ team, slot, enabled, compact, incoming, onTransfer, identity }: {
  team: SuperAgentTeam; slot: SuperAgentSlot; enabled: boolean; compact: boolean
  identity?: string
  incoming: { id: number; teamId: string; slotId: string; threadId: string; text: string } | null
  onTransfer: (slot: SuperAgentSlot, text: string) => void
}) {
  const ar = useLocale() === 'ar', key = `${team.id}:${slot.id}:${slot.thread!.id}`
  const state = usePolling(enabled ? () => api.superClineState(team.id, slot.id) : null, data => data?.active || data?.loading || data?.preparing ? 2500 : 7000, { resetKey: key })
  const [draft, setDraft] = useState(() => drafts.get(key) || '')
  const [sending, setSending] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState('')
  const messages = state.data?.messages || []
  const scroll = useChatHistory(messages, key)
  const sessionActive = Boolean(state.data?.active)
  const preparing = Boolean(state.data?.loading || state.data?.preparing) || state.status === 'loading'
  const permissions = state.data?.permissions || []
  const waiting = permissions.length > 0
  const busy = sending || working || sessionActive || preparing
  const failure = error || state.data?.error || state.error
  const update = (value: string) => { drafts.set(key, value); setDraft(value) }
  useEffect(() => {
    if (incoming?.teamId === team.id && incoming.slotId === slot.id && incoming.threadId === slot.thread?.id) update([drafts.get(key), incoming.text].filter(Boolean).join('\n\n'))
  }, [incoming?.id])
  async function send() {
    if (!enabled || team.archived || busy || !draft.trim() || waiting) return
    setSending(true); setError('')
    try { await api.sendSuperMessage(team.id, slot.id, slot.thread!.id, draft, []); update(''); await state.refresh(); scroll.scrollToLatest(true) }
    catch (requestFailure) { setError(requestFailure instanceof Error ? requestFailure.message : String(requestFailure)) }
    finally { setSending(false) }
  }
  async function stop() {
    if (!enabled || working || team.archived) return
    setWorking(true); setError('')
    try { await api.stopSuperCline(team.id, slot.id); await state.refresh() }
    catch (requestFailure) { setError(requestFailure instanceof Error ? requestFailure.message : String(requestFailure)) }
    finally { setWorking(false) }
  }
  async function changeConfig(configId: string, value: string) {
    if (!enabled || busy || team.archived) return
    setWorking(true); setError('')
    try { await api.configSuperCline(team.id, slot.id, configId, value); await state.refresh() }
    catch (requestFailure) { setError(requestFailure instanceof Error ? requestFailure.message : String(requestFailure)) }
    finally { setWorking(false) }
  }
  async function answer(permissionId: string, optionId: string) {
    if (!enabled || working || team.archived) return
    setWorking(true); setError('')
    try { await api.permissionSuperCline(team.id, slot.id, permissionId, optionId); await state.refresh() }
    catch (requestFailure) { setError(requestFailure instanceof Error ? requestFailure.message : String(requestFailure)) }
    finally { setWorking(false) }
  }
  async function reconnect() {
    if (!enabled || working || team.archived) return
    setWorking(true); setError('')
    try { await api.connectSuperCline(team.id, slot.id); await state.refresh() }
    catch (requestFailure) { setError(requestFailure instanceof Error ? requestFailure.message : String(requestFailure)) }
    finally { setWorking(false) }
  }
  const modelOption = state.data?.configOptions.find(option => option.id === 'model' && option.type === 'select')
  const modeOption = state.data?.configOptions.find(option => option.id === 'mode' && option.type === 'select')
  const modelChoices = optionChoices(modelOption)
  const modeChoices = optionChoices(modeOption)
  const modelValue = String(modelOption?.currentValue ?? '')
  const modeValue = String(modeOption?.currentValue ?? '')
  const configDisabled = !enabled || busy || team.archived || waiting
  const selectClass = '!mt-0 !min-h-7 !rounded-lg !border-0 !bg-transparent !px-1 !py-1 !text-[10px]'
  return <>
    <div ref={scroll.ref} onScroll={scroll.handleScroll} onWheel={scroll.handleWheel} className={`thin-scroll min-h-0 flex-1 overflow-y-auto ${compact ? 'px-3.5 py-4' : 'px-5 py-5'}`}>
      <EarlierMessages count={scroll.hiddenCount} onLoad={scroll.loadOlder} />
      <ol className="super-transcript space-y-5">{scroll.visibleMessages.map(message => <SuperMessage key={message.id} message={{ ...message, live: sessionActive && message.role === 'assistant' && message.id === messages[messages.length - 1]?.id }} provider="cline" identity={identity} onTransfer={text => onTransfer(slot, text)} />)}</ol>
      {!messages.length ? <p className="py-6 text-center text-xs text-ink-soft">{state.status === 'loading' ? ar ? 'جارٍ تحميل الرسائل…' : 'Loading messages…' : ar ? 'اكتب مهمة لهذا المكتب أو أرسلها من المدير.' : 'Write a task here or send it from the manager.'}</p> : null}
      {!!state.data?.tools.length ? <details className="super-transcript mt-4 text-[11px] text-ink-soft"><summary className="cursor-pointer">{ar ? 'الأدوات' : 'Tools'} ({state.data.tools.length})</summary><ul className="mt-2 space-y-1">{state.data.tools.map(tool => <li key={tool.id}>{tool.title} · {tool.status}</li>)}</ul></details> : null}
    </div>
    {!!permissions.length && enabled && !team.archived ? <div className="thin-scroll max-h-56 shrink-0 overflow-y-auto border-t border-line px-3 py-2">{permissions.map(permission => <div key={permission.id} className="py-1"><p className="mb-1.5 text-[11px] font-semibold">{permission.title}</p><div className="flex flex-wrap gap-1.5">{permission.options.map(option => <button key={option.id} type="button" disabled={working || !enabled} onClick={() => void answer(permission.id, option.id)} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-relay-tint disabled:opacity-40">{option.name}</button>)}</div></div>)}</div> : null}
    {!scroll.atLatest && messages.length ? <button type="button" className="self-center rounded-full border border-line px-3 py-1 text-[10px] text-ink-soft" onClick={() => scroll.scrollToLatest(true)}>{ar ? 'آخر رسالة' : 'Latest message'}</button> : null}
    <form onSubmit={event => { event.preventDefault(); void send() }} className="super-agent-composer shrink-0 px-3 pb-3 pt-2">
      <div className="flex items-end gap-2"><div className="super-composer-box relative min-w-0 flex-1 rounded-2xl border border-line bg-paper/60 p-2 focus-within:border-relay/60">
        <textarea aria-label={`${ar ? 'رسالة إلى' : 'Message'} ${slot.label || `${ar ? 'مهمة' : 'Task'} ${slot.id.slice(7)}`}`} value={draft} onChange={event => update(event.target.value)} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} placeholder={ar ? 'اكتب رسالتك…' : 'Write a message…'} className="block min-h-10 max-h-32 w-full resize-none bg-transparent px-1 text-xs leading-5 outline-none" />
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          {modelOption ? <div className="min-w-0 max-w-64 flex-1 basis-36"><SettingsSelect label={ar ? 'موديل Cline' : 'Cline model'} searchPlaceholder={ar ? 'ابحث عن موديل…' : 'Search models…'} value={modelValue} options={modelChoices} onChange={value => { if (value !== modelValue) void changeConfig('model', value) }} disabled={configDisabled || !modelChoices.length || !state.data} className={selectClass} /></div> : null}
          {modeOption ? <div className="min-w-0 max-w-44 flex-1 basis-28"><SettingsSelect label={ar ? 'الوضع' : 'Mode'} value={modeValue} options={modeChoices} onChange={value => { if (value !== modeValue) void changeConfig('mode', value) }} disabled={configDisabled || !modeChoices.length || !state.data} className={selectClass} /></div> : null}
          {working || sessionActive || preparing || waiting || !enabled ? <span role="status" className="shrink-0 text-[10px] text-ink-soft">{working ? ar ? 'جارٍ الحفظ…' : 'Saving…' : waiting ? ar ? 'بانتظار صلاحية' : 'Waiting permission' : sessionActive ? ar ? 'يعمل…' : 'Working…' : preparing ? ar ? 'جارٍ التجهيز…' : 'Preparing…' : ar ? 'موقوف' : 'Paused'}</span> : null}
        </div>
      </div><button type={sessionActive ? 'button' : 'submit'} disabled={sending || working || !enabled || team.archived || (!sessionActive && (preparing || !state.data || !draft.trim() || waiting))} onClick={sessionActive ? () => void stop() : undefined} aria-label={sessionActive ? ar ? 'إيقاف هذه المحادثة' : 'Stop this conversation' : ar ? 'إرسال' : 'Send'} className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-relay-tint text-relay-ink disabled:opacity-40">{sessionActive ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}</button></div>
      {failure ? <p role="alert" className="mt-2 break-words text-[11px] text-review-ink"><span>{failure}</span>{enabled && !team.archived ? <button type="button" disabled={working || sessionActive || preparing || waiting} onClick={() => void reconnect()} className="ms-2 inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] font-medium text-ink hover:bg-relay-tint disabled:opacity-40"><RefreshCw className="h-3 w-3" />{ar ? 'إعادة الاتصال' : 'Reconnect'}</button> : null}</p> : null}
    </form>
  </>
}
