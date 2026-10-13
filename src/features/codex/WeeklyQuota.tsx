import { Gauge } from 'lucide-react'
import { api } from '../../lib/api'
import { tr } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'

export function WeeklyQuota() {
  const usage = usePolling(api.codexWeeklyQuota, 60_000)
  const remaining = usage.data?.available ? usage.data.remainingPercent : null
  const label = remaining === null ? tr('رصيد Codex الأسبوعي غير متاح') : tr('المتبقي من رصيد Codex الأسبوعي: {{0}}%', [remaining])
  return <span role="status" aria-label={label} title={label} className="ms-auto inline-flex h-8 shrink-0 items-center gap-1.5 px-2 text-[11px] font-semibold text-ink-soft">
    <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
    <span dir="ltr" className="tabular-nums">{remaining === null ? '—' : `${remaining}%`}</span>
  </span>
}
