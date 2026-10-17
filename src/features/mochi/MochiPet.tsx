import { CircleAlert, CircleHelp, CircleSlash, LoaderCircle, Pause, Sparkles } from 'lucide-react'
import { direction, useLocale } from '../../lib/i18n'
import { cx } from '../../lib/cx'
import './mochi-pet.css'

/**
 * Visual state of Mochi, mirroring the negotiated runtime snapshot:
 * disabled | idle | working | waiting_user | blocked.
 */
export type MochiPetState = 'disabled' | 'idle' | 'working' | 'waiting_user' | 'blocked'

export interface MochiPetProps {
  state: MochiPetState
  /** One short honest line (latest proposal/hint). No statuses are invented here. */
  notice?: string | null
  /** Non-intrusive: clicking the pet opens the settings/suggestions panel. */
  onOpen: () => void
  /** Pause affordance rendered only when the caller passes it. */
  onPause?: () => void
  className?: string
}

const chipLabels: Record<MochiPetState, [string, string]> = {
  disabled: ['Mochi متوقف', 'Mochi is off'],
  idle: ['Mochi جاهز', 'Mochi idle'],
  working: ['Mochi يعمل', 'Mochi is working'],
  waiting_user: ['بانتظار قرارك', 'Waiting for you'],
  blocked: ['متعثّر، راجع اللوحة', 'Stuck, review the panel'],
}

const chipIcons = {
  disabled: CircleSlash,
  idle: Sparkles,
  working: LoaderCircle,
  waiting_user: CircleHelp,
  blocked: CircleAlert,
}

const columnLimit = 'min-w-0 flex-1 max-w-[11rem]'

/** The mascot itself: a small rounded creature drawn from theme tokens, no assets. */
function MochiFace({ state }: { state: MochiPetState }) {
  const sleeping = state === 'disabled'
  const blocked = state === 'blocked'
  const eyeRadius = state === 'waiting_user' ? 3.9 : blocked ? 2.5 : 3.1
  return <svg viewBox="0 0 64 56" aria-hidden="true" className="mochi-figure mochi-face">
    <ellipse cx="20" cy="14" rx="6.4" ry="8.4" transform="rotate(-14 20 14)" className="mochi-ear" />
    <ellipse cx="20" cy="14" rx="2.9" ry="4.2" transform="rotate(-14 20 14)" className="mochi-ear-in" />
    <ellipse cx="44" cy="14" rx="6.4" ry="8.4" transform="rotate(14 44 14)" className="mochi-ear" />
    <ellipse cx="44" cy="14" rx="2.9" ry="4.2" transform="rotate(14 44 14)" className="mochi-ear-in" />
    <path className="mochi-body" d="M32 7c13.4 0 23.8 10.6 23.8 24.6 0 11.2-9.4 18.2-23.8 18.2S8.2 42.8 8.2 31.6C8.2 17.6 18.6 7 32 7Z" />
    {!sleeping ? <>
      <ellipse cx="17.5" cy="37.5" rx="3.6" ry="2.1" className="mochi-cheek" />
      <ellipse cx="46.5" cy="37.5" rx="3.6" ry="2.1" className="mochi-cheek" />
    </> : null}
    {sleeping
      ? <path d="M21.5 31h6.6M35.9 31h6.6" className="mochi-line" />
      : blocked
        ? <>
          <path d="M20.6 28.2q3.3-2.4 6.8-1.4M36.6 26.8q3.5-1 6.8 1.4" className="mochi-line" />
          <circle cx="25" cy="32.5" r={eyeRadius} className="mochi-eye" />
          <circle cx="39" cy="32.5" r={eyeRadius} className="mochi-eye" />
        </>
        : <>
          <circle cx="25" cy="30.5" r={eyeRadius} className="mochi-eye" />
          <circle cx="39" cy="30.5" r={eyeRadius} className="mochi-eye" />
          {state === 'waiting_user' ? <>
            <circle cx="26.4" cy="29.3" r="1.1" className="mochi-glint" />
            <circle cx="40.4" cy="29.3" r="1.1" className="mochi-glint" />
            <path d="M20.6 23.6q3.4-2.7 7-.8M43.4 23.6q-3.4-2.7-7-.8" className="mochi-line" />
          </> : null}
        </>}
    {state === 'working' ? <circle cx="32" cy="40" r="2.3" className="mochi-mouth" /> : null}
    {sleeping ? <path d="M29.5 39.5q2.5 1.8 5 0" className="mochi-line" /> : null}
    {state === 'idle' ? <path d="M28.4 38.6q3.6 3.1 7.2 0" className="mochi-line" /> : null}
    {state === 'waiting_user' ? <path d="M28.6 39.2q3.4 2.9 6.8 0" className="mochi-line" /> : null}
    {blocked ? <path d="M28.8 42.4q3.2-2.5 6.4 0" className="mochi-line" /> : null}
  </svg>
}

/** Pure visual: no polling, no network, no inference — the runtime drives props only. */
export function MochiPet({ state, notice, onOpen, onPause, className }: MochiPetProps) {
  const ar = useLocale() === 'ar'
  const chip = chipLabels[state][ar ? 0 : 1]
  const Chip = chipIcons[state]
  const openLabel = ar ? `Mochi، ${chip}. انقر لفتح لوحة اقتراحات Mochi` : `Mochi: ${chip}. Open the Mochi suggestions panel`
  const pauseLabel = ar ? 'إيقاف مؤقت' : 'Pause'
  return <div dir={direction()} data-state={state} className={cx('mochi', className)}>
    <button type="button" onClick={onOpen} aria-label={openLabel} title={chip} className="mochi-trigger">
      <MochiFace state={state} />
      <span className={cx('mochi-copy', columnLimit)}>
        <span className="mochi-chip" aria-hidden="true"><Chip className={cx('mochi-chip-icon', state === 'working' && 'mochi-spin')} /><span dir="auto" className="mochi-chip-text">{chip}</span></span>
        {notice ? <span dir="auto" aria-live="polite" className={cx('mochi-notice', columnLimit)}>{notice}</span> : null}
      </span>
    </button>
    {onPause ? <button type="button" onClick={onPause} aria-label={pauseLabel} title={pauseLabel} className="mochi-pause"><Pause className="h-3.5 w-3.5" /></button> : null}
  </div>
}
