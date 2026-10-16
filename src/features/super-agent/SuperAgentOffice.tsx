import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowUpRight, Minus, Orbit, Plus } from 'lucide-react'
import { useProviderActivity } from '../../hooks/useProviderActivity'
import { api } from '../../lib/api'
import { usePolling } from '../../hooks/usePolling'
import { useLocale } from '../../lib/i18n'
import type { SuperAgentSlot, SuperSlotId } from '../../lib/types'

/** Small vector rooms keep the overview sharp without a WebGL runtime or image assets. */
function OfficeRoom({ occupied, active }: { occupied: boolean; active: boolean }) {
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

type OfficePosition = { left: number; top: number; accent: string }
function officePositions(slots: SuperAgentSlot[]) {
  const positions = new Map<SuperSlotId, OfficePosition>([['manager', { left: 50, top: 50, accent: 'var(--color-relay)' }]])
  const workers = slots.filter(slot => slot.id !== 'manager')
  workers.forEach((slot, index) => {
    const sideCount = index % 2 === 0 ? Math.ceil(workers.length / 2) : Math.floor(workers.length / 2)
    positions.set(slot.id, { left: index % 2 === 0 ? 79 : 21, top: (Math.floor(index / 2) + .5) / sideCount * 90 + 5, accent: ['var(--color-ready)', 'var(--color-review)', 'var(--color-relay)'][index % 3] })
  })
  return positions
}

function Station({ teamId, slot, enabled: visible, archived, position, onOpen }: { teamId: string; slot: SuperAgentSlot; enabled: boolean; archived: boolean; position: OfficePosition; onOpen: (slot: SuperAgentSlot) => void }) {
  const ar = useLocale() === 'ar'
  const activity = useProviderActivity(), provider = slot.thread?.provider || 'codex', enabled = visible && activity.providers[provider]
  const status = usePolling(enabled && slot.thread ? () => provider === 'opencode' ? api.superOpenCodeStatus(teamId, slot.id) : api.turnState(slot.thread!.id) : null, 5000, { resetKey: slot.thread?.id })
  const active = enabled && !status.error && Boolean(status.data?.active)
  const title = slot.label || (slot.id === 'manager' ? ar ? 'العقل' : 'Brain' : `${ar ? 'مهمة' : 'Task'} ${slot.id.slice(7)}`)
  const state = !slot.thread ? ar ? 'اختيار محادثة' : 'Assign conversation' : !enabled ? ar ? 'المزود موقوف' : 'Provider paused' : status.error ? ar ? 'تعذّر تحديث الحالة' : 'Status unavailable' : !status.data ? ar ? 'جارٍ الاتصال' : 'Connecting' : active ? ar ? 'يعمل الآن' : 'Working' : ar ? 'جاهز' : 'Ready'
  return <button type="button" disabled={archived && !slot.thread} onClick={() => onOpen(slot)} aria-label={`${title}: ${state}`} style={{ left: `${position.left}%`, top: `${position.top}%`, '--office-accent': position.accent } as CSSProperties} className="super-office-station group absolute w-[24%] max-w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-2xl text-start outline-none focus-visible:ring-2 focus-visible:ring-relay focus-visible:ring-offset-4 focus-visible:ring-offset-paper disabled:opacity-50" data-active={active}>
    <div className="super-office-label relative z-10 mx-1 flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 shadow-sm transition-colors group-hover:border-relay/60">
      <span className="super-office-marker flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">{slot.id === 'manager' ? <Orbit className="h-3.5 w-3.5" /> : slot.thread ? <span className="text-xs font-semibold">{slot.id.slice(7)}</span> : <Plus className="h-3.5 w-3.5" />}</span>
      <span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-xs font-semibold">{title}</strong><span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-soft"><span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-ready' : 'bg-ink-soft/40'}`} />{slot.thread ? `${provider === 'opencode' ? 'OpenCode' : 'Codex'} / ` : ''}{state}</span></span><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-ink-soft transition-colors group-hover:text-relay-ink" />
    </div>
    {slot.id === 'manager' ? <BrainCore active={active} /> : <OfficeRoom occupied={Boolean(slot.thread)} active={active} />}
    <span dir="auto" className="mx-5 block truncate text-center text-[10px] text-ink-soft" title={slot.thread?.directory}>{slot.thread?.title || (ar ? 'مكتب غير مرتبط' : 'Unassigned desk')}</span>
  </button>
}

export function SuperAgentOffice({ teamId, slots, enabled, archived, onOpen }: { teamId: string; slots: SuperAgentSlot[]; enabled: boolean; archived: boolean; onOpen: (slot: SuperAgentSlot) => void }) {
  const ar = useLocale() === 'ar'
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
  const positions = officePositions(slots)
  const sceneHeight = Math.max(650, size.height, Math.ceil((slots.length - 1) / 2) * 330 + 40)
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const old = previous.current
    const x = old && old.width * old.zoom / 100 > element.clientWidth ? (element.scrollLeft + element.clientWidth / 2) / (old.width * old.zoom / 100) : .5
    const y = old && old.height * old.zoom / 100 > element.clientHeight ? (element.scrollTop + element.clientHeight / 2) / (old.height * old.zoom / 100) : .5
    element.scrollLeft = Math.max(0, x * size.width * zoom / 100 - element.clientWidth / 2)
    element.scrollTop = Math.max(0, y * sceneHeight * zoom / 100 - element.clientHeight / 2)
    previous.current = { width: size.width, height: sceneHeight, zoom }
  }, [zoom, size.width, sceneHeight])
  const zoomButton = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs text-ink-soft hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-35 disabled:hover:bg-transparent'
  return <section aria-label={ar ? 'مكاتب الفريق' : 'Team office'} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div ref={viewport} dir="ltr" className="super-office thin-scroll min-h-0 flex-1 overflow-auto">
    <div style={{ width: size.width * zoom / 100, height: sceneHeight * zoom / 100 }} className="relative mx-auto overflow-hidden">
    <div dir="ltr" style={{ width: size.width, height: sceneHeight, transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }} className="absolute left-0 top-0">
      <svg viewBox={`0 0 1000 ${sceneHeight}`} preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-line-strong">{slots.filter(slot => slot.id !== 'manager').map(slot => {
        const position = positions.get(slot.id)!
        return <path key={slot.id} d={`M500 ${sceneHeight / 2 + 40} Q${position.left < 50 ? 350 : 650} ${sceneHeight / 2 + 40} ${position.left * 10} ${position.top / 100 * sceneHeight + 50}`} fill="none" stroke="currentColor" opacity=".35" strokeDasharray="4 6" />
      })}</svg>
      {slots.map(slot => <Station teamId={teamId} key={slot.id} slot={slot} enabled={enabled} archived={archived} position={positions.get(slot.id)!} onOpen={onOpen} />)}
      <p dir="auto" className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center text-[11px] text-ink-soft">{ar ? 'اضغط على أي مكتب لفتح المحادثة' : 'Choose a desk to open its conversation'}</p>
    </div>
    </div>
    </div>
    <div dir="ltr" role="group" aria-label={ar ? 'تكبير وتصغير المكاتب' : 'Office zoom'} className="absolute bottom-4 left-4 z-20 flex items-center gap-0.5 rounded-xl border border-line bg-card p-1 shadow-sm">
      <button type="button" className={zoomButton} disabled={zoom <= 40} onClick={() => changeZoom(-10)} aria-label={ar ? 'تصغير' : 'Zoom out'} title={ar ? 'تصغير' : 'Zoom out'}><Minus className="h-3.5 w-3.5" /></button>
      <button type="button" className={`${zoomButton} min-w-14 tabular-nums`} onClick={() => setZoom(100)} aria-label={ar ? 'إعادة التكبير إلى 100%' : 'Reset zoom to 100%'} title={ar ? 'الحجم الطبيعي' : 'Reset zoom'}><span aria-live="polite">{zoom}%</span></button>
      <button type="button" className={zoomButton} disabled={zoom >= 200} onClick={() => changeZoom(10)} aria-label={ar ? 'تكبير' : 'Zoom in'} title={ar ? 'تكبير' : 'Zoom in'}><Plus className="h-3.5 w-3.5" /></button>
    </div>
  </section>
}
