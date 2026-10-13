import { Clock3, Gauge } from 'lucide-react'
import { api } from '../../lib/api'
import { tr } from '../../lib/i18n'
import { usePolling } from '../../hooks/usePolling'

export function WeeklyQuota() {
  const usage = usePolling(api.codexWeeklyQuota, 60_000)
  const remaining = usage.data?.available ? usage.data.remainingPercent : null
  const fiveHour = usage.data?.fiveHour
  const fiveHourLabel = tr('المتبقي من رصيد Codex لكل 5 ساعات: {{0}}%', [fiveHour?.remainingPercent ?? 0])
  const label = remaining === null ? tr('رصيد Codex الأسبوعي غير متاح') : tr('المتبقي من رصيد Codex الأسبوعي: {{0}}%', [remaining])
  return <div className="ms-auto inline-flex h-8 shrink-0 items-center gap-2 px-2 text-[11px] font-semibold text-ink-soft">
    <span role="status" aria-label={label} title={label} className="inline-flex items-center gap-1.5">
    <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
    <span dir="ltr" className="tabular-nums">{remaining === null ? '—' : `${remaining}%`}</span>
    </span>
    {fiveHour?.available && fiveHour.remainingPercent !== null ? <span role="status" aria-label={fiveHourLabel} title={fiveHourLabel} className="inline-flex items-center gap-1 border-s border-line ps-2">
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{tr('5 س')}</span>
      <span dir="ltr" className="tabular-nums">{fiveHour.remainingPercent}%</span>
    </span> : null}
  </div>
}
