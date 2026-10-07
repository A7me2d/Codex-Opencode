import { tr } from '../../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, Search, X } from 'lucide-react'
import { cx } from '../../lib/cx'
import type { ModelInfo } from '../../lib/types'

export interface ModelPickerProps {
  models: ModelInfo[]
  /** The selected model id, e.g. `opencode/big-pickle`. */
  selected: string
  onSelect: (id: string) => void
  /** Disabled while a run is active, because the model cannot change mid-turn. */
  disabled?: boolean
}

/**
 * Picks which OpenCode model a handoff runs on.
 *
 * The list comes from the local OpenCode install (`GET /api/models`), so it
 * shows exactly the providers configured on this machine. Models that cannot
 * run tools are hidden: an implementer that cannot touch files is not an
 * implementer.
 *
 * The panel drops *below* its trigger. It used to open upward, which pushed the
 * search field and most of the list off the top edge of the rail, where they
 * could neither be seen nor clicked.
 */
export function ModelPicker({ models, selected, onSelect, disabled = false }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const usable = useMemo(() => models.filter((model) => model.tools), [models])

  // Match on the provider too, because the id is often the only place the
  // maker appears (`openrouter/...`) and that is how people think about them.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return usable
    return usable.filter((model) =>
      model.name.toLowerCase().includes(needle) ||
      model.id.toLowerCase().includes(needle) ||
      model.providerID.toLowerCase().includes(needle))
  }, [query, usable])

  const current = usable.find((model) => model.id === selected)
  const searching = query.trim().length > 0

  // A panel that only closes by picking something traps the reader, so Escape
  // and a click anywhere outside both dismiss it.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function choose(id: string) {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  return <div ref={box} className="relative">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      disabled={disabled || usable.length === 0}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={current?.id ?? selected}
      className="flex w-full items-center gap-2 rounded-lg border border-ready/25 bg-paper px-2.5 py-1.5 text-start transition-colors hover:border-ready/50 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <Bot className="h-3.5 w-3.5 shrink-0 text-ready" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] leading-4 text-ink-soft">{tr("موديل التنفيذ")}</span>
        <span className="block truncate text-[11px] font-bold leading-4 text-ink">{current?.name ?? selected ?? tr("اختر موديلًا")}</span>
      </span>
      <ChevronDown className={cx('h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform', open && 'rotate-180')} aria-hidden="true" />
    </button>

    {open ? (
      <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-[0_14px_40px_rgba(25,35,48,0.2)]">
        {/* The search sits inside the panel, right under the trigger, so it is
            the first thing at hand with 400+ models to sift through. */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
          <input
            ref={field}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("ابحث بالاسم أو المعرّف أو المزوّد…")}
            aria-label={tr("ابحث في موديلات OpenCode")}
            className="w-full bg-transparent text-[12px] leading-5 text-ink outline-none placeholder:text-ink-soft/70"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => { setQuery(''); field.current?.focus() }}
              aria-label={tr("امسح البحث")}
              className="shrink-0 rounded p-0.5 text-ink-soft transition-colors hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <ul role="listbox" aria-label={tr("موديلات OpenCode")} className="thin-scroll max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-[11px] leading-5 text-ink-soft">{tr("لا يوجد موديل مطابق.")}</li>
          ) : filtered.map((model) => {
            const active = model.id === selected
            return <li key={model.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(model.id)}
                className={cx('flex w-full items-start gap-2 px-3 py-2 text-start transition-colors', active ? 'bg-ready-tint' : 'hover:bg-paper')}
              >
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[12px] font-bold leading-5', active ? 'text-ready-ink' : 'text-ink')}>{model.name}</span>
                  <code dir="ltr" className="ltr mt-0.5 block truncate text-[9px] text-ink-soft">{model.id}</code>
                </span>
                {active ? <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-ready" aria-label={tr("المُحدَّد")} /> : null}
              </button>
            </li>
          })}
        </ul>

        {/* One quiet line so an empty-looking list is explained rather than
            guessed at, and the count is visible while narrowing down. */}
        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[10px] leading-4 text-ink-soft">
          <span>{searching ? tr("{{0}} من {{1}}", [filtered.length, usable.length]) : tr("{{0}} موديلًا قابلاً للتنفيذ", [usable.length])}</span>
          <span>{tr("Esc للإغلاق")}</span>
        </div>
      </div>
    ) : null}
  </div>
}
