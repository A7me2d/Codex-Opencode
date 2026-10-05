import { useEffect, useId, useRef, useState } from 'react'
import { Bot, Brain, Check, ChevronDown, Shield } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CodexSelection } from '../../hooks/useConversation'
import { cx } from '../../lib/cx'

const effortLabels: Record<string, string> = {
  none: 'بدون تفكير', minimal: 'أقل تفكير', low: 'منخفض', medium: 'متوسط',
  high: 'مرتفع', xhigh: 'مرتفع جدًا', max: 'أقصى', ultra: 'فائق',
}

interface Option { value: string; label: string; detail?: string }

function Picker({ label, icon: Icon, value, options, disabled, onChange }: {
  label: string; icon: LucideIcon; value: string; options: Option[]
  disabled: boolean; onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const expanded = open && !disabled
  const current = options.find((option) => option.value === value)

  useEffect(() => {
    if (!expanded) return
    items.current[Math.max(0, options.findIndex((option) => option.value === value))]?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [expanded, value, options])

  return <div ref={root} className="relative min-w-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
  }}>
    <button ref={trigger} type="button" disabled={disabled || !options.length}
      aria-label={`${label}: ${current?.label ?? 'غير متاح'}`} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      onClick={() => setOpen(!expanded)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
      }}
      className={cx('inline-flex max-w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-not-allowed disabled:opacity-50', expanded ? 'bg-relay-tint text-relay-ink' : 'bg-paper text-ink')}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-relay" aria-hidden="true" />
      <span className="min-w-0 truncate font-semibold">{current?.label ?? 'غير متاح'}</span>
      <ChevronDown className={cx('h-3 w-3 shrink-0 text-ink-soft transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
    </button>
    {expanded ? <div id={id} role="menu" aria-label={label}
      className="absolute bottom-full right-0 z-40 mb-2 w-64 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-line bg-card shadow-lg">
      <div className="border-b border-line px-3 py-2.5 text-[11px] font-bold text-ink-soft">{label}</div>
      <div className="thin-scroll max-h-52 overflow-y-auto p-1.5">
        {options.map((option, index) => <button key={option.value} ref={(node) => { items.current[index] = node }}
          type="button" role="menuitemradio" aria-checked={option.value === value} tabIndex={-1}
          onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}
          onKeyDown={(event) => {
            let next = index
            if (event.key === 'ArrowDown') next = (index + 1) % options.length
            else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = options.length - 1
            else return
            event.preventDefault(); items.current[next]?.focus()
          }}
          className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start outline-none transition-colors hover:bg-paper focus:bg-relay-tint', option.value === value && 'bg-relay-tint/70')}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">{option.label}</span>
            {option.detail ? <span dir="ltr" className="mt-0.5 block truncate text-start text-[10px] text-ink-soft" title={option.detail}>{option.detail}</span> : null}
          </span>
          {option.value === value ? <Check className="h-3.5 w-3.5 shrink-0 text-relay" aria-hidden="true" /> : null}
        </button>)}
      </div>
    </div> : null}
  </div>
}

export function CodexSettingsPicker({ selection, disabled }: { selection: CodexSelection; disabled: boolean }) {
  const model = selection.models.find((entry) => entry.model === selection.current.model)
  return <div className="mb-3 flex flex-wrap items-center gap-1.5">
    <Picker label="موديل Codex" icon={Bot} value={selection.current.model}
      options={selection.models.map((entry) => ({ value: entry.model, label: entry.displayName || entry.model, detail: entry.model }))}
      disabled={disabled || selection.loading} onChange={selection.onModelChange} />
    <span className="h-4 w-px bg-line" aria-hidden="true" />
    <Picker label="مستوى التفكير" icon={Brain} value={selection.current.effort}
      options={(model?.supportedReasoningEfforts ?? []).map((entry) => ({ value: entry.reasoningEffort, label: effortLabels[entry.reasoningEffort] ?? entry.reasoningEffort, detail: entry.reasoningEffort }))}
      disabled={disabled || selection.loading} onChange={selection.onEffortChange} />
    {selection.loading ? <span role="status" className="text-[10px] text-ink-soft">تحميل الخيارات…</span> : null}
    <Picker label="صلاحيات Codex" icon={Shield} value={selection.permissions}
      options={[
        { value: 'read-only', label: 'قراءة فقط', detail: 'عرض الملفات بدون تعديل' },
        { value: 'workspace-write', label: 'تعديل المشروع', detail: 'القراءة والكتابة داخل مجلد المشروع' },
        { value: 'danger-full-access', label: 'وصول كامل', detail: 'القراءة والكتابة خارج مجلد المشروع أيضًا' },
      ]}
      disabled={disabled || selection.loading || selection.changingPermissions} onChange={selection.onPermissionsChange} />
    {selection.permissionsPending ? <span className="text-[10px] text-ink-soft">تُطبّق الصلاحيات مع الرسالة التالية</span> : null}
  </div>
}
