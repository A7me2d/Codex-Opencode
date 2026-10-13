import { useEffect, useRef } from 'react'

/** Save dirty tabs after a typing pause; serialize through the editor's busy state. */
export function useEditorAutoSave(tabs: { path: string; content: string; saved: string }[], root: string | undefined, enabled: boolean, busy: string, save: (path: string) => Promise<void>) {
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!enabled || !root || busy) return
    const dirty = tabs.find(tab => tab.content !== tab.saved)
    if (!dirty) return
    const timer = window.setTimeout(() => { void saveRef.current(dirty.path) }, 800)
    return () => window.clearTimeout(timer)
  }, [tabs, root, enabled, busy])
}
