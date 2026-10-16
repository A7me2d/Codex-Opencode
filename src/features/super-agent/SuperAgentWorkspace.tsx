import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Archive, ArrowLeft, ArrowRightLeft, Check, Crown, FolderOpen, Maximize2, Minimize2, Paperclip, Pencil, Plus, Send, Square, Unlink, Users, X, Trash2, Brain, LayoutGrid, Map as MapIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { direction, useLocale } from '../../lib/i18n'
import { cx } from '../../lib/cx'
import { persistPreference, preferenceKeys } from '../../lib/preferences'
import { useProviderActivity } from '../../hooks/useProviderActivity'
import { usePolling } from '../../hooks/usePolling'
import { useConversation } from '../../hooks/useConversation'
import { useChatHistory } from '../../hooks/useChatHistory'
import { MessageBubble } from '../../components/MessageBubble'
import { EarlierMessages } from '../../components/ui/EarlierMessages'
import { CodexSettingsPicker } from '../codex/CodexSettingsPicker'
import { SettingsSelect } from '../../components/ui/SettingsSelect'
import { SuperAgentOffice } from './SuperAgentOffice'
import { CoreBrainPanel } from './CoreBrainPanel'
import { ChangedFiles } from '../opencode/ChangedFiles'
import type { CodexModelInfo, CodexSettings, SuperAgentSlot, SuperAgentTeam, SuperSlotId } from '../../lib/types'

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-40'
const field = 'super-agent-field min-w-0 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink placeholder:text-ink-soft/70 outline-none transition-colors focus:border-relay focus:ring-2 focus:ring-relay/10'
const draftCache = new Map<string, { text: string; attachments: string[] }>()
const settingsCache = new Map<string, CodexSettings>()
type Delivery = { id: number; teamId: string; slotId: SuperSlotId; threadId: string; text: string }
const slotName = (slot: SuperAgentSlot, ar: boolean) => slot.label || (slot.id === 'manager' ? ar ? 'المدير' : 'Manager' : `${ar ? 'مهمة' : 'Task'} ${slot.id.slice(7)}`)

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ar = useLocale() === 'ar'
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} dir={direction()} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(94vw,600px)] max-w-none overflow-y-auto rounded-2xl border border-line bg-card p-5 text-ink shadow-xl backdrop:bg-overlay/40"><header className="mb-4 flex items-center justify-between gap-3"><h2 id={titleId} className="text-sm font-semibold">{title}</h2><button type="button" onClick={() => ref.current?.close()} aria-label={ar ? 'إغلاق' : 'Close'} className="rounded-lg p-2 hover:bg-paper"><X className="h-4 w-4" /></button></header>{children}</dialog>
}

