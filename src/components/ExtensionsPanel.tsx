import { useState } from 'react'
import { Puzzle, RefreshCw } from 'lucide-react'
import { useLocale } from '../lib/i18n'
import { usePolling } from '../hooks/usePolling'
import { api } from '../lib/api'
import ExtensionCatalog from './ExtensionCatalog'

export default function ExtensionsPanel({ root, visible }: { root?: string; visible: boolean }) {
  const ar = useLocale() === 'ar'
  const [revision, setRevision] = useState(0)
  const status = usePolling(visible ? api.extensionsStatus : null, 5_000, { resetKey: root })
  function changed() {
    setRevision(previous => previous + 1)
    window.dispatchEvent(new Event('openzero:extensions-changed'))
    void status.refresh()
  }
  return <section className="flex min-h-0 flex-1 flex-col bg-card" aria-label="Extensions">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
      <div className="flex min-w-0 items-center gap-3"><Puzzle className="h-5 w-5 shrink-0 text-relay-ink" /><div><h2 className="text-sm font-semibold">{ar ? 'الإضافات' : 'Extensions'}</h2><p className="mt-1 text-[10px] text-ink-soft">{ar ? 'إضافات محرر Agent' : 'Extensions for the Agent editor'}</p></div></div>
      <button className="rounded-lg p-2 text-ink-soft hover:bg-relay-tint focus-visible:ring-2 focus-visible:ring-relay/40" title={ar ? 'تحديث القائمة' : 'Refresh extensions'} aria-label={ar ? 'تحديث القائمة' : 'Refresh extensions'} onClick={changed}><RefreshCw className="h-4 w-4" /></button>
    </header>
    <ExtensionCatalog ar={ar} ready locked={Boolean(status.data?.installing)} visible={visible} revision={revision} onChanged={changed} />
  </section>
}
