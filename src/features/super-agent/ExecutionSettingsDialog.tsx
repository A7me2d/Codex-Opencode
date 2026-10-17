import { useEffect, useId, useRef, useState } from 'react'
import { Check, RefreshCw, X } from 'lucide-react'
import { api } from '../../lib/api'
import { direction, useLocale } from '../../lib/i18n'
import { SettingsSelect } from '../../components/ui/SettingsSelect'
import type { SuperAgentTeam, SuperExecutionSettings } from '../../lib/types'

const button = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:bg-relay-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-40'

/**
 * Execution dispatch settings for one Super Agent team.
 *
 * Touches only `execution` (`maxParallel` 1..8 and `dispatchMode`); title,
 * archive state and role/model setup are never part of the request, so an
 * error here cannot alter the current role configuration.
 */
export function ExecutionSettingsDialog({ team, onChange, onClose }: { team: SuperAgentTeam; onChange: (team: SuperAgentTeam) => void; onClose: () => void }) {
  const ar = useLocale() === 'ar'
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState<SuperExecutionSettings>(team.execution ?? { maxParallel: 2, dispatchMode: 'wait' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  async function save() {
    if (busy) return
    setBusy(true); setError(''); setNote('')
    try {
      // The response is the source of truth: the server may not persist or
      // even recognize `execution` yet, and claiming success then would lie.
      const next = await api.updateSuperTeam(team.id, { execution: values })
      onChange(next)
      if (next.execution && next.execution.maxParallel === values.maxParallel && next.execution.dispatchMode === values.dispatchMode) setNote(ar ? 'تم الحفظ.' : 'Saved.')
      else setNote(ar ? 'بانتظار دعم الخادم — لم يتغير السلوك بعد، وتظهر الإعدادات الافتراضية حتى تفرغ العقد.' : 'Waiting for server support — behavior is unchanged and defaults keep showing until the contract lands.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} dir={direction()} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(94vw,540px)] max-w-none overflow-y-auto rounded-2xl border border-line bg-card p-5 text-ink shadow-xl backdrop:bg-overlay/40">
    <header className="mb-4 flex items-center justify-between gap-3"><h2 id={titleId} className="text-sm font-semibold">{ar ? 'توزيع تنفيذ المهام' : 'Task execution dispatch'}</h2><button type="button" onClick={() => ref.current?.close()} aria-label={ar ? 'إغلاق' : 'Close'} className="rounded-lg p-2 hover:bg-paper"><X className="h-4 w-4" /></button></header>
    <div className="space-y-4">
      <SettingsSelect label={ar ? 'المكاتب المتزامنة' : 'Simultaneous desks'} value={String(values.maxParallel)} disabled={busy} onChange={value => setValues(current => ({ ...current, maxParallel: Number(value) }))}
        options={[1, 2, 3, 4, 5, 6, 7, 8].map(count => ({ value: String(count), label: String(count) }))} />
      <SettingsSelect label={ar ? 'طريقة التسليم' : 'Dispatch method'} value={values.dispatchMode} disabled={busy} onChange={value => setValues(current => ({ ...current, dispatchMode: value as SuperExecutionSettings['dispatchMode'] }))}
        options={[{ value: 'wait', label: ar ? 'انتظار النتائج' : 'Wait for results' }, { value: 'background', label: ar ? 'خلفية موفّرة' : 'Background (economical)' }]} />
      <p className="text-[11px] leading-5 text-ink-soft">{ar
        ? 'الخلفية تعني أن السيرفر يواصل العمل وستصبح النتائج بحاجة لطلب مراجعة لاحق. لا يجمد حساب الذكاء الاصطناعي ولا يضمن كوتا.'
        : 'Background means the server keeps working and results will need a follow-up review request. No AI account freeze and no quota guarantee.'}</p>
      {note ? <p role="status" className="text-[11px] leading-5 text-ready-ink">{note}</p> : null}
      {error ? <p role="alert" className="text-[11px] leading-5 text-review-ink break-words">{error}</p> : null}
      <footer className="flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className={button} onClick={onClose} disabled={busy}>{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" className={`${button} bg-relay-tint text-relay-ink`} disabled={busy} onClick={() => void save()}>
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {busy ? ar ? 'جارٍ الحفظ…' : 'Saving…' : ar ? 'حفظ' : 'Save'}
        </button>
      </footer>
    </div>
  </dialog>
}
