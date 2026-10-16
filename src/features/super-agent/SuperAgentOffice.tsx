import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowUpRight, Check, CircleAlert, Link2, Minus, Orbit, Plus, Radio, Scan, Send } from 'lucide-react'
import { useProviderActivity } from '../../hooks/useProviderActivity'
import { api } from '../../lib/api'
import { usePolling } from '../../hooks/usePolling'
import { useLocale } from '../../lib/i18n'
import type { SuperAgentSlot, SuperSlotId } from '../../lib/types'
import { connectionLabel, officeConnection, officeConnector, officePositions, officeSceneSize, stationWidth, type ConnectionState, type OfficeDock, type OfficePosition } from './office-connections'

/** Small vector rooms keep the overview sharp without a WebGL runtime or image assets. */
function OfficeRoom({ occupied, active, facing }: { occupied: boolean; active: boolean; facing: OfficeDock }) {
  const dock = { left: [14, 126], right: [266, 126], top: [140, 58], bottom: [140, 202] }[facing]
  return <svg viewBox="0 0 280 230" aria-hidden="true" className="super-office-room w-full overflow-visible">
    <ellipse cx="140" cy="193" rx="112" ry="23" fill="var(--color-overlay)" opacity=".12" />
    <path d="M14 126 140 58 266 126 140 202Z" fill="var(--office-floor)" stroke="var(--office-accent)" strokeWidth="1.5" />
    <path d="M14 126v8l126 69 126-69v-8l-126 69Z" fill="var(--office-accent)" opacity=".5" />
    <path d="M14 126V55L140 0v58Z" fill="var(--office-wall)" stroke="var(--office-accent)" strokeWidth="1.2" />
    <path d="M140 0 266 55v71L140 58Z" fill="var(--office-wall-back)" stroke="var(--office-accent)" strokeWidth="1.2" />
    <path d="m26 60 101-45M153 16l99 44" stroke="var(--office-accent)" strokeWidth="3" strokeLinecap="round" />
    <path d="m38 67 48-22v31L38 98Z" fill="var(--color-paper)" stroke="var(--color-line-strong)" />
    <path d="m46 70 23-10m-23 17 29-13m-29 20 17-8" stroke="var(--office-accent)" strokeWidth="2" opacity=".7" />
    <path d="m181 40 48 21v6l-48-21Z" fill="var(--color-ink-soft)" />
    {[0, 1, 2, 3].map(book => <path key={book} d={`m${185 + book * 10} ${39 + book * 4.4}v-10l6 3v10Z`} fill={book % 2 ? 'var(--color-review)' : 'var(--office-accent)'} opacity=".85" />)}
    {[0, 1].map(index => <g key={index} transform={`translate(${index * 69} ${index * 33})`}>
      <path d="m62 112 49-26 48 24-49 27Z" fill="var(--color-card)" stroke="var(--color-line-strong)" />
      <path d="M64 114v27m45-5v28m46-51v27" stroke="var(--color-ink-soft)" strokeWidth="3" />
      <path d="m96 96 28 13V88L96 75Z" fill="var(--color-paper)" stroke="var(--color-ink-soft)" strokeWidth="2" />
      <path d="m101 86 17 8m-17-2 11 5m-11 0 15 7" stroke="var(--office-accent)" strokeWidth="2" opacity={active ? 1 : .3} />
      {active ? <path className="super-office-cursor" d="m115 104 5 2" stroke="var(--color-ready)" strokeWidth="2" /> : null}
      <path d="m91 115 10-5 19 9-10 5Z" fill="var(--color-line-strong)" />
      <ellipse cx="79" cy="138" rx="13" ry="6" fill="var(--color-ink-soft)" />
      <path d="M79 139v16m-9 4 9-4 9 4" fill="none" stroke="var(--color-ink-soft)" strokeWidth="3" />
      {occupied ? <g>
        <path d="m75 141 7 4 6-5m-7 4 1 12" fill="none" stroke="var(--color-ink)" strokeWidth="5" strokeLinecap="round" />
        <path d="M72 120q8-6 15 3l-1 16q-8 5-15-1Z" fill="var(--office-accent)" />
        <path d="m84 126 9-3 8-7" fill="none" stroke="var(--color-ink-soft)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="80" cy="112" r="7" fill="var(--color-ink-soft)" />
        <path d="M74 110q-1-10 10-5l3 6Z" fill="var(--color-ink)" />
      </g> : null}
    </g>)}
    <path d="m230 131 14 7-3 19-10 5-5-22Z" fill="var(--color-card)" stroke="var(--color-line-strong)" />
    <path d="M235 139v-27" stroke="var(--color-ready-ink)" strokeWidth="3" />
    <ellipse cx="230" cy="117" rx="9" ry="6" transform="rotate(30 230 117)" fill="var(--color-ready)" />
    <ellipse cx="241" cy="111" rx="7" ry="9" transform="rotate(25 241 111)" fill="var(--color-ready-ink)" />
    <g className="super-office-port" transform={`translate(${dock[0]} ${dock[1]})`}>
      <circle r="8" fill="var(--color-paper)" stroke="currentColor" strokeWidth="1.5" />
      <circle r="3" fill="currentColor" />
    </g>
  </svg>
}

