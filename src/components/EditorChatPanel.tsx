import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ArrowUpRight, GripVertical, Maximize2, MessageSquare, Minus, MoveDiagonal2, Pin, PinOff } from 'lucide-react'
import { direction, useLocale } from '../lib/i18n'
import { constrainChatBox, defaultChatBox, readEditorChatLayout, type ChatBox } from '../lib/editor-chat-layout'
import { persistPreference, preferenceKeys } from '../lib/preferences'

/** One mounted conversation, styled inline, floating or docked without changing its React parent. */
export function EditorChatPanel({ editing, pinned, onPin, onReturn, children }: {
  editing: boolean; pinned: boolean; onPin: () => void; onReturn: () => void; children: ReactNode
}) {
  const ar = useLocale() === 'ar'
  const [box, setBox] = useState(() => readEditorChatLayout().box)
  const [minimized, setMinimized] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; id: number; x: number; y: number; box: ChatBox } | null>(null)
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const resized = () => setBox(current => constrainChatBox(current, viewport()))
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [])
  useEffect(() => {
    drag.current = null
    if (!editing || pinned) setMinimized(false)
  }, [editing, pinned])
  useEffect(() => {
    let frame = 0
    const focus = () => {
      setMinimized(false)
      frame = requestAnimationFrame(() => content.current?.querySelector('textarea')?.focus())
    }
    window.addEventListener('coding-room:focus-editor-chat', focus)
    return () => { window.removeEventListener('coding-room:focus-editor-chat', focus); cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => persistPreference(preferenceKeys.editorChatLayout, JSON.stringify({ pinned, box })), 300)
    return () => window.clearTimeout(timer)
  }, [pinned, box])
  function start(event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') {
    if (!editing || pinned || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { mode, id: event.pointerId, x: event.clientX, y: event.clientY, box }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    const next = current.mode === 'move' ? { ...current.box, x: current.box.x + dx, y: current.box.y + dy } : { ...current.box, width: current.box.width + dx, height: current.box.height + dy }
    setBox(constrainChatBox(next, viewport()))
  }
  function keyboard(event: KeyboardEvent<HTMLElement>, mode: 'move' | 'resize') {
    if (pinned) return
    if (event.key === 'Home') { event.preventDefault(); setBox(defaultChatBox(viewport())); return }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = directions[event.key]
    if (!delta) return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 12
    setBox(current => constrainChatBox(mode === 'move' ? { ...current, x: current.x + delta[0] * step, y: current.y + delta[1] * step } : { ...current, width: current.width + delta[0] * step, height: current.height + delta[1] * step }, viewport()))
  }
  const floating = editing && !pinned
  const style: CSSProperties | undefined = floating ? { width: box.width, height: minimized ? 44 : box.height, transform: `translate(${box.x}px, ${box.y}px)`, WebkitAppRegion: 'no-drag' } as CSSProperties : undefined
  const button = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40'
  return <section dir={direction()} aria-label={ar ? 'محادثة أثناء تعديل الملفات' : 'Editor conversation'} style={style}
    className={`editor-chat-panel flex min-h-0 min-w-0 flex-col ${editing ? pinned ? 'editor-chat-docked order-2 shrink-0 border-l border-line bg-card' : 'editor-chat-floating fixed left-0 top-0 z-30 overflow-hidden rounded-2xl border border-line-strong bg-card shadow-2xl shadow-black/25' : 'flex-1'}`}>
    <header dir="ltr" className={editing ? 'flex h-11 shrink-0 items-center gap-1 border-b border-line bg-card px-2' : 'hidden'}>
      <div tabIndex={floating ? 0 : undefined} role="group" aria-label={ar ? 'تحريك الشات. الأسهم للتحريك، Home لإعادة الموضع.' : 'Move chat. Arrow keys move; Home resets the position.'}
        onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={event => keyboard(event, 'move')} className={`flex min-w-0 flex-1 select-none items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-relay/40 ${floating ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}>
        {floating ? <GripVertical className="h-3.5 w-3.5 text-ink-soft" /> : <MessageSquare className="h-3.5 w-3.5 text-relay-ink" />}
        <span className="truncate">{ar ? 'المحادثة' : 'Conversation'}</span>
      </div>
      <button type="button" aria-pressed={pinned} title={ar ? pinned ? 'تحويل إلى نافذة عائمة' : 'تثبيت بجانب المحرر' : pinned ? 'Float conversation' : 'Pin beside editor'} aria-label={ar ? pinned ? 'تحويل إلى نافذة عائمة' : 'تثبيت بجانب المحرر' : pinned ? 'Float conversation' : 'Pin beside editor'} onClick={onPin} className={`${button} ${pinned ? 'bg-relay-tint text-relay-ink' : ''}`}>{pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
      {floating && <button type="button" title={ar ? minimized ? 'توسيع المحادثة' : 'تصغير المحادثة' : minimized ? 'Expand conversation' : 'Minimize conversation'} aria-label={ar ? minimized ? 'توسيع المحادثة' : 'تصغير المحادثة' : minimized ? 'Expand conversation' : 'Minimize conversation'} onClick={() => setMinimized(value => !value)} className={button}>{minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}</button>}
      <button type="button" title={ar ? 'عرض الشات بالكامل' : 'Show full conversation'} aria-label={ar ? 'عرض الشات بالكامل' : 'Show full conversation'} onClick={onReturn} className={button}><ArrowUpRight className="h-3.5 w-3.5" /></button>
    </header>
    <div ref={content} className={floating && minimized ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>{children}</div>
    {floating && !minimized && <button type="button" aria-label={ar ? 'تغيير حجم الشات. استخدم الأسهم.' : 'Resize chat. Use arrow keys.'} title={ar ? 'اسحب لتغيير الحجم' : 'Drag to resize'}
      onPointerDown={event => start(event, 'resize')} onPointerMove={move} onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} onKeyDown={event => keyboard(event, 'resize')}
      className="absolute bottom-0 right-0 z-30 flex h-5 w-5 touch-none cursor-nwse-resize items-center justify-center rounded-tl-md text-ink-soft hover:bg-paper focus-visible:ring-2 focus-visible:ring-relay/40"><MoveDiagonal2 className="h-3 w-3" /></button>}
  </section>
}
