import { useState } from 'react'
import { LoaderCircle, Send, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { fieldOptions } from '../../lib/forms'
import type { OpenCodeForm } from '../../lib/forms'

export interface QuestionFormProps {
  form: OpenCodeForm
  sessionId: string
  /** Called after every attempt, so the rail re-reads the pending questions. */
  onAnswered: () => void
  onNotify: (title: string, detail?: string) => void
}

/**
 * An answerable OpenCode question.
 *
 * A question blocks the run, so the card stays pinned at the top of the rail
 * until it is answered — it must never scroll out of sight.
 */
export function QuestionForm({ form, sessionId, onAnswered, onNotify }: QuestionFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (sending) return

    const answer: Record<string, string> = {}
    for (const field of form.fields) {
      const value = values[field.key]?.trim() ?? ''
      if (!value) {
        setError('جاوب على كل الأسئلة عشان OpenCode يكمّل.')
        return
      }
      answer[field.key] = value
    }

    setSending(true)
    setError(null)
    try {
      await api.replyToForm(sessionId, form.id, answer)
      setValues({})
      onNotify('تم إرسال إجابتك إلى OpenCode', 'متابعة التنفيذ الآن')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر إرسال الإجابة.')
    } finally {
      setSending(false)
      // Either way the server state changed: a rejected answer may already be
      // answered elsewhere, so always re-read the pending questions.
      onAnswered()
    }
  }

  return <form onSubmit={submit} className="rounded-xl border border-review/35 bg-card p-3">
    <div className="flex items-start justify-between gap-2">
      <p className="text-[12px] font-bold leading-6 text-review-ink">{form.title}</p>
      <code dir="ltr" className="ltr shrink-0 text-[9px] text-ink-soft">{form.id}</code>
    </div>

    <div className="mt-2.5 space-y-3">
      {form.fields.map((field) => {
        const options = fieldOptions(field)
        return <fieldset key={field.key} className="space-y-1.5">
          <legend className="text-[12px] font-bold leading-6 text-ink">{field.title}</legend>
          {field.description ? <p className="text-[11px] leading-5 text-ink-soft">{field.description}</p> : null}

          {options.length > 0 ? (
            <div className="space-y-1.5">
              {options.map((option) => <label key={option.value} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors', values[field.key] === option.value ? 'border-relay/50 bg-relay-tint' : 'border-line bg-paper hover:border-relay/30')}>
                <input
                  type="radio"
                  name={`${form.id}-${field.key}`}
                  value={option.value}
                  checked={values[field.key] === option.value}
                  onChange={() => setValues((current) => ({ ...current, [field.key]: option.value }))}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-relay)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold leading-5 text-ink">{option.label}</span>
                  {option.description ? <span className="mt-0.5 block text-[10px] leading-5 text-ink-soft">{option.description}</span> : null}
                </span>
              </label>)}
            </div>
          ) : (
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder="اكتب إجابتك…"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-6 text-ink outline-none placeholder:text-ink-soft/70 focus:border-relay/55 focus:ring-2 focus:ring-relay/10"
            />
          )}
        </fieldset>
      })}
    </div>

    {error ? (
      <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-review-tint px-2.5 py-2 text-[11px] leading-5 text-review-ink">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}
      </div>
    ) : null}

    <button type="submit" disabled={sending} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-review px-3 py-2 text-[12px] font-bold text-on-accent transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-55">
      {sending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
      أرسل الإجابة وأكمل
    </button>
  </form>
}
