import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../app/config'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Pins a chat pane to its newest message while the reader is at the bottom,
 * and leaves them alone the moment they scroll up to read history.
 *
 * `following` also drives the "آخر رسالة" jump button, so the reader always
 * knows something newer is waiting below them.
 *
 * @param content   changes whenever new content arrives (re-pins if following)
 * @param resetKey  changes when the reader switches conversation (re-pins always)
 */
export function useStickyScroll(content: unknown, resetKey?: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  const scrollToLatest = useCallback((smooth = false) => {
    const element = ref.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
  }, [])

  const handleScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    setFollowing(distanceFromBottom <= config.stickyScrollThresholdPx)
  }, [])

  useEffect(() => {
    if (following) scrollToLatest()
  }, [content, following, scrollToLatest])

  useEffect(() => {
    setFollowing(true)
  }, [resetKey])

  return { ref, following, handleScroll, scrollToLatest }
}
