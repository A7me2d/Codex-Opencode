import { ChevronUp } from 'lucide-react'
import { useLocale } from '../../lib/i18n'

export function EarlierMessages({ count, onLoad }: { count: number; onLoad: () => void }) {
  const ar = useLocale() === 'ar'
  if (!count) return null
  return <div className="flex justify-center pb-4"><button type="button" onClick={onLoad} className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[11px] font-semibold text-ink-soft transition-colors hover:border-relay/40 hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40"><ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />{ar ? `عرض ${Math.min(5, count)} رسائل أقدم` : `Show ${Math.min(5, count)} earlier messages`}<span className="rounded-full bg-paper px-2 py-0.5 text-[10px] tabular-nums">{count}</span></button></div>
}
