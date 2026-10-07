import { tr } from '../lib/i18n'
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
export function usePolling<T>(load: (() => Promise<T> | null) | null, intervalMs: number | ((data: T | null) => number), options: PollingOptions = {}): Request<T> {
  const { resetKey, pauseWhenHidden = true } = options
  const [state, setState] = useState<{ data: T | null; error: string | null; status: Request<T>['status'] }>({ data: null, error: null, status: 'idle' })

  // Always call the newest loader without making it an effect dependency: an
  // inline arrow would otherwise re-run the effect on every render.
  const loader = useRef(load)
  loader.current = load
  const cadence = useRef(intervalMs)
  cadence.current = intervalMs
  const generation = useRef(0)
  const resource = useRef({ enabled: load !== null, resetKey })
  const inFlight = useRef<{ generation: number; promise: Promise<T | null> } | null>(null)
  const lastResult = useRef<{ generation: number; signature: string | undefined; data: T } | null>(null)
  if (resource.current.enabled !== (load !== null) || resource.current.resetKey !== resetKey) {
    resource.current = { enabled: load !== null, resetKey }
    generation.current += 1
  }

  const refresh = useCallback((): Promise<T | null> => {
    const load = loader.current
    if (!load) {
      setState((previous) => previous.status === 'idle' && previous.data === null && previous.error === null
        ? previous : { data: null, error: null, status: 'idle' })
      return Promise.resolve(null)
    }
    const requestGeneration = generation.current
    if (inFlight.current?.generation === requestGeneration) return inFlight.current.promise
    setState((previous) => {
      const status = previous.data !== null ? 'ready' : 'loading'
      return previous.status === status && previous.error === null ? previous : { ...previous, status, error: null }
    })
    const promise = (async () => {
      try {
        const data = await load()
        if (data === null || generation.current !== requestGeneration) return null
        const signature = JSON.stringify(data)
        const previous = lastResult.current
        const stableData = previous?.generation === requestGeneration && previous.signature === signature ? previous.data : data
        lastResult.current = { generation: requestGeneration, signature, data: stableData }
        setState((previous) => previous.data === stableData && previous.error === null && previous.status === 'ready'
          ? previous : { data: stableData, error: null, status: 'ready' })
        return stableData
      } catch (error) {
        if (generation.current !== requestGeneration) return null
        const message = error instanceof Error ? error.message : tr("تعذر تحميل البيانات.")
        setState((previous) => previous.error === message ? previous
          : { ...previous, error: message, status: previous.data !== null ? 'ready' : 'error' })
        return null
      }
    })()
    inFlight.current = { generation: requestGeneration, promise }
    void promise.finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null
    })
    return promise
  }, [])

  const enabled = load !== null

  useEffect(() => {
    if (resetKey !== undefined) setState({ data: null, error: null, status: enabled ? 'loading' : 'idle' })
    if (!enabled) { void refresh(); return undefined }
    let timer = 0
    let stopped = false
    const start = () => {
      if (stopped || timer || (pauseWhenHidden && document.hidden)) return
      const interval = typeof cadence.current === 'function' ? cadence.current(lastResult.current?.data ?? null) : cadence.current
      if (interval > 0) timer = window.setTimeout(() => { timer = 0; void poll() }, interval)
    }
    const stop = () => { if (timer) { window.clearTimeout(timer); timer = 0 } }
    const poll = async () => { await refresh(); start() }
    if (!pauseWhenHidden || !document.hidden) void poll()

    if (pauseWhenHidden) {
      const onVisibility = () => {
        if (document.hidden) stop()
        else { void poll() }
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => { stopped = true; generation.current += 1; stop(); document.removeEventListener('visibilitychange', onVisibility) }
    }

    return () => { stopped = true; generation.current += 1; stop() }
  }, [enabled, pauseWhenHidden, refresh, resetKey])

  return { ...state, refresh }
}
