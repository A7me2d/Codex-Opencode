import { useEffect, useRef, useState } from 'react'

/**
 * Copies text to the clipboard and reports the result for a couple of seconds.
 *
 * A panel is mounted and unmounted on every conversation switch, so the timer
 * has to be cleaned up with it.
 */
export function CopyButton({ value, label = 'نسخ' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setCopied(false)
    }
  }

  return <button
    type="button"
    onClick={() => void copy()}
    className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-bold text-ink-soft transition-colors hover:border-relay/35 hover:text-relay-ink"
  >
    {copied ? 'اتنسخ' : label}
  </button>
}