function BrainCore({ active }: { active: boolean }) {
  const id = useId().replace(/:/g, '')
  return <svg viewBox="0 0 280 230" aria-hidden="true" className="super-office-room super-office-brain w-full overflow-visible" data-active={active}>
    <defs>
      <radialGradient id={`${id}-sphere`} cx="32%" cy="25%" r="75%">
        <stop offset="0" stopColor="var(--color-card)" />
        <stop offset=".32" stopColor="var(--color-relay-ink)" />
        <stop offset="1" stopColor="var(--color-relay-tint)" />
      </radialGradient>
      <radialGradient id={`${id}-halo`}>
        <stop stopColor="var(--color-relay)" stopOpacity=".25" />
        <stop offset="1" stopColor="var(--color-relay)" stopOpacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="140" cy="192" rx="112" ry="25" fill="var(--color-overlay)" opacity=".12" />
    <path d="M36 177v11a104 30 0 0 0 208 0v-11" fill="var(--color-card)" stroke="var(--color-line-strong)" />
    <ellipse cx="140" cy="177" rx="104" ry="30" fill="var(--color-paper)" stroke="var(--color-relay)" strokeWidth="1.5" />
    <ellipse cx="140" cy="177" rx="87" ry="22" fill="var(--color-relay-tint)" stroke="var(--color-relay)" opacity=".65" />
    <ellipse cx="140" cy="177" rx="65" ry="15" fill="none" stroke="var(--color-relay-ink)" opacity=".5" />
    {[[36, 177], [244, 177], [140, 147], [140, 207]].map(([x, y]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}><circle r="7" fill="var(--color-paper)" stroke="var(--color-relay-ink)" strokeWidth="1.5" /><circle r="2.5" fill="var(--color-relay-ink)" /></g>)}
    <circle className="super-brain-halo" cx="140" cy="103" r="91" fill={`url(#${id}-halo)`} />
    <path d="M140 155v22m-12-22-7 21m31-21 7 21" stroke="var(--color-relay)" opacity=".5" />
    <circle cx="140" cy="103" r="51" fill={`url(#${id}-sphere)`} stroke="var(--color-relay-ink)" strokeWidth="1.5" />
    <g fill="none" stroke="var(--color-card)" strokeWidth=".8" opacity=".4">
      <ellipse cx="140" cy="103" rx="22" ry="51" />
      <ellipse cx="140" cy="103" rx="43" ry="51" transform="rotate(35 140 103)" />
      <ellipse cx="140" cy="103" rx="51" ry="18" />
      <path d="M96 78q44 20 88 0m-88 50q44-20 88 0" />
    </g>
    <g fill="none" stroke="var(--color-relay-ink)" opacity=".65">
      <ellipse cx="140" cy="103" rx="82" ry="26" transform="rotate(-27 140 103)" />
      <ellipse cx="140" cy="103" rx="74" ry="31" transform="rotate(41 140 103)" />
      <path d="m37 145 27-15m151-70 24-15M76 39l22 20m110 90 24 20" strokeDasharray="3 5" />
    </g>
    {[[67, 136], [213, 70], [85, 54], [196, 148]].map(([cx, cy], index) => <g key={index}>
      <circle cx={cx} cy={cy} r="6" fill="var(--color-card)" stroke="var(--color-relay)" />
      <circle className="super-brain-node" cx={cx} cy={cy} r="2.5" fill="var(--color-relay-ink)" style={{ animationDelay: `${index * 250}ms` }} />
    </g>)}
    <circle cx="140" cy="103" r="5" fill="var(--color-card)" opacity=".85" />
  </svg>
}

