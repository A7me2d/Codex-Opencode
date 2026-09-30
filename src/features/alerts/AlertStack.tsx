import { Bot, CircleDot, MessageCircleQuestion, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import type { AgentAlert, AlertTone } from '../../hooks/useAgentAlerts'

const tones: Record<AlertTone, { card: string; icon: ReactNode }> = {
  codex: { card: 'border-relay/30 bg-card text-relay-ink', icon: <CircleDot className="h-4 w-4 shrink-0 text-relay" aria-hidden="true" /> },
  openCode: { card: 'border-ready/30 bg-card text-ready-ink', icon: <Bot className="h-4 w-4 shrink-0 text-ready" aria-hidden="true" /> },
  question: { card: 'border-review/40 bg-review-tint text-review-ink', icon: <MessageCircleQuestion className="h-4 w-4 shrink-0 text-review" aria-hidden="true" /> },
}

/**
 * The "something happened while you were typing" stack.
 *
 * Fixed above the panes so it is visible no matter which column has focus.
 * Questions stay until answered; everything else fades on its own.
 */
export function AlertStack({ alerts, onDismiss }: { alerts: AgentAlert[]; onDismiss: (id: string) => void }) {
  if (alerts.length === 0) return null

  return <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
    {alerts.map((alert) => {
      const tone = tones[alert.tone]
      return <div key={alert.id} className={cx('pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-[0_10px_30px_rgba(25,35,48,0.16)]', tone.card)}>
        {tone.icon}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-6">{alert.title}</p>
          {alert.detail ? <p className="mt-0.5 truncate text-[11px] text-ink-soft" title={alert.detail}>{alert.detail}</p> : null}
        </div>
        <button type="button" onClick={() => onDismiss(alert.id)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-paper hover:text-ink" aria-label="إخفاء التنبيه">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    })}
  </div>
}
