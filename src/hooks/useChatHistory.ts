import { useCallback, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { config } from '../app/config'

const batchSize = 5
/** Mount a small message window and reveal history without moving the reader. */
export function useChatHistory<T extends { id: string }>(messages: T[], resetKey = '') {
  const ref = useRef<HTMLDivElement>(null)
  const [boundary, setBoundary] = useState<{ key: string; id: string | null }>({ key: resetKey, id: null })
  const [following, setFollowing] = useState(true)
  const [atLatest, setAtLatest] = useState(true)
  const followingRef = useRef(true)
  const pending = useRef<{ height: number; top: number } | null>(null)
  const previousTop = useRef(0)
  const id = boundary.key === resetKey ? boundary.id : null
  const found = id ? messages.findIndex(message => message.id === id) : -1
  const start = found >= 0 ? found : Math.max(0, messages.length - batchSize)
  const visibleMessages = useMemo(() => messages.slice(start), [messages, start])
  const measureLatest = useCallback(() => {
    const element = ref.current
    if (element) setAtLatest(element.scrollHeight - element.scrollTop - element.clientHeight <= Math.max(2, config.stickyScrollThresholdPx))
  }, [])

  useLayoutEffect(() => {
    pending.current = null
    setBoundary({ key: resetKey, id: null })
    setFollowing(true)
    followingRef.current = true
    const element = ref.current
    if (element) { element.style.overflowAnchor = 'none'; element.scrollTop = element.scrollHeight; previousTop.current = element.scrollTop }
    measureLatest()
  }, [resetKey])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.overflowAnchor = 'none'
    if (pending.current) {
      element.scrollTop = pending.current.top + element.scrollHeight - pending.current.height
      pending.current = null
    } else if (following) element.scrollTop = element.scrollHeight
    previousTop.current = element.scrollTop
    measureLatest()
  }, [visibleMessages, following])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    const followGrowth = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (pending.current) return
        if (followingRef.current) {
          element.scrollTop = element.scrollHeight
          previousTop.current = element.scrollTop
        }
        measureLatest()
      })
    }
    const resize = new ResizeObserver(followGrowth)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(element)
      Array.from(element.children).forEach(child => resize.observe(child))
    }
    const mutations = new MutationObserver(() => { observeChildren(); followGrowth() })
    observeChildren()
    mutations.observe(element, { childList: true, subtree: true, characterData: true })
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect() }
  }, [resetKey])

  const loadOlder = useCallback(() => {
    const element = ref.current
    if (!element || start === 0 || pending.current) return
    pending.current = { height: element.scrollHeight, top: element.scrollTop }
    followingRef.current = false
    setFollowing(false)
    setBoundary({ key: resetKey, id: messages[Math.max(0, start - batchSize)].id })
  }, [messages, resetKey, start])

  const handleScroll = useCallback(() => {
    const element = ref.current
    if (!element || pending.current) return
    const movingUp = element.scrollTop < previousTop.current - 1
    measureLatest()
    previousTop.current = element.scrollTop
    if (movingUp && element.scrollTop <= 72 && start > 0) { loadOlder(); return }
    if (movingUp && id === null && messages[start]) setBoundary({ key: resetKey, id: messages[start].id })
    const next = !movingUp && (followingRef.current || element.scrollHeight - element.scrollTop - element.clientHeight <= config.stickyScrollThresholdPx)
    followingRef.current = next
    setFollowing(next)
  }, [id, loadOlder, messages, resetKey, start])

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      measureLatest()
      followingRef.current = false
      setFollowing(false)
      if ((ref.current?.scrollTop ?? Infinity) <= 72) loadOlder()
    }
  }, [loadOlder])

  const scrollToLatest = useCallback((smooth = false) => {
    pending.current = null
    setBoundary({ key: resetKey, id: null })
    setFollowing(true)
    followingRef.current = true
    requestAnimationFrame(() => {
      const element = ref.current
      if (element) {
        element.scrollTo({ top: element.scrollHeight, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' })
        previousTop.current = element.scrollTop
        measureLatest()
      }
    })
  }, [resetKey])

  return { ref, following, atLatest, visibleMessages, hiddenCount: start, loadOlder, handleScroll, handleWheel, scrollToLatest }
}
