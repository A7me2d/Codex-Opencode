import { useEffect, useRef, useState } from 'react'
import { Settings, X, Check, Brain, Wrench, Palette } from 'lucide-react'
import { api } from '../lib/api'
import { usePolling } from '../hooks/usePolling'
import { cx } from '../lib/cx'
import type { WorkflowSetup } from '../lib/types'
import { ThemePanel } from './ThemePanel'

export function SettingsDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'setup' | 'themes'>('setup')
  const saved = usePolling(open ? api.workflow : null, 0)
  const [setup, setSetup] = useState<WorkflowSetup>({ planner: 'codex', executor: 'opencode' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { if (saved.data) setSetup(saved.data.workflow) }, [saved.data])
  function show() { setOpen(true); setError(null); setNotice(null); dialog.current?.showModal() }
  function choose(role: keyof WorkflowSetup, agent: WorkflowSetup['planner']) {
    const other = agent === 'codex' ? 'opencode' : 'codex'
    setSetup(role === 'planner' ? { planner: agent, executor: other } : { planner: other, executor: agent })
    setNotice(null)
  }
  async function save() {
    setSaving(true); setError(null)
    try { await api.saveWorkflow(setup); setNotice('تم حفظ الإعداد. افتح محادثة جديدة لتبدأ بالأدوار المختارة.'); await saved.refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذّر حفظ الإعدادات.') }
    finally { setSaving(false) }
  }
  return <>
    <button type="button" onClick={show} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-soft hover:border-relay/40 hover:text-relay-ink"><Settings className="h-3.5 w-3.5" />الإعدادات</button>
    <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="settings-title" dir="rtl" className="fixed inset-0 m-auto w-[min(94vw,640px)] max-h-[90dvh] overflow-auto rounded-2xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-overlay/40">
      <header className="flex items-center justify-between border-b border-line px-6 py-4"><h2 id="settings-title" className="text-base font-bold">الإعدادات</h2><button aria-label="إغلاق الإعدادات" onClick={() => dialog.current?.close()} className="rounded-lg p-2 hover:bg-paper"><X className="h-4 w-4" /></button></header>
      <nav aria-label="أقسام الإعدادات" className="flex gap-2 border-b border-line px-6 py-3">
        <button onClick={() => setTab('setup')} aria-pressed={tab === 'setup'} className={cx('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold', tab === 'setup' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}><Wrench className="h-4 w-4" />Setup · توزيع الأدوار</button>
        <button onClick={() => setTab('themes')} aria-pressed={tab === 'themes'} className={cx('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold', tab === 'themes' ? 'bg-relay-tint text-relay-ink' : 'text-ink-soft hover:bg-paper')}><Palette className="h-4 w-4" />الثيمات</button>
      </nav>
      {tab === 'themes' ? <ThemePanel /> : <section className="space-y-6 p-6">
        <p className="text-xs leading-6 text-ink-soft">وزّع الشغل بين الطرفين. الاختيار يُحفظ للمحادثات الجديدة؛ كل محادثة موجودة تحتفظ بأدوارها.</p>
        {(['planner', 'executor'] as const).map((role, index) => <fieldset key={role} disabled={saving || !saved.data}>
          <legend className="mb-3 flex items-center gap-2 text-sm font-bold">{role === 'planner' ? <Brain className="h-4 w-4 text-relay" /> : <Wrench className="h-4 w-4 text-ready" />}{index + 1}. {role === 'planner' ? 'تحب مين المفكّر والمراجع؟' : 'تحب مين المنفّذ؟'}</legend>
          <div className="grid grid-cols-2 gap-3">{saved.data?.agents.filter(agent => agent.available).map(agent => <label key={agent.id} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors', setup[role] === agent.id ? 'border-relay bg-relay-tint/50' : 'border-line bg-paper hover:border-relay/40')}>
            <input type="radio" name={role} value={agent.id} checked={setup[role] === agent.id} onChange={() => choose(role, agent.id as WorkflowSetup['planner'])} className="accent-relay" /><span className="flex-1 text-sm font-semibold" dir="ltr">{agent.name}</span>{setup[role] === agent.id ? <Check className="h-4 w-4 text-relay" /> : null}
          </label>)}</div>
        </fieldset>)}
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink-soft">المفكّر يخطط ويراجع، والمنفّذ يعدّل الملفات ويختبر النتيجة.</p>
        <div className="border-t border-line pt-4"><p className="text-xs text-ink-soft">أطراف إضافية مستقبلًا</p><div className="mt-2 flex gap-2">{saved.data?.agents.filter(agent => !agent.available).map(agent => <span key={agent.id} className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-ink-soft">{agent.name} · لاحقًا</span>)}</div></div>
        {error || saved.error ? <p role="alert" className="text-xs text-review-ink">{error || saved.error}</p> : null}
        {notice ? <p role="status" className="text-xs leading-6 text-ready-ink">{notice}</p> : null}
        <button onClick={() => void save()} disabled={saving || !saved.data} className="w-full rounded-xl bg-relay px-4 py-3 text-sm font-bold text-on-accent hover:bg-relay-ink disabled:opacity-45">{saving ? 'جارٍ الحفظ…' : 'حفظ توزيع الأدوار'}</button>
      </section>}
    </dialog>
  </>
}
