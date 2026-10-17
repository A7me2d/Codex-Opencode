import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { direction, useLocale } from '../../lib/i18n'
import { cx } from '../../lib/cx'
import type { ModelInfo } from '../../lib/types'

const providerName = (id: string) => ({ nvidia: 'NVIDIA', opencode: 'OpenCode', 'opencode-go': 'OpenCode Go', openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' }[id] || id)

/** A viewport-bound menu, shared by Agent, desks, settings and Mochi. */
export function OpenCodeModelPicker({ id, models, value, onChange, disabled, label, placeholder, className, allowDefault = false }: {
  id: string; models: ModelInfo[]; value: string; onChange: (id: string) => void; disabled: boolean; label: string; placeholder: string; className?: string; allowDefault?: boolean
}) {
  const ar = useLocale() === 'ar'
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState('')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0, width: 420, height: 310 })
  const expanded = open && !disabled
  const target = trigger.current?.closest('dialog') ?? document.body
  const inDialog = target.tagName === 'DIALOG'
  const providers = [...new Set(models.map(model => model.providerID))]
  const activeProvider = providers.includes(provider) ? provider : ''
  const filtered = models.filter(model => (!activeProvider || model.providerID === activeProvider) && `${model.name} ${model.id} ${providerName(model.providerID)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selected = models.find(model => model.id === value)
  const close = () => { setOpen(false); setQuery(''); trigger.current?.focus() }
  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor) return
      const width = Math.max(0, Math.min(440, window.innerWidth - 24))
      const bounds = inDialog ? target.getBoundingClientRect() : { left: 0, top: 0, bottom: window.innerHeight }
      const below = Math.min(bounds.bottom, window.innerHeight) - anchor.bottom - 12
      const above = anchor.top - Math.max(0, bounds.top) - 12
      const upward = below < 260 && above > below
      const height = Math.max(0, Math.min(340, upward ? above : below))
      setPosition({ width, height, left: -bounds.left + Math.max(12, Math.min(ar ? anchor.right - width : anchor.left, window.innerWidth - width - 12)), top: -bounds.top + (upward ? anchor.top - height - 6 : anchor.bottom + 6) })
    }
    place()
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place() }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true) }
  }, [expanded, ar, target, inDialog])
  useEffect(() => {
    if (!expanded) return
    input.current?.focus({ preventScroll: true })
    const outside = (event: Event) => { const node = event.target as Node; if (!trigger.current?.contains(node) && !menu.current?.contains(node)) { setOpen(false); setQuery('') } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [expanded])
  const focusItem = (delta: number, edge?: 'first' | 'last') => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    items[edge === 'first' ? 0 : edge === 'last' ? items.length - 1 : (index + delta + items.length) % items.length]?.focus()
  }
  return <>
    <button id={id} ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined} disabled={disabled || (!allowDefault && !models.length)}
      onClick={() => { if (expanded) close(); else { setProvider(selected?.providerID || ''); setQuery(''); setOpen(true) } }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}
      className={cx('flex min-h-10 w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-start text-xs text-ink hover:border-relay/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-45', className)}>
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{selected?.name || value || placeholder}</span>{selected ? <span className="mt-0.5 block text-[10px] text-ink-soft">{providerName(selected.providerID)}</span> : null}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {expanded ? createPortal(<div ref={menu} id={menuId} dir={direction()} style={{ ...position, position: inDialog ? 'absolute' : 'fixed' }} className="settings-select-menu fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-line bg-card text-ink shadow-xl"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2"><Search size={14} className="text-ink-soft" aria-hidden="true" /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} aria-label={ar ? 'بحث في الموديلات الظاهرة' : 'Search visible models'} placeholder={ar ? 'ابحث بالاسم أو المزوّد…' : 'Search name or provider…'} className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none" onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(1, 'first') } if (event.key === 'Enter') event.preventDefault() }} /></div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={ar ? 'مزوّدو الموديلات' : 'Model providers'} className="thin-scroll w-[34%] shrink-0 overflow-y-auto border-e border-line bg-paper/60 p-1.5">
          {[{ id: '', name: ar ? 'كل المزوّدين' : 'All providers' }, ...providers.map(id => ({ id, name: providerName(id) }))].map(item => <button key={item.id} type="button" aria-pressed={item.id === activeProvider} onClick={() => setProvider(item.id)} className={cx('mb-0.5 flex min-h-9 w-full items-center gap-1 rounded-lg px-2 py-2 text-start text-[11px] outline-none hover:bg-relay-tint focus-visible:ring-2 focus-visible:ring-relay/40', item.id === activeProvider && 'bg-relay-tint font-semibold text-relay-ink')}><span className="min-w-0 flex-1 break-words">{item.name}</span><span className="text-[10px] text-ink-soft">{item.id ? models.filter(model => model.providerID === item.id).length : models.length}</span></button>)}
        </nav>
        <div role="menu" aria-label={label} className="thin-scroll min-w-0 flex-1 overflow-y-auto p-1.5" onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusItem(event.key === 'ArrowDown' ? 1 : -1) }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focusItem(0, event.key === 'Home' ? 'first' : 'last') }
        }}>
          {allowDefault && !query ? <button type="button" role="menuitemradio" aria-checked={!value} onClick={() => { onChange(''); close() }} className="flex min-h-10 w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-xs outline-none hover:bg-relay-tint focus:bg-relay-tint">{placeholder}{!value ? <Check size={14} aria-hidden="true" /> : null}</button> : null}
          {!filtered.length ? <p className="px-3 py-6 text-center text-xs text-ink-soft">{ar ? 'لا توجد موديلات مطابقة ضمن الظاهر في OpenCode.' : 'No matching visible OpenCode models.'}</p> : filtered.map(model => <button key={model.id} type="button" role="menuitemradio" aria-checked={model.id === value} onClick={() => { onChange(model.id); close() }} className={cx('flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start outline-none hover:bg-relay-tint focus:bg-relay-tint', model.id === value && 'bg-relay-tint text-relay-ink')}><span className="min-w-0 flex-1"><span className="block break-words text-xs font-semibold">{model.name}</span><span className="mt-0.5 block truncate text-[10px] text-ink-soft">{providerName(model.providerID)}</span></span>{model.id === value ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}</button>)}
        </div>
      </div>
    </div>, target) : null}
  </>
}
