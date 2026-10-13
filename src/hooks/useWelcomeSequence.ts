import { useEffect, useState } from 'react'

/** Preserve the original minimum/check duration, then add ten seconds including the fade. */
export function useWelcomeSequence(checking: boolean) {
  const [minimumReady, setMinimumReady] = useState(false)
  const [phase, setPhase] = useState<'waiting' | 'leaving' | 'done'>('waiting')
  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumReady(true), 1000)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (checking || !minimumReady) return
    const fade = window.setTimeout(() => setPhase('leaving'), 9400)
    const finish = window.setTimeout(() => setPhase('done'), 10000)
    return () => { window.clearTimeout(fade); window.clearTimeout(finish) }
  }, [checking, minimumReady])
  return phase
}