function SlotPicker({ team, slot, onChange, onClose }: { team: SuperAgentTeam; slot: SuperAgentSlot; onChange: (team: SuperAgentTeam) => void; onClose: () => void }) {
  const ar = useLocale() === 'ar'
  const activity = useProviderActivity()
  const list = usePolling(activity.providers.codex ? api.threads : null, 0)
  const [mode, setMode] = useState<'existing' | 'new'>('existing'), [search, setSearch] = useState('')
  const [selected, setSelected] = useState(''), [directory, setDirectory] = useState(''), [label, setLabel] = useState(slot.label)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const taken = new Set(team.slots.filter(item => item.id !== slot.id).map(item => item.thread?.id))
  const threads = (list.data || []).filter(thread => !thread.localWorkflow && !thread.archived && !taken.has(thread.id) && `${thread.title} ${thread.directory}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  async function bind() {
    if (busy) return
    setBusy(true); setError('')
    try { onChange(await api.bindSuperSlot(team.id, slot.id, mode === 'existing' ? { threadId: selected, label } : { directory, title: `${team.title} · ${slotName({ ...slot, label }, ar)}`, label })); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  async function browse() {
    setBusy(true); setError('')
    try { const result = await api.superProjectFolder(directory); if (result) setDirectory(result.directory) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <Dialog title={`${slotName(slot, ar)} · Codex`} onClose={onClose}>
    <label className="mb-4 block text-xs text-ink-soft">{ar ? 'اسم المهمة' : 'Task name'}<input value={label} maxLength={120} onChange={event => setLabel(event.target.value)} className={`${field} mt-2 w-full`} placeholder={slotName({ ...slot, label: '' }, ar)} /></label>
    <div role="tablist" aria-label={ar ? 'اختيار المحادثة' : 'Conversation source'} className="mb-4 flex gap-1 rounded-lg bg-paper p-1">{(['existing', 'new'] as const).map(value => <button type="button" role="tab" aria-selected={mode === value} key={value} onClick={() => setMode(value)} className={cx('min-h-9 flex-1 rounded-md px-3 text-xs', mode === value && 'bg-card font-semibold text-relay-ink shadow-sm')}>{value === 'existing' ? ar ? 'محادثة موجودة' : 'Existing conversation' : ar ? 'محادثة جديدة' : 'New conversation'}</button>)}</div>
    {mode === 'existing' ? <div className="space-y-3"><input aria-label={ar ? 'بحث بالمحادثة أو المجلد' : 'Search conversations or folders'} className={`${field} w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder={ar ? 'اسم المحادثة أو مسار المشروع…' : 'Conversation name or project path…'} /><div role="listbox" aria-label={ar ? 'محادثات Codex' : 'Codex conversations'} className="thin-scroll max-h-64 space-y-1 overflow-y-auto">{threads.map(thread => <button key={thread.id} type="button" role="option" aria-selected={selected === thread.id} onClick={() => setSelected(thread.id)} className={cx('block w-full rounded-lg border p-3 text-start', selected === thread.id ? 'border-relay/50 bg-relay-tint' : 'border-transparent hover:bg-paper')}><span className="block truncate text-xs font-semibold">{thread.title || thread.name || thread.id}</span><code dir="ltr" className="mt-1 block truncate text-[10px] text-ink-soft">{thread.directory}</code></button>)}{!threads.length ? <p className="py-5 text-center text-xs text-ink-soft">{list.status === 'loading' ? ar ? 'جارٍ تحميل المحادثات…' : 'Loading conversations…' : ar ? 'لا توجد محادثات مطابقة' : 'No matching conversations'}</p> : null}</div></div> : <label className="block text-xs text-ink-soft">{ar ? 'مجلد المشروع' : 'Project folder'}<span className="mt-2 flex gap-2"><input dir="ltr" value={directory} onChange={event => setDirectory(event.target.value)} className={`${field} flex-1`} placeholder="D:\\project" /><button type="button" className={button} disabled={busy} onClick={() => void browse()} aria-label={ar ? 'اختيار المجلد' : 'Choose folder'}><FolderOpen className="h-4 w-4" /></button></span></label>}
    {error || list.error ? <p role="alert" className="mt-3 text-xs leading-5 text-review-ink">{error || list.error}</p> : null}
    {!activity.providers.codex ? <p role="status" className="mt-3 text-xs text-ink-soft">{ar ? 'فعّل Codex من الاتصال والتحديثات أولًا.' : 'Enable Codex in Connections & updates first.'}</p> : null}
    <footer className="mt-5 flex justify-end gap-2 border-t border-line pt-4"><button type="button" className={button} onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button><button type="button" className={`${button} bg-relay-tint text-relay-ink`} disabled={busy || !activity.providers.codex || (mode === 'existing' ? !selected : !directory.trim())} onClick={() => void bind()}>{busy ? ar ? 'جارٍ التجهيز…' : 'Preparing…' : ar ? 'فتح المحادثة' : 'Open conversation'}</button></footer>
  </Dialog>
}

