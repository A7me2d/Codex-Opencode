import { useId } from 'react'
import './brain-core.css'

/**
 * The manager desk renders as an information core, not a room: a lit sphere fed by its
 * docking dish. Dimensions, sphere center, and the four dock sockets the task lines
 * connect to (see officeConnector `docks.brain`) are fixed geometry.
 */
export function BrainCore({ active }: { active: boolean }) {
  const id = useId().replace(/:/g, '')
  return <svg viewBox="0 0 280 230" aria-hidden="true" className="super-office-room super-office-brain w-full overflow-visible" data-active={active}>
    <defs>
      <radialGradient id={`${id}-sphere`} cx="33%" cy="26%" r="78%">
        <stop offset="0" stopColor="var(--color-card)" />
        <stop offset=".42" stopColor="color-mix(in srgb, var(--color-relay-ink) 20%, var(--color-card))" />
        <stop offset="1" stopColor="color-mix(in srgb, var(--color-relay) 30%, var(--color-relay-tint))" />
      </radialGradient>
      <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".3" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${id}-dish`} cx="50%" cy="38%" r="62%">
        <stop offset="0" stopColor="var(--color-relay-tint)" />
        <stop offset="1" stopColor="var(--color-card)" />
      </radialGradient>
      <radialGradient id={`${id}-nucleus`} cx="50%" cy="40%" r="72%">
        <stop offset="0" stopColor="color-mix(in srgb, var(--color-relay) 42%, var(--color-card))" />
        <stop offset="1" stopColor="color-mix(in srgb, var(--color-relay) 55%, var(--color-relay-ink))" />
      </radialGradient>
      <radialGradient id={`${id}-halo`}>
        <stop stopColor="var(--color-relay)" stopOpacity=".22" />
        <stop offset="1" stopColor="var(--color-relay)" stopOpacity="0" />
      </radialGradient>
    </defs>
    {/* Grounding */}
    <ellipse cx="140" cy="192" rx="112" ry="25" fill="var(--color-overlay)" opacity=".12" />
    {/* Docking dish: dock sockets at [36 177] [244 177] [140 147] [140 207] are the link anchors. */}
    <path d="M36 177v11a104 30 0 0 0 208 0v-11" fill="var(--color-card)" stroke="var(--color-line-strong)" />
    <ellipse cx="140" cy="177" rx="104" ry="30" fill={`url(#${id}-dish)`} stroke="var(--color-relay)" strokeWidth="1.5" />
    <ellipse className="super-brain-dish" cx="140" cy="177" rx="87" ry="22" fill="var(--color-relay-tint)" stroke="var(--color-relay)" />
    <ellipse cx="140" cy="177" rx="65" ry="15" fill="none" stroke="var(--color-relay-ink)" opacity=".4" />
    {/* Feed stems: dashes flow from the dish up into the sphere while the core is working. */}
    <g stroke="var(--color-relay)" strokeLinecap="round" fill="none">
      <path className="super-brain-stream" d="M140 174V157" strokeWidth="2.5" />
      <path className="super-brain-stream" d="M126 172l-7-15" strokeWidth="2" />
      <path className="super-brain-stream" d="M154 172l7-15" strokeWidth="2" />
    </g>
    {[[36, 177], [244, 177], [140, 147], [140, 207]].map(([x, y]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
      <circle r="7" fill="var(--color-paper)" stroke="var(--color-relay-ink)" strokeWidth="1.5" />
      <circle r="2.5" fill="var(--color-relay-ink)" />
    </g>)}
    {/* Ambient light layers. The far orbit is drawn before the sphere so it reads behind it. */}
    <circle className="super-brain-halo" cx="140" cy="103" r="88" fill={`url(#${id}-halo)`} />
    <g transform="translate(140 103) rotate(33) scale(1 .2045)" fill="none" stroke="var(--color-relay-ink)">
      <circle r="88" opacity=".22" strokeWidth="1" strokeDasharray="2 9" />
      <g className="super-brain-orbit-spin super-brain-orbit-spin-b">
        <g transform="scale(1 4.89)"><circle cx="88" cy="0" r="2.5" fill="var(--color-relay)" stroke="none" /></g>
        <g transform="scale(1 4.89)"><circle cx="-88" cy="0" r="2.5" fill="var(--color-relay)" stroke="none" /></g>
      </g>
    </g>
    <circle cx="140" cy="103" r="51" fill={`url(#${id}-sphere)`} stroke="var(--color-relay-ink)" strokeWidth="1.25" />
    <g fill="none" stroke="var(--color-card)" strokeWidth=".8" opacity=".38">
      <ellipse cx="140" cy="103" rx="21" ry="51" />
      <ellipse cx="140" cy="103" rx="43" ry="51" transform="rotate(35 140 103)" />
      <ellipse cx="140" cy="103" rx="51" ry="18" />
      <path d="M96 78q44 20 88 0m-88 50q44-20 88 0" />
    </g>
    <ellipse cx="126" cy="86" rx="26" ry="17" fill={`url(#${id}-gloss)`} transform="rotate(-32 126 86)" />
    <path d="M182.4 127.5A49 49 0 0 1 115.5 145.4" fill="none" stroke="var(--color-relay)" strokeWidth="2.5" strokeLinecap="round" opacity=".38" />
    {/* Nucleus: the gathered state. Brightens while the core is active. */}
    <g className="super-brain-core">
      <circle cx="140" cy="103" r="10" fill={`url(#${id}-nucleus)`} />
      <circle className="super-brain-node" cx="140" cy="103" r="3" fill="var(--color-card)" />
    </g>
    {/* Near orbit crosses the sphere face; its pulses travel between the collection nodes. */}
    <g transform="translate(140 103) rotate(-24) scale(1 .275)" fill="none" stroke="var(--color-relay-ink)">
      <circle r="80" opacity=".3" strokeWidth="1" strokeDasharray="4 7" />
      <g className="super-brain-orbit-spin super-brain-orbit-spin-a">
        <g transform="scale(1 3.64)"><circle cx="80" cy="0" r="2.75" fill="var(--color-relay)" stroke="none" /></g>
        <g transform="scale(1 3.64)"><circle cx="-80" cy="0" r="2.75" fill="var(--color-relay)" stroke="none" /></g>
      </g>
    </g>
    {[[213, 70.5], [67, 135.5], [198, 94.2]].map(([cx, cy], index) => <g key={index}>
      <circle cx={cx} cy={cy} r="5.5" fill="var(--color-card)" stroke="var(--color-relay)" strokeWidth="1.25" />
      <circle className="super-brain-node" cx={cx} cy={cy} r="2.25" fill="var(--color-relay-ink)" style={{ animationDelay: `${index * 320}ms` }} />
    </g>)}
  </svg>
}
