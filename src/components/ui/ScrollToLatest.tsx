import { ArrowDown } from 'lucide-react'
import { cx } from '../../lib/cx'

/**
 * Floating jump-to-newest button. It is removed from the tab order and the
 * accessibility tree while hidden, so keyboard users never land on it.
 */
export function ScrollToLatest({ visible, onClick, tone = 'relay' }: {
  visible: boolean
  onClick: () => void
  tone?: 'relay' | 'ready'
}) {
  return <button
    type="button"
    onClick={onClick}
    tabIndex={visible ? 0 : -1}
    aria-hidden={visible ? undefined : true}
    className={cx(
      'absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[11px] font-bold shadow-[0_6px_18px_rgba(25,35,48,0.14)] transition-opacity duration-200',
      tone === 'ready' ? 'border-ready/35 text-ready-ink' : 'border-relay/35 text-relay-ink',
      visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
    )}
  >
    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
    آخر رسالة
  </button>
}
