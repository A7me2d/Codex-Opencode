import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GripVertical, X } from 'lucide-react'
import { direction, useLocale } from '../../lib/i18n'
import { MochiPet } from './MochiPet'
import { MochiPanel } from './MochiPanel'
import { fetchMochiSnapshot, saveMochiConfig } from './api'
import type { MochiSnapshot } from './types'
import {
  clampMochiAnchor, defaultMochiAnchor, isValidMochiAnchor, mochiDragThreshold, mochiSaveDebounceMs,
  movedMochiAnchor, placeMochiDrawer, readMochiAnchor, resolveMochiAnchor, writeMochiAnchor,
  type MochiAnchor, type MochiBounds,
} from './mochi-position'
import './mochi-launcher.css'

const safeStorage = () => {
  try { return window.localStorage } catch { return null }
}

/**
 * Mochi floats over the Super Agent work area and can be dragged anywhere
 * inside it. Dragging uses pointer capture on the pet (plus a dedicated
 * keyboard-accessible grip): movement past a small threshold moves the pet,
 * a tap still opens the panel, and the pause button stays a plain button.
 * The spot is saved once per drag end — never per pointer event — and is
 * re-clamped on resize so the pet always stays reachable. The panel follows
 * the pet and flips to the roomier side, staying inside the visible area.
 */
