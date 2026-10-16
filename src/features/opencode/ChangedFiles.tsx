import { tr } from '../../lib/i18n'
import { Check, FileCode2, ChevronDown, LoaderCircle } from 'lucide-react'
import { memo, useId, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { readDiffLines } from '../../lib/diff'
import { usePolling } from '../../hooks/usePolling'
import { useProviderActivity } from '../../hooks/useProviderActivity'
import { cx } from '../../lib/cx'
import type { SessionFileDiff } from '../../lib/types'

function statusLabel(status: string) {
  const statuses: Record<string, string> = { added: tr("جديد"), modified: tr("معدّل"), deleted: tr("محذوف"), renamed: tr("تغيّر اسمه") }
  return statuses[status] ?? status
}

/** Scoped to one session; accepting Codex edits records a review decision. */
export function ChangedFiles({ sessionId, active, source = 'opencode', files: suppliedFiles }: { sessionId: string; active: boolean; source?: 'codex' | 'opencode'; files?: SessionFileDiff[] }) {
  const activity = useProviderActivity()
  const diff = usePolling(suppliedFiles || !activity.providers[source] ? null : () => source === 'codex' ? api.codexDiff(sessionId) : api.sessionDiff(sessionId), active ? 5000 : 60_000)
  const [visibleCount, setVisibleCount] = useState(source === 'codex' ? 6 : 30)
  const [expanded, setExpanded] = useState(source !== 'codex')
  const contentId = useId()
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set())
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const files = useMemo(() => {
    const current = suppliedFiles ?? (Array.isArray(diff.data) ? diff.data.filter((file) => typeof file.file === 'string') : [])
    return source === 'codex' ? current.filter(file => !file.changeIds?.length || !file.changeIds.every(id => accepted.has(id))) : current
  }, [suppliedFiles, diff.data, source, accepted])
  const changeIds = useMemo(() => [...new Set(files.flatMap(file => file.changeIds ?? []))], [files])
  async function acceptChanges() {
    if (accepting || active || !changeIds.length) return
    const snapshot = changeIds
    setAccepting(true); setAcceptError(null)
    try {
      const result = await api.acceptCodexChanges(sessionId, snapshot)
      setAccepted(previous => new Set([...previous, ...result.accepted]))
      void diff.refresh()
    } catch (failure) { setAcceptError(failure instanceof Error ? tr(failure.message) : tr('تعذّر قبول التعديلات.')) }
    finally { setAccepting(false) }
  }
  if (source === 'codex' && !files.length && !diff.error && !acceptError && diff.status !== 'loading') return null
  return <section aria-label={tr("تغييرات ملفات الجلسة")} className={cx('min-w-0', source === 'codex' ? 'rounded-xl border border-line bg-card p-2' : 'border-b border-line py-3')}>
    <div className={cx('flex flex-wrap items-center justify-between gap-2', expanded && 'mb-2')}>
      <h3 className="min-w-0 text-xs font-bold text-ink">{source === 'codex' ? <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1 text-start hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ready/40"><ChevronDown aria-hidden="true" className={cx('h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} /><FileCode2 className="h-3.5 w-3.5 shrink-0 text-ready" aria-hidden="true" />{tr("تغييرات Codex")}<span className="text-[10px] font-normal text-ink-soft">({files.length})</span></button> : <span className="flex items-center gap-1.5"><FileCode2 className="h-3.5 w-3.5 text-ready" aria-hidden="true" />{tr("تغييرات الجلسة")} <span className="text-[10px] font-normal text-ink-soft">({files.length})</span></span>}</h3>
      <div className="flex items-center gap-2">
        {active ? <span title={tr("تتحدّث أثناء العمل")} aria-label={tr("تتحدّث أثناء العمل")} className="h-1.5 w-1.5 shrink-0 rounded-full bg-ready" /> : null}
        {source === 'codex' && files.length > 0 ? <button type="button" onClick={() => void acceptChanges()} disabled={active || accepting || !changeIds.length} className="inline-flex items-center gap-1.5 rounded-lg bg-ready px-3 py-1.5 text-[11px] font-bold text-on-accent transition-colors hover:bg-ready-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ready/50 disabled:cursor-not-allowed disabled:opacity-45">
          {accepting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}{tr(accepting ? 'جارٍ قبول التعديلات…' : 'قبول التعديلات')}</button> : null}
      </div>
    </div>
    {acceptError ? <p role="alert" className="mb-2 text-[11px] leading-5 text-review-ink">{tr(acceptError)}</p> : null}
    {diff.error ? <p role="status" className="text-[11px] text-review-ink">{tr("تعذّر تحميل التغييرات:")}{' '}{diff.error}</p> : null}
    <div id={contentId} hidden={!expanded}>
    {diff.error ? null
      : files.length === 0 ? <p className="text-[11px] leading-5 text-ink-soft">{diff.status === 'loading' ? tr("جارٍ تحميل التغييرات…") : tr("لا توجد تغييرات ملفات مسجلة لهذه الجلسة.")}</p>
      : <div tabIndex={source === 'codex' ? 0 : undefined} aria-label={tr("تغييرات ملفات الجلسة")} onWheel={event => { if (source === 'codex') event.stopPropagation() }} className={cx('space-y-1.5', source === 'codex' && 'thin-scroll max-h-[min(14rem,28dvh)] overflow-y-auto overscroll-y-contain pe-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ready/40')}>
        {expanded ? <>
        {files.slice(0, visibleCount).map((file) => <FileChange key={file.file} file={file} />)}
        {files.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + (source === 'codex' ? 6 : 30))} className="w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ready-ink hover:bg-ready-tint">
          {tr("عرض المزيد (")}{files.length - visibleCount} {tr("ملف متبقٍ)")}</button> : null}
        </> : null}
      </div>}
    </div>
  </section>
}

