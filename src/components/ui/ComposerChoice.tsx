import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, type LucideIcon } from 'lucide-react'
import { cx } from '../../lib/cx'

/** Compact, themed model/mode menu anchored above the message composer. */
export function ComposerChoice({ label, icon: Icon, value, fallback, options, disabled, searchable = false, onChange, ar }: {
  label: string; icon: LucideIcon; value: string; fallback?: string; options: { value: string; label: string }[]
  disabled: boolean; searchable?: boolean; onChange: (value: string) => void; ar: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null), items = useRef<(HTMLButtonElement | null)[]>([])
  const expanded = open && !disabled
  const current = options.find(option => option.value === value)?.label || fallback || value
  const filtered = useMemo(() => options.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query])
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!expanded) return
    if (searchable) searchInput.current?.focus()
    else {
      const selected = items.current[Math.max(0, options.findIndex(option => option.value === value))]
      selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest' })
    }
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [expanded, searchable, value])
  return <div ref={root} className="min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close() } }}>
    <button ref={trigger} type="button" disabled={disabled || !options.length} aria-label={`${label}: ${current}`} title={`${label}: ${current}`} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      onClick={() => { setQuery(''); setOpen(!expanded) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setQuery(''); setOpen(true) } }}
      className={cx('inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-50', expanded && 'bg-relay-tint text-relay-ink')}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span dir="auto" className="max-w-44 truncate">{current}</span><ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
    {expanded ? <div id={id} role="menu" aria-label={label} className="settings-select-menu absolute bottom-full start-0 z-40 mb-3 w-full max-w-80 overflow-hidden rounded-xl border border-line bg-card text-ink shadow-lg">
      <div className="border-b border-line px-3 py-2.5 text-[11px] font-semibold text-ink-soft">{label}</div>
      {searchable ? <div className="flex items-center gap-2 border-b border-line px-3 py-2"><Search className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" /><input ref={searchInput} aria-label={ar ? 'بحث عن موديل' : 'Search models'} placeholder={ar ? 'بحث…' : 'Search…'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items.current[event.key === 'ArrowDown' ? 0 : filtered.length - 1]?.focus() } if (event.key === 'Enter') event.preventDefault() }} className="min-w-0 flex-1 border-0 bg-transparent py-1 text-xs outline-none" /></div> : null}
      <div className="thin-scroll max-h-52 overflow-y-auto p-1.5">
        {filtered.map((option, index) => <button key={option.value} ref={node => { items.current[index] = node }} type="button" role="menuitemradio" aria-checked={option.value === value} tabIndex={-1}
          onClick={() => { onChange(option.value); close() }} onKeyDown={event => {
            let next = index
            if (event.key === 'ArrowDown') next = (index + 1) % filtered.length
            else if (event.key === 'ArrowUp') { if (index === 0 && searchable) { event.preventDefault(); searchInput.current?.focus(); return } next = (index - 1 + filtered.length) % filtered.length }
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = filtered.length - 1
            else return
            event.preventDefault(); items.current[next]?.focus()
          }} className={cx('flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start text-xs outline-none hover:bg-paper focus:bg-relay-tint', option.value === value && 'bg-relay-tint/60 text-relay-ink')}>
          <span dir="auto" className="min-w-0 flex-1 break-words">{option.label}</span>{option.value === value ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        </button>)}
        {!filtered.length ? <p className="px-3 py-4 text-xs text-ink-soft">{ar ? 'لا توجد نتائج' : 'No results'}</p> : null}
      </div>
    </div> : null}
  </div>
}
