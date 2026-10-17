import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { direction, useLocale } from '../../lib/i18n'
import { MochiPet } from './MochiPet'
import { MochiPanel } from './MochiPanel'
import { fetchMochiSnapshot, saveMochiConfig } from './api'
import type { MochiSnapshot } from './types'
import './mochi-launcher.css'

export function MochiLauncher({ teamId, visible, onOpenDesk }: { teamId: string; visible: boolean; onOpenDesk: (slotId: string) => void }) {
  const ar = useLocale() === 'ar'
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<MochiSnapshot | null>(null)
  const [error, setError] = useState('')
  const close = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
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
  function hide() { setOpen(false); previousFocus.current?.focus() }
  if (!visible) return null
  return <div ref={root} className="mochi-launcher" dir={direction()} data-office-avoid onKeyDown={event => { if (open && event.key === 'Escape') { event.stopPropagation(); hide() } }}>
    {open ? <aside className="mochi-launcher__drawer thin-scroll" role="complementary" aria-label={ar ? 'مساعد Mochi' : 'Mochi assistant'}>
      <button ref={close} type="button" className="mochi-launcher__close" onClick={hide} aria-label={ar ? 'إغلاق Mochi' : 'Close Mochi'}><X size={16} /></button>
      <MochiPanel key={teamId} teamId={teamId} visible={visible && open} onSnapshot={next => { setSnapshot(next); setError('') }} onOpenDesk={slotId => { onOpenDesk(slotId); hide() }} />
    </aside> : null}
    <MochiPet state={error ? 'blocked' : snapshot?.runtime.state || 'disabled'} notice={error || snapshot?.proposals.filter(item => item.status === 'pending').slice(-1)[0]?.reason} onOpen={() => {
      if (open) hide()
      else { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true) }
    }} onPause={snapshot?.config.enabled ? () => { void saveMochiConfig(teamId, { enabled: false }).then(setSnapshot).catch(failure => setError(failure instanceof Error ? failure.message : String(failure))) } : undefined} />
  </div>
}