function ConversationSlot({ team, slot, enabled, models, identity, incoming, compact, onTransfer }: { compact: boolean; team: SuperAgentTeam; slot: SuperAgentSlot; enabled: boolean; models: CodexModelInfo[]; identity?: string; incoming: Delivery | null; onTransfer: (source: SuperAgentSlot, text: string) => void }) {
  const ar = useLocale() === 'ar'
  const draftKey = `${team.id}:${slot.id}:${slot.thread!.id}`
  const saveDraft = useCallback((text: string, attachments: string[]) => { draftCache.set(draftKey, { text, attachments }) }, [draftKey])
  const saveSettings = useCallback((settings: CodexSettings) => { settingsCache.set(draftKey, settings) }, [draftKey])
  const send = useCallback(async (id: string, text: string, attachments: string[] = [], settings?: { model: string; effort: string }) => {
    const originalDraft = draftCache.get(draftKey)
    const result = await api.sendSuperMessage(team.id, slot.id, id, text, attachments, settings)
    if (draftCache.get(draftKey) === originalDraft) draftCache.delete(draftKey)
    return result
  }, [team.id, slot.id, draftKey])
  const controller = useConversation(slot.thread, { enabled, codexOnly: true, send, models, initialDraft: draftCache.get(draftKey), saveDraft, initialSettings: settingsCache.get(draftKey), saveSettings })
  const { composer, turn, view } = controller
  const scroll = useChatHistory(view.messages, draftKey)
  useEffect(() => {
    if (incoming?.teamId === team.id && incoming.slotId === slot.id && incoming.threadId === slot.thread?.id) composer.onDraftChange([composer.draft, incoming.text].filter(Boolean).join('\n\n'))
  }, [incoming?.id])
  const busy = composer.sending || turn.active
  const sendNow = () => { if (!enabled || busy || team.archived) return; composer.onSend(); scroll.scrollToLatest() }
  return <>
    <div className="flex min-h-0 flex-1 flex-col"><div ref={scroll.ref} onScroll={scroll.handleScroll} onWheel={scroll.handleWheel} className={cx('thin-scroll min-h-0 flex-1 overflow-y-auto', compact ? 'px-2.5 py-2' : 'px-4 py-4')}>
      <EarlierMessages count={scroll.hiddenCount} onLoad={scroll.loadOlder} />
      {!view.messages.length ? <p className="py-6 text-center text-xs leading-6 text-ink-soft">{view.loading ? ar ? 'جارٍ تحميل الرسائل…' : 'Loading messages…' : ar ? 'اكتب مهمة أو انقل رسالة إلى هذه المسودة.' : 'Write a task or transfer a message into this draft.'}</p> : null}
      <ol className={compact ? 'space-y-2.5' : 'space-y-4'}>{scroll.visibleMessages.map(message => <li data-super-message key={message.id}><MessageBubble message={message} speaker="codex" codexIdentity={identity} /><button type="button" className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-ink-soft hover:bg-relay-tint hover:text-relay-ink" onClick={event => {
        const selection = window.getSelection(), parent = event.currentTarget.closest('[data-super-message]')
        const text = selection?.rangeCount && parent?.contains(selection.getRangeAt(0).commonAncestorContainer) && selection.toString().trim() ? selection.toString() : message.text
        onTransfer(slot, text)
      }}><ArrowRightLeft className="h-3 w-3" />{ar ? 'نقل إلى…' : 'Transfer to…'}</button></li>)}</ol>
      {!!view.fileChanges.length ? <div className="mt-4"><ChangedFiles source="codex" sessionId={slot.thread!.id} active={turn.active} files={view.fileChanges} /></div> : null}
    </div>{!scroll.atLatest && view.messages.length ? <button type="button" className="self-center rounded-full border border-line bg-card px-3 py-1 text-[10px] text-ink-soft" onClick={() => scroll.scrollToLatest(true)}>{ar ? 'آخر رسالة' : 'Latest message'}</button> : null}</div>
    <form onSubmit={event => { event.preventDefault(); sendNow() }} className={cx('super-agent-composer shrink-0 bg-transparent', compact ? 'p-2' : 'p-3')}>
      {composer.attachments.length ? <div className="mb-2 flex flex-wrap gap-1">{composer.attachments.map(file => <button key={file} type="button" title={file} onClick={() => composer.onRemoveAttachment(file)} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px]"><code dir="ltr" className="truncate">{file.split(/[\\/]/).pop()}</code><X className="h-3 w-3 shrink-0" /></button>)}</div> : null}
      <div className="flex items-end gap-2"><div className="codex-input-capsule relative min-w-0 flex-1 rounded-2xl border border-line p-2 focus-within:border-relay/60"><textarea aria-label={`${ar ? 'رسالة إلى' : 'Message'} ${slotName(slot, ar)}`} value={composer.draft} onChange={event => composer.onDraftChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendNow() } }} rows={compact ? 1 : 2} placeholder={ar ? 'اكتب رسالتك…' : 'Write a message…'} className={cx('block w-full resize-none bg-transparent px-1 text-xs leading-5 outline-none', compact ? 'min-h-6' : 'min-h-10')} />
        <div className="mt-1 flex items-center"><button type="button" disabled={busy || !enabled || team.archived} onClick={composer.onAttach} aria-label={ar ? 'إرفاق مسار ملف' : 'Attach file path'} className="rounded-full p-2 text-ink-soft hover:bg-paper disabled:opacity-40"><Paperclip className="h-3.5 w-3.5" /></button><CodexSettingsPicker selection={controller.codexSelection} disabled={busy || !enabled || team.archived} />{busy ? <span role="status" className="ms-auto text-[10px] text-relay-ink">{ar ? 'يعمل…' : 'Working…'}</span> : null}</div>
      </div>{turn.active ? <button type="button" disabled={turn.stopping || !enabled} onClick={composer.onStop} aria-label={ar ? 'إيقاف هذه المحادثة' : 'Stop this conversation'} className={`${button} mb-1 h-9 w-9 shrink-0 rounded-full text-review-ink`}><Square className="h-3.5 w-3.5" /></button> : <button type="submit" disabled={busy || !enabled || team.archived || !composer.draft.trim() && !composer.attachments.length} aria-label={ar ? 'إرسال' : 'Send'} className={`${button} mb-1 h-9 w-9 shrink-0 rounded-full bg-relay-tint text-relay-ink`}><Send className="h-3.5 w-3.5" /></button>}</div>
      {composer.error || controller.codexSelection.error ? <p role="alert" className="mt-2 break-words text-[11px] leading-5 text-review-ink">{composer.error || controller.codexSelection.error}</p> : null}
    </form>
  </>
}

