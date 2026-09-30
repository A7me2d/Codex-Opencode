import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export type Tone = 'quiet' | 'codex' | 'openCode' | 'warning'

const tones: Record<Tone, string> = {
  quiet: 'border-line bg-paper text-ink-soft',
  codex: 'border-relay/20 bg-relay-tint text-relay-ink',
  openCode: 'border-ready/20 bg-ready-tint text-ready-ink',
  warning: 'border-review/20 bg-review-tint text-review-ink',
}

/** Small labelled capsule used for every status word in the app. */
export function StatusPill({ children, tone = 'quiet' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', tones[tone])}>{children}</span>
}
