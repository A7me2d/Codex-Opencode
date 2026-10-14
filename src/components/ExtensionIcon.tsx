import { useState } from 'react'
import { Puzzle } from 'lucide-react'
import { config } from '../app/config'

export default function ExtensionIcon({ source, large = false }: { source?: string | null; large?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const size = large ? 'h-20 w-20 md:h-24 md:w-24' : 'h-11 w-11'
  const url = source?.startsWith('/api/extensions/icon?') ? `${config.apiBase}${source}` : source
  return <span className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-xl`} aria-hidden="true">
    {url && failedSource !== url ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(url)} className="h-full w-full object-contain" />
      : <Puzzle className={`${large ? 'h-12 w-12' : 'h-7 w-7'} text-ink-soft/60`} />}
  </span>
}