function Station({ teamId, slot, enabled: visible, archived, position, width, selected, connection, onOpen }: { teamId: string; slot: SuperAgentSlot; enabled: boolean; archived: boolean; position: OfficePosition; width: number; selected: boolean; connection: ConnectionState; onOpen: (slot: SuperAgentSlot) => void }) {
  const ar = useLocale() === 'ar'
  const activity = useProviderActivity(), provider = slot.thread?.provider || 'codex', enabled = visible && activity.providers[provider]
  const status = usePolling(enabled && slot.thread ? () => provider === 'opencode' ? api.superOpenCodeStatus(teamId, slot.id) : api.turnState(slot.thread!.id) : null, 5000, { resetKey: slot.thread?.id })
  const active = enabled && !status.error && (Boolean(status.data?.active) || connection === 'running')
  const title = slot.label || (slot.id === 'manager' ? ar ? 'العقل' : 'Brain' : `${ar ? 'مهمة' : 'Task'} ${slot.id.slice(7)}`)
  const state = !slot.thread ? ar ? 'اختيار محادثة' : 'Assign conversation' : !enabled ? connectionLabel('paused', ar) : status.error ? connectionLabel('unavailable', ar) : ['queued', 'dispatching', 'running', 'completed', 'failed', 'interrupted'].includes(connection) ? connectionLabel(connection, ar) : !status.data ? ar ? 'جارٍ تحديث الحالة' : 'Checking status' : active ? ar ? 'مشغول' : 'Busy' : ar ? 'جاهز' : 'Ready'
  return <button type="button" disabled={archived && !slot.thread} onClick={() => onOpen(slot)} aria-label={`${title}: ${state}`} aria-pressed={selected} style={{ left: `${position.left}%`, top: `${position.top}%`, width: stationWidth(width), '--office-accent': position.accent } as CSSProperties} className="super-office-station group absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl text-start outline-none focus-visible:ring-2 focus-visible:ring-relay focus-visible:ring-offset-4 focus-visible:ring-offset-paper disabled:opacity-50" data-active={active} data-selected={selected} data-connection={connection}>
    <div className="super-office-label relative z-10 mx-1 flex h-12 items-center gap-2 rounded-xl border border-line bg-card px-3 shadow-sm transition-colors group-hover:border-relay/60">
      <span className="super-office-marker flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">{slot.id === 'manager' ? <Orbit className="h-3.5 w-3.5" /> : slot.thread ? <span className="text-xs font-semibold">{slot.id.slice(7)}</span> : <Plus className="h-3.5 w-3.5" />}</span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong dir="auto" className="truncate text-xs font-semibold">{title}</strong>{slot.thread ? <span dir="ltr" className="text-[9px] text-ink-soft">{provider === 'opencode' ? 'OpenCode' : 'Codex'}</span> : null}</span><span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-soft"><span className="super-office-state-dot h-1.5 w-1.5 shrink-0 rounded-full bg-ink-soft/40" />{state}</span></span><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-ink-soft transition-colors group-hover:text-relay-ink" />
    </div>
    {slot.id === 'manager' ? <BrainCore active={active} /> : <OfficeRoom occupied={Boolean(slot.thread)} active={active} facing={position.dock} />}
    <span dir="auto" className="mx-5 block h-5 truncate text-center font-mono text-[10px] leading-5 text-ink-soft" title={slot.thread?.directory}>{slot.thread?.directory?.split(/[\\/]/).filter(Boolean).pop() || (ar ? 'غير مرتبط' : 'Unassigned')}</span>
  </button>
}

