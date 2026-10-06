import { useEffect, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { ChangedFiles } from './ChangedFiles'
import { api } from '../../lib/api'
import type { SessionFileDiff } from '../../lib/types'

const DECISIONS_KEY = 'coding-room.opencode-message-decisions'
type Decision = 'accepted' | 'rejected'
type DecisionMap = Record<string, Decision>

function readDecisions(): DecisionMap {
  try { return JSON.parse(localStorage.getItem(DECISIONS_KEY) ?? '{}') as DecisionMap }
  catch { return {} }
}

function saveDecision(key: string, decision: Decision) {
  const decisions = readDecisions()
  decisions[key] = decision
  const recent = Object.entries(decisions).slice(-500)
  localStorage.setItem(DECISIONS_KEY, JSON.stringify(Object.fromEntries(recent)))
}

export function MessageChanges({ sessionId, messageId, active, onChanged }: {
  sessionId: string
  messageId: string
  active: boolean
  onChanged?: () => void
}) {
  const decisionKey = `${sessionId}:${messageId}`
  const [decision, setDecision] = useState<Decision | null>(() => readDecisions()[decisionKey] ?? null)
  const [files, setFiles] = useState<SessionFileDiff[] | null>(null)
  const [loading, setLoading] = useState(!decision)
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (decision) return
    let cancelled = false
    setLoading(true)
    void api.sessionMessageDiff(sessionId, messageId).then(value => {
      if (!cancelled) setFiles(Array.isArray(value) ? value : [])
    }).catch(failure => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'تعذر تحميل التغييرات.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [decision, messageId, sessionId])

  if (decision || loading || (!error && files?.length === 0)) return null

  function accept() {
    saveDecision(decisionKey, 'accepted')
    setDecision('accepted')
  }

  async function reject() {
    setRejecting(true)
    setError(null)
    try {
      await api.revertSessionMessage(sessionId, messageId)
      saveDecision(decisionKey, 'rejected')
      setDecision('rejected')
      onChanged?.()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر رفض تغييرات الرسالة.')
    } finally {
      setRejecting(false)
    }
  }

  return <section className="mt-3 overflow-hidden rounded-xl border border-ready/25 bg-ready-tint/25">
    {files ? <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
      <p className="text-[11px] font-bold text-ink">التغييرات الناتجة عن هذه الرسالة</p>
      <div className="flex gap-1.5">
        <button type="button" onClick={accept} disabled={active || rejecting} className="inline-flex items-center gap-1 rounded-md bg-ready px-2.5 py-1.5 text-[10px] font-bold text-on-accent hover:bg-ready-ink disabled:cursor-not-allowed disabled:opacity-45">
          <Check className="h-3 w-3" aria-hidden="true" />أوافق على التعديلات
        </button>
        <button type="button" onClick={() => void reject()} disabled={active || rejecting} className="inline-flex items-center gap-1 rounded-md border border-review/35 bg-card px-2.5 py-1.5 text-[10px] font-bold text-review-ink hover:bg-review-tint disabled:cursor-not-allowed disabled:opacity-45">
          <RotateCcw className="h-3 w-3" aria-hidden="true" />{rejecting ? 'جارٍ الرفض…' : 'رفض'}
        </button>
      </div>
    </div> : null}
    {files ? <div className="px-3"><ChangedFiles sessionId={sessionId} active={false} files={files} /></div> : null}
    {error ? <p role="alert" className="px-3 pb-3 text-[11px] text-review-ink">{error}</p> : null}
  </section>
}