export function MochiLauncher({ teamId, visible, onOpenDesk }: { teamId: string; visible: boolean; onOpenDesk: (slotId: string) => void }) {
  const ar = useLocale() === 'ar'
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<MochiSnapshot | null>(null)
  const [error, setError] = useState('')
  const [anchor, setAnchor] = useState<MochiAnchor>(() => readMochiAnchor(safeStorage()) ?? { x: NaN, y: NaN })
  const [drawerPos, setDrawerPos] = useState<{ left: number; top: number } | null>(null)
  const [boundsTick, setBoundsTick] = useState(0)
  const close = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<HTMLDivElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const boundsRef = useRef<MochiBounds>({ left: 0, top: 0, width: 0, height: 0 })
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const openRef = useRef(open)
  openRef.current = open
  const session = useRef<{ id: number; startX: number; startY: number; base: MochiAnchor; moved: boolean; fromTrigger: boolean; next?: MochiAnchor } | null>(null)
  const suppressClick = useRef(false)
  const saveTimer = useRef(0)
  const anchored = isValidMochiAnchor(anchor)
  useEffect(() => { setOpen(false); setSnapshot(null); setError('') }, [teamId])
  useEffect(() => {
    if (!visible || open) return
    const controller = new AbortController()
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try { const next = await fetchMochiSnapshot(teamId, controller.signal); if (!controller.signal.aborted) { setSnapshot(next); setError('') } }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
      finally { reading = false }
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [teamId, visible, open])
  useEffect(() => {
    if (open && visible) close.current?.focus()
  }, [open, visible])
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  const petSize = () => ({ width: drag.current?.offsetWidth || 0, height: drag.current?.offsetHeight || 0 })

  // The work area rect drives every clamp; resize/zoom re-clamps so the pet
  // never strands outside the reachable space.
  useLayoutEffect(() => {
    const container = root.current?.parentElement
    if (!container) return
    const sync = () => {
      const rect = container.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 40) return // work area hidden: keep the saved spot
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      const previous = boundsRef.current
      const size = petSize()
      if (!size.width) return
      const moved = Math.abs(previous.left - next.left) > .5 || Math.abs(previous.top - next.top) > .5 || Math.abs(previous.width - next.width) > .5 || Math.abs(previous.height - next.height) > .5
      boundsRef.current = next
      if (moved) setBoundsTick(tick => tick + 1)
      setAnchor(current => {
        const resolved = resolveMochiAnchor(current, next, size)
        return isValidMochiAnchor(current) && current.x === resolved.x && current.y === resolved.y ? current : resolved
      })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    window.addEventListener('resize', sync)
    return () => { observer.disconnect(); window.removeEventListener('resize', sync) }
  }, [])

  // The drawer is measured after mount, then placed with real geometry; no
  // placement flash because layout effects run before paint.
  useLayoutEffect(() => {
    if (!open) { setDrawerPos(null); return }
    const node = drawer.current
    if (!node || !isValidMochiAnchor(anchorRef.current) || !boundsRef.current.width) return
    const drawerSize = { width: node.offsetWidth, height: node.offsetHeight }
    const placement = placeMochiDrawer(anchorRef.current, petSize(), drawerSize, boundsRef.current)
    setDrawerPos(previous => previous && previous.left === placement.left && previous.top === placement.top ? previous : { left: placement.left, top: placement.top })
  }, [open, anchor, boundsTick])

  const togglePanel = useCallback(() => {
    if (openRef.current) { setOpen(false); previousFocus.current?.focus() }
    else {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOpen(true)
    }
  }, [])

  const scheduleSave = useCallback((next: MochiAnchor) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => writeMochiAnchor(safeStorage(), next), mochiSaveDebounceMs)
  }, [])

  const onDragKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const deltas: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = deltas[event.key]
    if (!delta || !isValidMochiAnchor(anchorRef.current) || !boundsRef.current.width) return
    event.preventDefault()
    const next = movedMochiAnchor(anchorRef.current, delta[0], delta[1], boundsRef.current, petSize(), event.shiftKey)
    if (next.x === anchorRef.current.x && next.y === anchorRef.current.y) return
    setAnchor(next)
    scheduleSave(next)
  }

  const resetAnchor = () => {
    if (!boundsRef.current.width) return
    const next = defaultMochiAnchor(boundsRef.current, petSize())
    setAnchor(next)
    writeMochiAnchor(safeStorage(), next)
  }

  const beginSession = (event: React.PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false
    if (session.current || !event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!isValidMochiAnchor(anchorRef.current)) return
    const target = event.target as HTMLElement | null
    if (target?.closest('.mochi-pause')) return // the pause button keeps its own plain click
    session.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, base: { x: anchorRef.current.x, y: anchorRef.current.y }, moved: false, fromTrigger: Boolean(target?.closest('.mochi-trigger')) }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = 'false'
  }

  const moveSession = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = session.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < mochiDragThreshold) return
    if (!current.moved) {
      current.moved = true
      event.currentTarget.dataset.dragging = 'true'
      if (root.current) root.current.dataset.dragging = 'true' // fade the drawer while the pet travels
    }
    const next = clampMochiAnchor({ x: current.base.x + dx, y: current.base.y + dy }, boundsRef.current, petSize())
    current.next = next
    event.currentTarget.style.transform = `translate(${Math.round(next.x - current.base.x)}px, ${Math.round(next.y - current.base.y)}px)`
  }

  const endSession = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = session.current
    if (!current || current.id !== event.pointerId) return
    session.current = null
    const node = event.currentTarget
    if (node.hasPointerCapture?.(event.pointerId)) node.releasePointerCapture(event.pointerId)
    node.dataset.dragging = 'false'
    if (root.current) root.current.dataset.dragging = 'false'
    if (current.moved) {
      suppressClick.current = true // a real drag never counts as the panel tap
      node.style.transform = ''
      const next = current.next ?? current.base
      setAnchor(next)
      writeMochiAnchor(safeStorage(), next) // save once, at drag end
    } else {
      // Pointer taps synthesize their own behavior, so the native click is
      // swallowed (a grip tap does nothing, a pet tap toggles). Keyboard
      // activation never passes through here, so Enter/Space keep working.
      suppressClick.current = true
      if (current.fromTrigger) togglePanel()
    }
  }

  const guardClick = (event: React.MouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function hide() { setOpen(false); previousFocus.current?.focus() }

  if (!visible) return null
  return <div ref={root} className="mochi-launcher" dir={direction()} data-anchored={anchored ? 'true' : 'false'} data-office-avoid
    onKeyDown={event => { if (open && event.key === 'Escape') { event.stopPropagation(); hide() } }}
    style={anchored ? { left: Math.round(anchor.x), top: Math.round(anchor.y) } : undefined}>
    {open ? <aside ref={drawer} className="mochi-launcher__drawer thin-scroll" role="complementary" aria-label={ar ? 'مساعد Mochi' : 'Mochi assistant'} data-placed={drawerPos ? 'true' : 'false'} style={drawerPos ? { left: Math.round(drawerPos.left), top: Math.round(drawerPos.top) } : undefined}>
      <button ref={close} type="button" className="mochi-launcher__close" onClick={hide} aria-label={ar ? 'إغلاق Mochi' : 'Close Mochi'}><X size={16} /></button>
      <MochiPanel key={teamId} teamId={teamId} visible={visible && open} onSnapshot={next => { setSnapshot(next); setError('') }} onOpenDesk={slotId => { onOpenDesk(slotId); hide() }} />
    </aside> : null}
    <div ref={drag} className="mochi-launcher__drag" onPointerDown={beginSession} onPointerMove={moveSession} onPointerUp={endSession} onPointerCancel={endSession} onClickCapture={guardClick}>
      <button type="button" className="mochi-launcher__grip"
        title={ar ? 'اسحب لتحريك Mochi، أو الأسهم للتحريك بلوحة المفاتيح (Shift لتسريع) وEnter لإرجاع الموضع الافتراضي' : 'Drag to move Mochi, or use arrow keys (Shift for bigger steps); Enter resets the default spot'}
        aria-label={ar ? 'تحريك Mochi' : 'Move Mochi'}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter"
        onKeyDown={onDragKeyDown}
        onClick={resetAnchor}>
        <GripVertical aria-hidden="true" />
      </button>
      <MochiPet state={error ? 'blocked' : snapshot?.runtime.state || 'disabled'} notice={error || snapshot?.proposals.filter(item => item.status === 'pending').slice(-1)[0]?.reason} onOpen={() => {
        if (open) hide()
        else { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true) }
      }} onPause={snapshot?.config.enabled ? () => { void saveMochiConfig(teamId, { enabled: false }).then(setSnapshot).catch(failure => setError(failure instanceof Error ? failure.message : String(failure))) } : undefined} />
    </div>
  </div>
}
