import { lazy, Suspense, useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { direction, useLocale } from '../lib/i18n'
import { ErrorBoundary } from './ui/ErrorBoundary'

const ExtensionsPanel = lazy(() => import('./ExtensionsPanel'))

/** Switching workspace modes preserves the embedded editor and its runtime. */
export function ExtensionsWorkspace({ root, open }: { root?: string; open: boolean }) {
  const ar = useLocale() === 'ar'
  const [opened, setOpened] = useState(false)
  useEffect(() => { if (open) setOpened(true) }, [open])
  return <section id="workspace-ide" role="tabpanel" aria-labelledby="workspace-mode-ide" dir={direction()}
    className={open ? 'flex min-h-[28rem] w-full flex-1 flex-col overflow-hidden bg-card lg:min-h-0' : 'hidden'}>
    {opened ? <ErrorBoundary label={ar ? 'تعذّر عرض مساحة الإضافات.' : 'Could not display the extensions workspace.'}>
      <Suspense fallback={<div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />{ar ? 'جارٍ تحميل الإضافات…' : 'Loading extensions…'}</div>}>
        <ExtensionsPanel root={root} visible={open} />
      </Suspense>
    </ErrorBoundary> : null}
  </section>
}
