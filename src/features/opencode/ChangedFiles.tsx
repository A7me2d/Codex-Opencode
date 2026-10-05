import { FileCode2, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'
import { readDiffLines } from '../../lib/diff'
import { usePolling } from '../../hooks/usePolling'
import { cx } from '../../lib/cx'

const statuses: Record<string, string> = { added: 'جديد', modified: 'معدّل', deleted: 'محذوف', renamed: 'تغيّر اسمه' }

/** Read-only, scoped to one session. Expanding a file never opens an editor. */
export function ChangedFiles({ sessionId, active, source = 'opencode' }: { sessionId: string; active: boolean; source?: 'codex' | 'opencode' }) {
  const diff = usePolling(() => source === 'codex' ? api.codexDiff(sessionId) : api.sessionDiff(sessionId), active ? 2500 : 10000)
  const files = Array.isArray(diff.data) ? diff.data.filter((file) => typeof file.file === 'string') : []
  return <section aria-label="تغييرات ملفات الجلسة" className="border-b border-line py-3">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-bold text-ink"><FileCode2 className="h-3.5 w-3.5 text-ready" aria-hidden="true" />{source === 'codex' ? 'تغييرات Codex' : 'تغييرات الجلسة'} <span className="text-[10px] font-normal text-ink-soft">({files.length})</span></h3>
      {active ? <span className="text-[10px] text-ready-ink">تتحدّث أثناء العمل</span> : null}
    </div>
    {diff.error ? <p role="status" className="text-[11px] text-review-ink">تعذّر تحميل التغييرات: {diff.error}</p>
      : files.length === 0 ? <p className="text-[11px] leading-5 text-ink-soft">{diff.status === 'loading' ? 'جارٍ تحميل التغييرات…' : 'لا توجد تغييرات ملفات مسجلة لهذه الجلسة.'}</p>
      : <div className="space-y-1.5">{files.map((file) => {
        const lines = readDiffLines(typeof file.patch === 'string' ? file.patch : '')
        return <details key={file.file} className="group/diff overflow-hidden rounded-lg border border-line bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ready/40">
            <ChevronDown className="h-3 w-3 shrink-0 text-ink-soft transition-transform group-open/diff:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            <span className="min-w-0 flex-1"><code dir="ltr" className="ltr block truncate text-[11px] font-semibold text-ink" title={file.file}>{file.file}</code><span className="block text-[9px] text-ink-soft">{statuses[file.status] ?? file.status}</span></span>
            <span dir="ltr" className="flex shrink-0 gap-2 font-mono text-[10px]"><span className="text-ready-ink" aria-label={`${file.additions} سطر مضاف`}>+{file.additions}</span><span className="text-review-ink" aria-label={`${file.deletions} سطر محذوف`}>−{file.deletions}</span></span>
          </summary>
          <div className="border-t border-line">
            <p className="px-2.5 py-1.5 text-[9px] text-ink-soft">أرقام السطور: قبل التعديل / بعد التعديل</p>
            {lines.length ? <div dir="ltr" tabIndex={0} aria-label={`تعديلات ${file.file}`} className="thin-scroll max-h-64 overflow-auto bg-paper font-mono text-[10px] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ready/40">
              {lines.map((line, index) => <div key={index} className={cx('flex min-w-max', line.kind === 'added' && 'bg-ready-tint/70', line.kind === 'removed' && 'bg-review-tint/70', line.kind === 'hunk' && 'bg-relay-tint/60 text-relay-ink')}>
                <span className="w-9 shrink-0 select-none px-1 text-right text-ink-soft">{line.oldLine}</span><span className="w-9 shrink-0 select-none border-r border-line px-1 text-right text-ink-soft">{line.newLine}</span>
                <span className="w-5 shrink-0 text-center" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
                <code className="whitespace-pre pr-3">{line.text || ' '}</code>
              </div>)}
            </div> : <p className="px-2.5 pb-2 text-[11px] text-ink-soft">لا تتوفر تفاصيل نصية لهذا التغيير؛ قد يكون ملفًا غير نصي.</p>}
          </div>
        </details>
      })}</div>}
  </section>
}
