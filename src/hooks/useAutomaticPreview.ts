import { useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { openProjectFile } from '../components/ProjectEditor'

/** User-visible automatic navigation, confined to clean project file previews. */
export function useAutomaticPreview(enabled: boolean, root: string | undefined, onError: (message: string) => void) {
  const errorRef = useRef(onError)
  errorRef.current = onError
  useEffect(() => {
    if (!enabled || !root) return
    let cancelled = false, timer = 0, previous = ''
    const navigate = (files: string[]) => {
      if (cancelled) return
      const choices = files.length > 1 ? files.filter(file => file !== previous) : files
      previous = choices[Math.floor(Math.random() * choices.length)]
      openProjectFile(root, previous, undefined, undefined, undefined, { automatic: true, scrollFraction: Math.random() })
      timer = window.setTimeout(() => navigate(files), 30_000)
    }
    void api.projectPreviewFiles(root).then(result => {
      if (cancelled) return
      if (!result.files.length) { errorRef.current('No suitable source files were found for automatic preview.'); return }
      navigate(result.files)
    }).catch(error => { if (!cancelled) errorRef.current(error instanceof Error ? error.message : String(error)) })
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [enabled, root])
}
