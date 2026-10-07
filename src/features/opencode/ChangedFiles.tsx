import { tr } from '../../lib/i18n'
import { FileCode2, ChevronDown } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { readDiffLines } from '../../lib/diff'
import { usePolling } from '../../hooks/usePolling'
import { cx } from '../../lib/cx'
import type { SessionFileDiff } from '../../lib/types'

function statusLabel(status: string) {
  const statuses: Record<string, string> = { added: tr("جديد"), modified: tr("معدّل"), deleted: tr("محذوف"), renamed: tr("تغيّر اسمه") }
  return statuses[status] ?? status
}

/** Read-only, scoped to one session. Expanding a file never opens an editor. */
export function ChangedFiles({ sessionId, active, source = 'opencode', files: suppliedFiles }: { sessionId: string; active: boolean; source?: 'codex' | 'opencode'; files?: SessionFileDiff[] }) {
  const diff = usePolling(suppliedFiles ? null : () => source === 'codex' ? api.codexDiff(sessionId) : api.sessionDiff(sessionId), active ? 5000 : 60_000)
  const [visibleCount, setVisibleCount] = useState(30)
  const files = useMemo(() => suppliedFiles ?? (Array.isArray(diff.data) ? diff.data.filter((file) => typeof file.file === 'string') : []), [suppliedFiles, diff.data])
  return <section aria-label={tr("تغييرات ملفات الجلسة")} className="border-b border-line py-3">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-bold text-ink"><FileCode2 className="h-3.5 w-3.5 text-ready" aria-hidden="true" />{source === 'codex' ? tr("تغييرات Codex") : tr("تغييرات الجلسة")} <span className="text-[10px] font-normal text-ink-soft">({files.length})</span></h3>
      {active ? <span className="text-[10px] text-ready-ink">{tr("تتحدّث أثناء العمل")}</span> : null}
    </div>
    {diff.error ? <p role="status" className="text-[11px] text-review-ink">{tr("تعذّر تحميل التغييرات:")}{' '}{diff.error}</p>
      : files.length === 0 ? <p className="text-[11px] leading-5 text-ink-soft">{diff.status === 'loading' ? tr("جارٍ تحميل التغييرات…") : tr("لا توجد تغييرات ملفات مسجلة لهذه الجلسة.")}</p>
      : <div className="space-y-1.5">
        {files.slice(0, visibleCount).map((file) => <FileChange key={file.file} file={file} />)}
        {files.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + 30)} className="w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ready-ink hover:bg-ready-tint">
          {tr("عرض المزيد (")}{files.length - visibleCount} {tr("ملف متبقٍ)")}</button> : null}
      </div>}
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
