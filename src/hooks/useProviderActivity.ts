import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../lib/api'
import type { ProviderActivitySettings, ProviderId } from '../lib/types'

type Snapshot = ProviderActivitySettings & { ready: boolean; error: string | null }
let snapshot: Snapshot = { providers: { codex: false, opencode: false, cline: false }, ready: false, error: null }
const listeners = new Set<() => void>()
let pending: Promise<void> | null = null
function publish(next: Snapshot) { snapshot = next; for (const notify of listeners) notify() }
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } }
const read = () => snapshot
async function refresh() {
  if (pending) return pending
  pending = api.providerActivity().then(data => publish({ ...data, ready: true, error: null }))
    .catch(error => publish({ ...snapshot, error: error instanceof Error ? error.message : String(error) }))
    .finally(() => { pending = null })
  return pending
}
export function useProviderActivity() {
  const state = useSyncExternalStore(subscribe, read, read)
  useEffect(() => { if (!snapshot.ready) void refresh() }, [])
  return { ...state, refresh, set: async (id: ProviderId, enabled: boolean) => {
    const data = await api.setProviderActivity(id, enabled)
    publish({ ...data, ready: true, error: null })
  } }
}