const FileChange = memo(function FileChange({ file }: { file: SessionFileDiff }) {
  const [open, setOpen] = useState(false)
  const lines = useMemo(() => open ? readDiffLines(typeof file.patch === 'string' ? file.patch : '') : [], [open, file.patch])
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="group/diff overflow-hidden rounded-lg border border-line bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ready/40">
            <ChevronDown className="h-3 w-3 shrink-0 text-ink-soft transition-transform group-open/diff:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            <span className="min-w-0 flex-1"><code dir="ltr" className="ltr block truncate text-[11px] font-semibold text-ink" title={file.file}>{file.file}</code><span className="block text-[9px] text-ink-soft">{statusLabel(file.status)}</span></span>
            <span dir="ltr" className="flex shrink-0 gap-2 font-mono text-[10px]"><span className="text-ready-ink" aria-label={tr("{{0}} سطر مضاف", [file.additions])}>+{file.additions}</span><span className="text-review-ink" aria-label={tr("{{0}} سطر محذوف", [file.deletions])}>−{file.deletions}</span></span>
          </summary>
          {open ? <div className="border-t border-line">
            <p className="px-2.5 py-1.5 text-[9px] text-ink-soft">{tr("أرقام السطور: قبل التعديل / بعد التعديل")}</p>
            {lines.length ? <div dir="ltr" tabIndex={0} aria-label={tr("تعديلات {{0}}", [file.file])} className="thin-scroll max-h-64 overflow-auto bg-paper font-mono text-[10px] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ready/40">
              {lines.map((line, index) => <div key={index} className={cx('flex min-w-max', line.kind === 'added' && 'bg-ready-tint/70', line.kind === 'removed' && 'bg-review-tint/70', line.kind === 'hunk' && 'bg-relay-tint/60 text-relay-ink')}>
                <span className="w-9 shrink-0 select-none px-1 text-right text-ink-soft">{line.oldLine}</span><span className="w-9 shrink-0 select-none border-r border-line px-1 text-right text-ink-soft">{line.newLine}</span>
                <span className="w-5 shrink-0 text-center" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
                <code className="whitespace-pre pr-3">{line.text || ' '}</code>
              </div>)}
            </div> : <p className="px-2.5 pb-2 text-[11px] text-ink-soft">{tr("لا تتوفر تفاصيل نصية لهذا التغيير؛ قد يكون ملفًا غير نصي.")}</p>}
          </div> : null}
        </details>
})
