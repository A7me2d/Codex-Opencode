import { useEffect, useState, type CSSProperties } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useLocale } from '../lib/i18n'

export function WindowControls({ dark = false }: { dark?: boolean }) {
  const ar = useLocale() === 'ar'
  const [maximized, setMaximized] = useState(false)
  const controls = window.codingRoomWindow
  useEffect(() => {
    if (!controls?.getState) return
    let mounted = true
    void controls.getState().then(state => { if (mounted) setMaximized(state.maximized) }).catch(() => undefined)
    const cleanup = controls.onState?.(state => setMaximized(state.maximized))
    return () => { mounted = false; cleanup?.() }
  }, [controls])
  if (!controls?.minimize) return null
  const label = maximized ? (ar ? 'استعادة حجم النافذة' : 'Restore window') : (ar ? 'تكبير النافذة' : 'Maximize window')
  const standard = `inline-flex h-8 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/50 ${dark ? 'text-[#a9b9d8] hover:bg-[#182238] hover:text-[#eef3ff]' : 'text-ink-soft hover:bg-paper hover:text-ink'}`
  return <div dir="ltr" aria-label={ar ? 'التحكم في النافذة' : 'Window controls'} className="flex shrink-0 items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
    <button type="button" title={ar ? 'تصغير' : 'Minimize'} aria-label={ar ? 'تصغير' : 'Minimize'} onClick={() => void controls.minimize?.()} className={standard}><Minus className="h-3.5 w-3.5" aria-hidden="true" /></button>
    <button type="button" title={label} aria-label={label} onClick={() => void controls.toggleMaximize?.()} className={standard}>{maximized ? <Copy className="h-3 w-3" aria-hidden="true" /> : <Square className="h-3 w-3" aria-hidden="true" />}</button>
    <button type="button" title={ar ? 'إغلاق' : 'Close'} aria-label={ar ? 'إغلاق' : 'Close'} onClick={() => void controls.close?.()} className={`inline-flex h-8 w-10 items-center justify-center rounded-lg transition-colors hover:bg-[#c94359] hover:text-[#fff1f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ee8495] ${dark ? 'text-[#a9b9d8]' : 'text-ink-soft'}`}><X className="h-4 w-4" aria-hidden="true" /></button>
  </div>
}

export function StandaloneTitleBar({ dark = false }: { dark?: boolean }) {
  if (!window.codingRoomWindow?.minimize) return null
  return <header dir="ltr" onDoubleClick={() => void window.codingRoomWindow?.toggleMaximize?.()} style={{ WebkitAppRegion: 'drag' } as CSSProperties} className={`fixed inset-x-0 top-0 z-[110] flex h-12 select-none items-center justify-between px-3 ${dark ? 'bg-[#06080f] text-[#a9b9d8]' : 'border-b border-line bg-card text-ink-soft'}`}>
    <div className="flex items-center gap-2"><img src="/app-icon.png" className="h-6 w-6 object-contain" alt="" /><span className="text-[11px] font-semibold tracking-wide">Open Zero</span></div>
    <WindowControls dark={dark} />
  </header>
}
