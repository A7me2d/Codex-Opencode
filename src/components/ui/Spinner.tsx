import { LoaderCircle } from 'lucide-react'
import { cx } from '../../lib/cx'

/** The single loading affordance, so every wait looks the same. */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin', className)} aria-hidden="true" />
}

/** Centred loading state for a pane that has no content yet. */
export function LoadingState({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft">
    <Spinner />
    {label}
  </div>
}