export function SuperAgentWorkspace({ visible, identity }: { visible: boolean; identity?: string }) {
  const ar = useLocale() === 'ar', activity = useProviderActivity()
  const [teams, setTeams] = useState<SuperAgentTeam[]>([])
  const [selected, setSelected] = useState(() => { try { return localStorage.getItem(preferenceKeys.superTeam) || '' } catch { return '' } })
  const [brainOpen, setBrainOpen] = useState(false)
  const [presentation, setPresentation] = useState<'office' | 'chats'>('office')
  const [archived, setArchived] = useState(false), [focused, setFocused] = useState<SuperSlotId | null>(null)
  const [picker, setPicker] = useState<SuperSlotId | null>(null), [rename, setRename] = useState(false), [name, setName] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [transfer, setTransfer] = useState<{ source: SuperAgentSlot; text: string; target: SuperSlotId | '' } | null>(null)
  const [incoming, setIncoming] = useState<Delivery | null>(null)
  const catalog = usePolling(visible && activity.providers.codex ? api.codexModels : null, 300_000)
  useEffect(() => {
    if (!visible) return
    let current = true; setLoading(true)
    void api.superTeams().then(next => { if (current) setTeams(previous => next.map(team => { const local = previous.find(item => item.id === team.id); return local && local.updatedAt > team.updatedAt ? local : team })) }).catch(failure => { if (current) setError(failure instanceof Error ? failure.message : String(failure)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [visible])
  const choices = teams.filter(team => team.archived === archived)
  const team = choices.find(team => team.id === selected) || choices[0]
  useEffect(() => { if (team) { setSelected(team.id); persistPreference(preferenceKeys.superTeam, team.id) } }, [team?.id])
  useEffect(() => { setFocused(null); setPicker(null); setTransfer(null); setIncoming(null) }, [team?.id])
  const changed = (next: SuperAgentTeam) => {
    setTeams(previous => [next, ...previous.filter(item => item.id !== next.id)])
    if (focused && next.id === team?.id && !next.slots.some(slot => slot.id === focused)) setFocused(null)
  }
  async function perform(operation: () => Promise<SuperAgentTeam>, select = false) {
    if (busy) return
    setBusy(true); setError('')
    try { const next = await operation(); changed(next); if (select) { setArchived(next.archived); setSelected(next.id) } }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const visibleSlots = team?.slots || []
  const officeVisible = presentation === 'office'
  const officePopup = officeVisible && Boolean(focused)
  const chatPanel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (visible && officePopup && focused) chatPanel.current?.querySelector<HTMLTextAreaElement>(`[data-slot="${focused}"] textarea`)?.focus({ preventScroll: true })
  }, [visible, officePopup, focused])
  return <main id="workspace-super" role="tabpanel" aria-labelledby="workspace-mode-super" dir={direction()} style={!visible ? { display: 'none' } : undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-card px-3 py-2"><Users className="h-4 w-4 text-relay-ink" aria-hidden="true" /><strong className="me-1 text-xs">Super Agent</strong>
      <div className="min-w-32 max-w-56 flex-1"><SettingsSelect label={ar ? 'الفريق' : 'Team'} value={team?.id || ''} onChange={setSelected} disabled={busy || !choices.length} options={choices.length ? choices.map(item => ({ value: item.id, label: item.title })) : [{ value: '', label: ar ? 'اختر فريقًا' : 'Choose a team' }]} className="!mt-0 !min-h-8 !rounded-lg !py-1.5" /></div>
      <button type="button" className={button} disabled={busy} onClick={() => void perform(() => api.createSuperTeam(ar ? 'فريق جديد' : 'New team'), true)}><Plus className="h-3.5 w-3.5" />{ar ? 'فريق' : 'Team'}</button>
      <button type="button" className={button} disabled={!team || busy} aria-label={ar ? 'تسمية الفريق' : 'Rename team'} title={ar ? 'تسمية الفريق' : 'Rename team'} onClick={() => { setName(team?.title || ''); setRename(true) }}><Pencil className="h-3.5 w-3.5" /></button>
      <button type="button" className={button} disabled={!team || busy} onClick={() => team && void perform(() => api.updateSuperTeam(team.id, { archived: !team.archived }))}><Archive className="h-3.5 w-3.5" />{archived ? ar ? 'استعادة' : 'Restore' : ar ? 'أرشفة' : 'Archive'}</button>
      <button type="button" className={cx(button, archived && 'bg-relay-tint text-relay-ink')} aria-pressed={archived} onClick={() => setArchived(value => !value)}>{ar ? 'الأرشيف' : 'Archived'}</button>
      <div className="ms-auto flex items-center rounded-lg border border-line bg-paper p-0.5" role="group" aria-label={ar ? 'طريقة العرض' : 'Workspace view'}>{(['office', 'chats'] as const).map(value => <button type="button" key={value} aria-pressed={presentation === value} onClick={() => { setPresentation(value); setFocused(null) }} className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40', presentation === value ? 'bg-card text-relay-ink shadow-sm' : 'text-ink-soft')}>{value === 'office' ? <MapIcon className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}{value === 'office' ? ar ? 'المكاتب' : 'Office' : ar ? 'الشاتات' : 'Chats'}</button>)}</div>
      {team ? <button type="button" className={`${button} bg-relay-tint text-relay-ink`} disabled={busy || team.archived} onClick={() => void perform(() => api.addSuperSlot(team.id))}><Plus className="h-3.5 w-3.5" />{ar ? 'إضافة مكتب' : 'Add desk'}</button> : null}
      <button type="button" className={button} disabled={!team} onClick={() => setBrainOpen(true)}><Brain className="h-3.5 w-3.5" />Core-Brain</button>
    </header>
    {!activity.providers.codex ? <p role="status" className="border-b border-line px-4 py-2 text-xs text-review-ink">{ar ? 'Codex موقوف. فعّله من الاتصال والتحديثات.' : 'Codex is disabled. Enable it in Connections & updates.'}</p> : null}
    {error || catalog.error ? <p role="alert" className="px-4 py-2 text-xs text-review-ink">{error || catalog.error}</p> : null}
    {!team ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"><Users className="h-9 w-9 text-ink-soft" /><h1 className="text-lg font-semibold">{loading ? ar ? 'جارٍ تحميل الفرق…' : 'Loading teams…' : ar ? 'مساحة واحدة لفريقك' : 'One workspace for your team'}</h1><p className="max-w-md text-sm leading-7 text-ink-soft">{ar ? 'أنشئ فريقًا، ثم اختر محادثة المدير ومحادثات المهام. المدير يرسل للمكاتب التي تحددها ويجمع ردودها تلقائيًا.' : 'Create a team, then choose the manager and task conversations. The manager sends to the desks you request and gathers their actual replies.'}</p><button type="button" disabled={busy || loading} className={`${button} bg-relay-tint text-relay-ink`} onClick={() => void perform(() => api.createSuperTeam(ar ? 'فريق جديد' : 'New team'), true)}><Plus className="h-4 w-4" />{ar ? 'إنشاء فريق' : 'Create team'}</button></div> : <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {officeVisible ? <SuperAgentOffice slots={visibleSlots} archived={team.archived} enabled={visible && activity.providers.codex} onOpen={slot => slot.thread ? setFocused(slot.id) : setPicker(slot.id)} /> : null}
      <div ref={chatPanel} dir="ltr" role={officePopup ? 'complementary' : undefined} aria-label={officePopup ? ar ? 'محادثة المكتب' : 'Desk conversation' : undefined} onKeyDown={event => { if (officePopup && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setFocused(null) } }} style={{ ...(officeVisible && !focused ? { display: 'none' } : {}), '--worker-rows': Math.max(1, Math.ceil((visibleSlots.length - 1) / 2)) } as CSSProperties} className={cx('super-agent-grid thin-scroll min-h-0 flex-1 gap-2 overflow-y-auto p-2', (focused || visibleSlots.length === 1) && 'super-agent-focused', officePopup && 'super-agent-popup')}>
      {visibleSlots.map((slot, index) => {
        const shown = !focused || focused === slot.id
        return <section key={`${team.id}:${slot.id}`} data-slot={slot.id} data-compact={!focused && slot.id !== 'manager'} dir={direction()} style={{ ...(!shown ? { display: 'none' } : {}), '--slot-column': index % 2 === 1 ? 3 : 1, '--slot-row': Math.max(1, Math.ceil(index / 2)) } as CSSProperties} className={cx('chat-panel super-agent-slot flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card', slot.id === 'manager' ? 'border-relay/40' : 'border-line')}>
          <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-2.5"><span className="text-relay-ink" aria-hidden="true">{slot.id === 'manager' ? <Crown className="h-3.5 w-3.5" /> : <Users className="h-3 w-3" />}</span><div className="min-w-0 flex-1" title={`${slot.thread?.title || ''}\n${slot.thread?.directory || ''}`}><h2 className="truncate text-[11px] font-semibold">{slotName(slot, ar)}{slot.thread ? <span className="ms-2 text-[10px] font-normal text-ink-soft">{slot.thread.title}</span> : null}</h2></div><button type="button" disabled={team.archived || busy} title={ar ? 'اختيار المحادثة والمشروع' : 'Choose conversation and project'} aria-label={ar ? 'اختيار المحادثة والمشروع' : 'Choose conversation and project'} onClick={() => setPicker(slot.id)} className="rounded-md p-1.5 text-ink-soft hover:bg-paper"><FolderOpen className="h-3.5 w-3.5" /></button>{slot.thread ? <button type="button" disabled={team.archived || busy} className="rounded-md p-1.5 text-ink-soft hover:bg-paper" aria-label={ar ? 'إزالة الربط فقط' : 'Unlink conversation'} title={ar ? 'إزالة الربط فقط' : 'Unlink conversation'} onClick={() => void perform(() => api.bindSuperSlot(team.id, slot.id, { clear: true }))}><Unlink className="h-3.5 w-3.5" /></button> : null}<button type="button" aria-label={focused ? officeVisible ? ar ? 'إغلاق الشات' : 'Close chat' : ar ? 'عودة للتوزيع' : 'Back to overview' : ar ? 'تكبير الشات' : 'Focus conversation'} title={focused ? officeVisible ? ar ? 'إغلاق الشات' : 'Close chat' : ar ? 'عودة للتوزيع' : 'Back to overview' : ar ? 'تكبير الشات' : 'Focus conversation'} className="rounded-md p-1.5 text-ink-soft hover:bg-paper" onClick={() => setFocused(focused ? null : slot.id)}>{focused ? officeVisible ? <X className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>{slot.id !== 'manager' ? <button type="button" disabled={busy || team.archived} title={ar ? 'إزالة المكتب، مع الاحتفاظ بالمحادثة' : 'Remove desk, keep conversation'} aria-label={ar ? 'إزالة المكتب، مع الاحتفاظ بالمحادثة' : 'Remove desk, keep conversation'} className="rounded-md p-1.5 text-ink-soft hover:bg-paper hover:text-review-ink" onClick={() => void perform(() => api.removeSuperSlot(team.id, slot.id))}><Trash2 className="h-3.5 w-3.5" /></button> : null}</header>
          {slot.thread ? <ConversationSlot key={`${team.id}:${slot.id}:${slot.thread.id}`} team={team} slot={slot} compact={!focused && slot.id !== 'manager'} enabled={visible && (!officeVisible || officePopup) && shown && activity.providers.codex} models={catalog.data || []} identity={identity} incoming={incoming} onTransfer={(source, text) => setTransfer({ source, text, target: '' })} /> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-8 text-center"><p className="text-xs text-ink-soft">{slot.id === 'manager' ? ar ? 'اختر محادثة المدير' : 'Choose the manager conversation' : ar ? 'اربط محادثة بهذه المهمة' : 'Assign a conversation to this task'}</p><button type="button" className={button} disabled={team.archived} onClick={() => setPicker(slot.id)}><Plus className="h-3.5 w-3.5" />{ar ? 'فتح محادثة' : 'Open conversation'}</button></div>}
        </section>
      })}
    </div></div>}
    {brainOpen && team ? <Dialog title="Core-Brain" onClose={() => setBrainOpen(false)}><CoreBrainPanel key={team.id} team={team} /></Dialog> : null}
    {picker && team ? <SlotPicker key={`${team.id}:${picker}`} team={team} slot={team.slots.find(slot => slot.id === picker)!} onChange={changed} onClose={() => setPicker(null)} /> : null}
    {rename && team ? <Dialog title={ar ? 'اسم الفريق' : 'Team name'} onClose={() => setRename(false)}><form onSubmit={event => { event.preventDefault(); void perform(() => api.updateSuperTeam(team.id, { title: name })); setRename(false) }} className="flex gap-2"><input autoFocus aria-label={ar ? 'اسم الفريق' : 'Team name'} value={name} maxLength={120} onChange={event => setName(event.target.value)} className={`${field} flex-1`} /><button type="submit" disabled={!name.trim()} className={button}><Check className="h-4 w-4" /></button></form></Dialog> : null}
    {transfer && team ? <Dialog title={ar ? 'نقل إلى مسودة محادثة' : 'Transfer to conversation draft'} onClose={() => setTransfer(null)}><div className="space-y-3"><SettingsSelect label={ar ? 'المحادثة المستقبلة' : 'Destination conversation'} value={transfer.target} onChange={value => setTransfer({ ...transfer, target: value as SuperSlotId })} options={[{ value: '', label: ar ? 'اختر الوجهة' : 'Choose destination' }, ...visibleSlots.filter(slot => slot.thread && slot.id !== transfer.source.id).map(slot => ({ value: slot.id, label: `${slotName(slot, ar)} · ${slot.thread?.title}` }))]} /><textarea aria-label={ar ? 'النص المنقول' : 'Transferred text'} rows={8} value={transfer.text} onChange={event => setTransfer({ ...transfer, text: event.target.value })} className={`${field} w-full resize-y`} /><p className="text-[11px] text-ink-soft">{ar ? 'يُضاف للمسودة فقط. راجعه واضغط إرسال من الشات المستقبِل.' : 'Added to the draft only. Review it and send from the destination chat.'}</p><button type="button" className={button} disabled={!transfer.target || !transfer.text.trim() || team.archived} onClick={() => {
      const target = team.slots.find(slot => slot.id === transfer.target)
      if (!target?.thread) return
      setIncoming({ id: Date.now(), teamId: team.id, slotId: target.id, threadId: target.thread.id, text: `[${slotName(transfer.source, ar)} · ${transfer.source.thread?.directory || ''}]\n${transfer.text}` }); setFocused(target.id); setTransfer(null)
    }}><ArrowLeft className="h-3.5 w-3.5" />{ar ? 'إضافة للمسودة' : 'Add to draft'}</button></div></Dialog> : null}
  </main>
}
