import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../../lib/cx'

export interface SettingsOption { value: string; label: string }

/** Themed choice menu outside scrolling panels, in the dialog top layer when needed. */
export function SettingsSelect({ id, label, value, options, disabled = false, className, onChange }: {
  id?: string; label: string; value: string; options: SettingsOption[]; disabled?: boolean; className?: string; onChange: (value: string) => void
}) {
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const search = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, height: 240 })
  const expanded = open && !disabled
  const target = trigger.current?.closest('dialog') ?? document.body
  const inDialog = target.tagName === 'DIALOG'
  const menuDirection = trigger.current?.closest('[dir]')?.getAttribute('dir') || undefined
  const current = options.find(option => option.value === value)
  const close = () => { setOpen(false); trigger.current?.focus() }

  useLayoutEffect(() => {
    if (!expanded || !target || !trigger.current) return
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect()
      const bounds = inDialog ? target.getBoundingClientRect() : { left: 0, top: 0, bottom: window.innerHeight, width: window.innerWidth }
      const below = Math.min(bounds.bottom, window.innerHeight) - anchor.bottom - 12
      const above = anchor.top - Math.max(bounds.top, 0) - 12
      const upward = below < 160 && above > below
      const height = Math.min(options.length * 40 + 12, 260, Math.max(72, upward ? above : below))
      const width = Math.min(anchor.width, bounds.width - 24)
      setPosition({ width, height,
        left: Math.max(12, Math.min(anchor.left - bounds.left, bounds.width - width - 12)),
        top: upward ? anchor.top - bounds.top - height - 6 : anchor.bottom - bounds.top + 6,
      })
    }
    place()
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place() }
    window.addEventListener('resize', place)
    target.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); target.removeEventListener('scroll', scroll, true) }
  }, [expanded, target, inDialog, options.length])

  useEffect(() => {
    if (!expanded) return
    search.current = { text: '', at: 0 }
    const index = Math.max(0, options.findIndex(option => option.value === value))
    items.current[index]?.focus({ preventScroll: true })
    items.current[index]?.scrollIntoView({ block: 'nearest' })
    const outside = (event: Event) => {
      const node = event.target as Node
      if (!trigger.current?.contains(node) && !menu.current?.contains(node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    const dismiss = () => setOpen(false)
    target?.addEventListener('close', dismiss)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); target?.removeEventListener('close', dismiss) }
  }, [expanded, value, target])

  return <>
    <button id={id} ref={trigger} type="button" disabled={disabled || !options.length} aria-label={label} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined}
      onClick={() => setOpen(previous => !previous)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
        if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close() }
      }} className={cx('mt-2 flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-start text-xs font-semibold text-ink transition-colors hover:border-relay/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-not-allowed disabled:opacity-45', expanded && 'border-relay/50 ring-2 ring-relay/10', className)}>
      <span dir="auto" className="min-w-0 truncate">{current?.label ?? value}</span><ChevronDown className={cx('h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
    </button>
    {expanded && target ? createPortal(<div id={menuId} ref={menu} role="menu" aria-label={label} dir={menuDirection}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.height }}
      className={cx('settings-select-menu thin-scroll z-50 overflow-y-auto rounded-xl border border-line bg-card p-1.5 text-ink shadow-[0_12px_32px_rgba(20,28,40,0.2)]', inDialog ? 'absolute' : 'fixed')}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      {options.map((option, index) => <button key={option.value} ref={node => { items.current[index] = node }} type="button" role="menuitemradio" aria-checked={option.value === value} tabIndex={-1}
        onClick={() => { onChange(option.value); close() }} onKeyDown={event => {
          let next = index
          if (event.key === 'ArrowDown') next = (index + 1) % options.length
          else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = options.length - 1
          else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
            const text = (Date.now() - search.current.at < 700 ? search.current.text : '') + event.key.toLocaleLowerCase()
            search.current = { text, at: Date.now() }
            const found = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(text))
            if (found >= 0) next = found
          } else return
          event.preventDefault(); items.current[next]?.focus()
        }} className={cx('flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start text-xs font-medium outline-none transition-colors hover:bg-relay-tint focus:bg-relay-tint', option.value === value ? 'bg-relay-tint/60 text-relay-ink' : 'text-ink')}>
        <span dir="auto" className="min-w-0 flex-1 break-words">{option.label}</span>{option.value === value ? <Check className="h-3.5 w-3.5 shrink-0 text-relay-ink" aria-hidden="true" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
      </button>)}
    </div>, target) : null}
  </>
}
