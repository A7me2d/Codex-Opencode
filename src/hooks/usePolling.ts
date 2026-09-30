import { useCallback, useEffect, useRef, useState } from 'react'
import type { Request } from '../lib/types'

export interface PollingOptions {
  /**
   * Change this to drop the previous result immediately. Used when the polled
   * resource is scoped to the selected conversation, so the old transcript
   * never lingers behind the new one.
   */
  resetKey?: string
  /** Poll in a hidden tab too. Off by default: nobody reads a background tab. */
  pauseWhenHidden?: boolean
}

/**
 * Polls one resource and keeps its data, error, and status in one object.
 *
 * Pass `null` instead of a loader to park the request: it clears itself and
 * stops polling, which is how per-conversation endpoints switch off when no
 * session is selected.
 */
export function usePolling<T>(load: (() => Promise<T> | null) | null, intervalMs: number, options: PollingOptions = {}): Request<T> {
  const { resetKey, pauseWhenHidden = true } = options
  const [state, setState] = useState<{ data: T | null; error: string | null; status: Request<T>['status'] }>({ data: null, error: null, status: 'idle' })

  // Always call the newest loader without making it an effect dependency: an
  // inline arrow would otherwise re-run the effect on every render.
  const loader = useRef(load)
  loader.current = load

  const refresh = useCallback(async () => {
    const load = loader.current
    if (!load) {
      setState({ data: null, error: null, status: 'idle' })
      return null
    }
    setState((previous) => ({ ...previous, status: previous.data ? 'ready' : 'loading', error: null }))
    try {
      const data = await load()
      if (data === null) return null
      setState({ data, error: null, status: 'ready' })
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تحميل البيانات.'
      setState((previous) => ({ ...previous, error: message, status: previous.data ? 'ready' : 'error' }))
      return null
    }
  }, [])

  const enabled = load !== null

  useEffect(() => {
    if (resetKey !== undefined) setState({ data: null, error: null, status: enabled ? 'loading' : 'idle' })
    if (!enabled) return undefined
    void refresh()

    let timer = 0
    const start = () => { if (!timer) timer = window.setInterval(() => void refresh(), intervalMs) }
    const stop = () => { if (timer) { window.clearInterval(timer); timer = 0 } }

    if (pauseWhenHidden) {
      const onVisibility = () => {
        if (document.hidden) stop()
        else { start(); void refresh() }
      }
      start()
      document.addEventListener('visibilitychange', onVisibility)
      return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
    }

    start()
    return stop
  }, [enabled, intervalMs, pauseWhenHidden, refresh, resetKey])

  return { ...state, refresh }
}