export function SuperAgentOffice({ teamId, slots, enabled, archived, selectedSlotId, onOpen }: { teamId: string; slots: SuperAgentSlot[]; enabled: boolean; archived: boolean; selectedSlotId?: SuperSlotId | null; onOpen: (slot: SuperAgentSlot) => void }) {
  const ar = useLocale() === 'ar'
  const activity = useProviderActivity()
  const tasks = usePolling(enabled ? () => api.superTasks(teamId) : null, data => data?.some(task => ['queued', 'dispatching', 'running'].includes(task.status)) ? 1500 : 3500, { resetKey: teamId })
  const returning = useRef(new Map<string, string>())
  const hadSnapshot = useRef(false)
  const [replies, setReplies] = useState(new Set<string>())
  useEffect(() => { returning.current.clear(); hadSnapshot.current = false; setReplies(new Set()) }, [teamId])
  useEffect(() => {
    if (!enabled || !tasks.data) return
    const received = tasks.data.filter(task => task.status === 'completed' && hadSnapshot.current && (!returning.current.has(task.id) || ['queued', 'dispatching', 'running'].includes(returning.current.get(task.id) || ''))).map(task => task.id)
    returning.current = new Map(tasks.data.map(task => [task.id, task.status]))
    hadSnapshot.current = true
    if (!received.length) return
    setReplies(new Set(received))
  }, [tasks.data, enabled])
  useEffect(() => {
    if (!replies.size) return
    const timeout = window.setTimeout(() => setReplies(new Set()), 2400)
    return () => window.clearTimeout(timeout)
  }, [replies])
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const [size, setSize] = useState({ width: 850, height: 650 })
  const previous = useRef<{ width: number; height: number; zoom: number } | null>(null)
  const changeZoom = (delta: number) => setZoom(value => Math.max(40, Math.min(200, value + delta)))
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setSize({ width: Math.max(850, Math.min(1440, element.clientWidth)), height: element.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (event.deltaY) setZoom(value => Math.max(40, Math.min(200, value + (event.deltaY < 0 ? 10 : -10))))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel) }
  }, [])
  const { width: sceneWidth, height: sceneHeight } = officeSceneSize(Math.max(0, slots.length - 1), size.width, size.height)
  const positions = officePositions(slots, sceneWidth, sceneHeight)
  const manager = slots.find(slot => slot.id === 'manager')
  const connections = new Map(slots.filter(slot => slot.id !== 'manager').map(slot => [slot.id, officeConnection(slot, tasks.data || [], manager?.thread?.id, enabled && activity.providers.codex && activity.providers[slot.thread?.provider || 'codex'], Boolean(tasks.error) || !tasks.data)]))
  const links = slots.filter(slot => slot.id !== 'manager').map(slot => ({ slot, ...connections.get(slot.id)!, geometry: officeConnector(positions.get(slot.id)!, sceneWidth, sceneHeight) }))
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const old = previous.current
    const x = old && old.width * old.zoom / 100 > element.clientWidth ? (element.scrollLeft + element.clientWidth / 2) / (old.width * old.zoom / 100) : .5
    const y = old && old.height * old.zoom / 100 > element.clientHeight ? (element.scrollTop + element.clientHeight / 2) / (old.height * old.zoom / 100) : .5
    element.scrollLeft = Math.max(0, x * sceneWidth * zoom / 100 - element.clientWidth / 2)
    element.scrollTop = Math.max(0, y * sceneHeight * zoom / 100 - element.clientHeight / 2)
    previous.current = { width: sceneWidth, height: sceneHeight, zoom }
  }, [zoom, sceneWidth, sceneHeight])
  const zoomButton = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs text-ink-soft hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-35 disabled:hover:bg-transparent'
  return <section aria-label={ar ? 'مكاتب الفريق' : 'Team office'} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div ref={viewport} dir="ltr" className="super-office thin-scroll min-h-0 flex-1 overflow-auto">
    <div style={{ width: sceneWidth * zoom / 100, height: sceneHeight * zoom / 100 }} className="relative mx-auto overflow-hidden">
    <div dir="ltr" style={{ width: sceneWidth, height: sceneHeight, transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }} className="absolute left-0 top-0">
      <svg viewBox={`0 0 ${sceneWidth} ${sceneHeight}`} aria-hidden="true" className="super-office-links pointer-events-none absolute inset-0 h-full w-full">
        {links.map(({ slot, state, task, geometry }) => <g key={slot.id} className="super-office-link" data-desk={slot.id} data-state={state} data-selected={selectedSlotId === slot.id}>
          <path d={geometry.path} className="super-link-bed" fill="none" stroke="currentColor" strokeWidth="7" opacity=".07" />
          <path d={geometry.path} className="super-link-track" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          {(state === 'dispatching' || state === 'running') && enabled && !archived ? <path d={geometry.path} pathLength="100" className="super-link-outbound" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 24" /> : null}
          {state === 'completed' && task && replies.has(task.id) && enabled && !archived ? <path d={geometry.path} pathLength="100" className="super-link-return" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 98" /> : null}
          <circle cx={geometry.start.x} cy={geometry.start.y} r="3" fill="currentColor" />
          <circle cx={geometry.end.x} cy={geometry.end.y} r="4" fill="var(--color-paper)" stroke="currentColor" strokeWidth="1.5" />
        </g>)}
      </svg>
      {links.filter(link => ['queued', 'dispatching', 'running', 'completed', 'failed', 'interrupted'].includes(link.state) || selectedSlotId === link.slot.id).map(({ slot, state, geometry }) => <span key={slot.id} data-state={state} dir={ar ? 'rtl' : 'ltr'} className="super-office-link-label pointer-events-none absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-card px-2.5 py-1 text-[10px] shadow-sm" style={{ left: geometry.label.x, top: geometry.label.y }}>
        {state === 'completed' ? <Check className="h-3 w-3" /> : state === 'failed' || state === 'interrupted' ? <CircleAlert className="h-3 w-3" /> : state === 'running' ? <Radio className="h-3 w-3" /> : state === 'queued' || state === 'dispatching' ? <Send className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
        {state === 'ready' && selectedSlotId === slot.id ? ar ? 'عرض المحادثة' : 'Viewing chat' : connectionLabel(state, ar)}
      </span>)}
      {slots.map(slot => <Station teamId={teamId} key={slot.id} slot={slot} enabled={enabled} archived={archived} position={positions.get(slot.id)!} width={sceneWidth} selected={selectedSlotId === slot.id} connection={slot.id === 'manager' ? 'ready' : connections.get(slot.id)!.state} onOpen={onOpen} />)}
    </div>
    </div>
    </div>
    <div dir={ar ? 'rtl' : 'ltr'} className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-3 py-2 text-[10px] text-ink-soft" aria-label={ar ? 'حالات خطوط المهام' : 'Task connection states'}>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-review" />{ar ? 'بانتظار الإرسال' : 'Queued'}</span>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-relay" />{ar ? 'قيد التنفيذ' : 'Working'}</span>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ready" />{ar ? 'وصل الرد' : 'Reply received'}</span>
    </div>
    {tasks.error ? <p role="status" className="absolute bottom-4 end-4 rounded-lg border border-line bg-card px-3 py-2 text-[10px] text-review-ink">{ar ? 'تعذّر تحديث خطوط المهام' : 'Task connections could not be updated'}</p> : null}
    <div dir="ltr" role="group" aria-label={ar ? 'تكبير وتصغير المكاتب' : 'Office zoom'} className="absolute bottom-4 left-4 z-20 flex items-center gap-0.5 rounded-xl border border-line bg-card p-1 shadow-sm">
      <button type="button" className={zoomButton} onClick={() => { const element = viewport.current; if (element) setZoom(Math.max(40, Math.min(100, Math.floor(Math.min(element.clientWidth / sceneWidth, element.clientHeight / sceneHeight) * 100)))) }} aria-label={ar ? 'عرض كل المكاتب' : 'Fit all desks'} title={ar ? 'عرض كل المكاتب' : 'Fit all desks'}><Scan className="h-3.5 w-3.5" /></button>
      <button type="button" className={zoomButton} disabled={zoom <= 40} onClick={() => changeZoom(-10)} aria-label={ar ? 'تصغير' : 'Zoom out'} title={ar ? 'تصغير' : 'Zoom out'}><Minus className="h-3.5 w-3.5" /></button>
      <button type="button" className={`${zoomButton} min-w-14 tabular-nums`} onClick={() => setZoom(100)} aria-label={ar ? 'إعادة التكبير إلى 100%' : 'Reset zoom to 100%'} title={ar ? 'الحجم الطبيعي' : 'Reset zoom'}><span aria-live="polite">{zoom}%</span></button>
      <button type="button" className={zoomButton} disabled={zoom >= 200} onClick={() => changeZoom(10)} aria-label={ar ? 'تكبير' : 'Zoom in'} title={ar ? 'تكبير' : 'Zoom in'}><Plus className="h-3.5 w-3.5" /></button>
    </div>
  </section>
}
