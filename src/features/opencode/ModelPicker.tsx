import { useMemo, useState } from 'react'
import { Bot, ChevronDown, Search } from 'lucide-react'
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
 * shows exactly the providers configured on this machine — Big Pickle, the
 * free Zen models, and anything added in `opencode.json`. Models that cannot
 * run tools are hidden: an implementer that cannot touch files is not an
 * implementer.
 */
export function ModelPicker({ models, selected, onSelect, disabled = false }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const usable = useMemo(() => models.filter((model) => model.tools), [models])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return usable
    return usable.filter((model) =>
      model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle))
  }, [query, usable])

  const current = usable.find((model) => model.id === selected)

  return <div className="relative">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      disabled={disabled || usable.length === 0}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={current?.id}
      className="flex w-full items-center gap-2 rounded-lg border border-ready/25 bg-paper px-2.5 py-1.5 text-right transition-colors hover:border-ready/50 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <Bot className="h-3.5 w-3.5 shrink-0 text-ready" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] leading-4 text-ink-soft">موديل التنفيذ</span>
        <span className="block truncate text-[11px] font-bold leading-4 text-ink">{current?.name ?? selected}</span>
      </span>
      <ChevronDown className={cx('h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform', open && 'rotate-180')} aria-hidden="true" />
    </button>

    {open ? (
      <div className="absolute inset-x-0 bottom-full z-20 mb-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-[0_14px_40px_rgba(25,35,48,0.2)]">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث بالاسم أو المعرّف…"
            className="w-full bg-transparent text-[12px] leading-5 text-ink outline-none placeholder:text-ink-soft/70"
          />
        </div>

        <ul role="listbox" aria-label="موديلات OpenCode" className="thin-scroll max-h-56 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-[11px] leading-5 text-ink-soft">لا يوجد موديل مطابق.</li>
          ) : filtered.map((model) => {
            const active = model.id === selected
            return <li key={model.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onSelect(model.id); setOpen(false); setQuery('') }}
                className={cx('flex w-full items-start gap-2 px-3 py-2 text-right transition-colors', active ? 'bg-ready-tint' : 'hover:bg-paper')}
              >
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[12px] font-bold leading-5', active ? 'text-ready-ink' : 'text-ink')}>{model.name}</span>
                  <code dir="ltr" className="ltr mt-0.5 block truncate text-[9px] text-ink-soft">{model.id}</code>
                </span>
                {active ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ready" aria-label="المُحدَّد" /> : null}
              </button>
            </li>
          })}
        </ul>
      </div>
    ) : null}
  </div>
}
