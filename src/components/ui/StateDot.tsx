import { cx } from '../../lib/cx'

/** State dot: teal when something is running, amber when it needs attention. */
export function StateDot({ active, warning = false }: { active: boolean; warning?: boolean }) {
  return <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', active ? 'bg-ready' : warning ? 'bg-review' : 'bg-line-strong')} />
}
