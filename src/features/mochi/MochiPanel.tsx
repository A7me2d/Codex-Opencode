/**
 * MochiPanel (Desk 7): the operator control surface for the Mochi assistant.
 *
 * Contract: props `{teamId, visible, onOpenDesk?}`; light snapshot polling
 * (15s) only while visible; model chosen by the operator from the existing
 * OpenCode catalog; no automatic approve/answer/accept ever sent from this
 * panel without an explicit operator action; the disable (stop) control stays
 * clickable even when the panel is in an error state; failures are shown
 * honestly (a missing backend renders an error, never a mock success).
 * Copy is localized through local bilingual strings because the shared
 * i18n.ts file is outside this desk's ownership.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, type AppLocale } from '../../lib/i18n'
import type { ModelInfo } from '../../lib/types'
import { OpenCodeModelPicker } from '../../components/ui/OpenCodeModelPicker'
import { fetchMochiSnapshot, fetchOpenCodeModels, saveMochiConfig, resolveMochiProposal } from './api'
import type { MochiConfigPatch, MochiProposal, MochiRuntimeState, MochiSnapshot } from './types'
import './mochi-panel.css'

export interface MochiPanelProps {
  teamId: string
  visible: boolean
  onOpenDesk?: (slotId: string) => void
  onSnapshot?: (snapshot: MochiSnapshot) => void
}

const POLL_MS = 15_000

interface MochiPanelStrings {
  region: string
  stateLabel: string
  states: Record<MochiRuntimeState, string>
  loadError: string
  serverSaid: string
  retry: string
  refreshNote: string
  configTitle: string
  enabledLabel: string
  enabledHint: string
  stopLabel: string
  stopHint: string
  modeLabel: string
  modes: { suggest: string; automatic: string }
  modelLabel: string
  modelHint: string
  modelPlaceholder: string
  noModels: string
  catalogError: string
  modelRequired: string
  flagsTitle: string
  autoAnswerLabel: string
  autoAnswerHint: string
  autoResumeLabel: string
  autoResumeHint: string
  autoApproveLabel: string
  autoApproveHint: string
  proposalsTitle: string
  emptyProposals: string
  kinds: Record<MochiProposal['kind'], string>
  statuses: Record<MochiProposal['status'], string>
  approve: string
  reject: string
  resolving: string
  saved: string
  actionFailed: string
  openDesk: string
  answerLabel: string
}

const stringsByLocale: Record<AppLocale, MochiPanelStrings> = {
  ar: {
    region: 'مساعد Mochi: الحالة والإعدادات والاقتراحات',
    stateLabel: 'الحالة',
    states: {
      disabled: 'معطّل',
      idle: 'جاهز',
      working: 'يعمل',
      waiting_user: 'بانتظار قرارك',
      blocked: 'متوقّف بخطأ',
    },
    loadError: 'تعذّر تحميل حالة Mochi.',
    serverSaid: 'رسالة الخادم',
    retry: 'إعادة المحاولة',
    refreshNote: 'تحديث خفيف كل 15 ثانية أثناء فتح اللوحة فقط، ولا يُطلق أي عمل.',
    catalogError: 'تعذّر جلب كتالوج الموديلات.',
    configTitle: 'الإعدادات',
    enabledLabel: 'تفعيل Mochi',
    enabledHint: 'إيقافه يعني لا استقصاء ولا رسائل ولا قرارات من هذا الفريق.',
    stopLabel: 'إيقاف Mochi',
    stopHint: 'متاح دائمًا حتى أثناء الأخطاء.',
    modeLabel: 'نمط العمل',
    modes: {
      suggest: 'اقتراح: كل اقتراح بانتظار موافقتك (الافتراضي)',
      automatic: 'تلقائي محدود: ضمن الاستثناءات المفعَّلة أدناه فقط',
    },
    modelLabel: 'موديل OpenCode',
    modelHint: 'اختيارك من الكتالوج المثبَّت محليًا (providerID/modelID)؛ لا يوجد أي ادّعاء بأنّه مجاني.',
    modelPlaceholder: 'اختر موديلًا…',
    noModels: 'لا توجد موديلات قابلة للأدوات متاحة الآن.',
    modelRequired: 'اختر موديلًا من الكتالوج قبل التفعيل.',
    flagsTitle: 'السماحيات التلقائية',
    autoAnswerLabel: 'إجابات تلقائية',
    autoAnswerHint: 'مدعوم جزئيًا: إجابات النماذج القابلة للتحقق فقط، والغموض يبدد إليك.',
    autoResumeLabel: 'استكمال تلقائي',
    autoResumeHint: 'الاستكمال يحتاج موافقتك من الاقتراح، ومتاح لمكاتب OpenCode فقط حاليًا.',
    autoApproveLabel: 'موافقات أدوات تلقائية',
    autoApproveHint: 'غير مدعوم في هذه النسخة: كل موافقات الأدوات وصولًا إليك أولًا.',
    proposalsTitle: 'الاقتراحات',
    emptyProposals: 'لا اقتراحات بانتظار قرارك الآن.',
    kinds: {
      answer_question: 'إجابة سؤال',
      resume_task: 'استكمال مهمة',
      approve_tool: 'موافقة أداة',
      escalate: 'تصعيد إليك',
    },
    statuses: {
      pending: 'بانتظار قرار',
      applied: 'مُطبَّق',
      rejected: 'مرفوض',
      stale: 'عديم الفائدة (صار قديمًا)',
      blocked: 'محجوب',
    },
    approve: 'اعتمد',
    reject: 'ارفض',
    resolving: 'جارٍ الإرسال…',
    saved: 'تم حفظ إعداد Mochi.',
    actionFailed: 'تعذّر تنفيذ الإجراء.',
    openDesk: 'افتح مكتب الفريق',
    answerLabel: 'إجابة مقترحة',
  },
  en: {
    region: 'Mochi assistant: state, settings and proposals',
    stateLabel: 'State',
    states: {
      disabled: 'Disabled',
      idle: 'Ready',
      working: 'Working',
      waiting_user: 'Waiting for you',
      blocked: 'Blocked by error',
    },
    loadError: 'Could not load the Mochi state.',
    serverSaid: 'Server message',
    retry: 'Retry',
    refreshNote: 'Light refresh every 15 seconds while this panel is open; it never starts work.',
    catalogError: 'Could not fetch the model catalog.',
    configTitle: 'Settings',
    enabledLabel: 'Enable Mochi',
    enabledHint: 'Off means no polling, no provider messages and no decisions for this team.',
    stopLabel: 'Stop Mochi',
    stopHint: 'Always available, even while errors are shown.',
    modeLabel: 'Operating mode',
    modes: {
      suggest: 'Suggest: every proposal waits for your approval (default)',
      automatic: 'Limited automatic: only within the exceptions enabled below',
    },
    modelLabel: 'OpenCode model',
    modelHint: 'Your choice from the locally installed catalog (providerID/modelID); nothing is claimed free.',
    modelPlaceholder: 'Choose a model…',
    noModels: 'No tool-capable models available right now.',
    modelRequired: 'Choose a model from the catalog before enabling.',
    flagsTitle: 'Automatic allowances',
    autoAnswerLabel: 'Automatic answers',
    autoAnswerHint: 'Partially supported: deterministic form answers only; ambiguity comes to you.',
    autoResumeLabel: 'Automatic resume',
    autoResumeHint: 'Continuation requires your approval and currently supports OpenCode desks only.',
    autoApproveLabel: 'Automatic tool approvals',
    autoApproveHint: 'Not supported in this version: all tool approvals reach you first.',
    proposalsTitle: 'Proposals',
    emptyProposals: 'No proposals are waiting for your decision right now.',
    kinds: {
      answer_question: 'Answer a question',
      resume_task: 'Resume a task',
      approve_tool: 'Tool approval',
      escalate: 'Escalated to you',
    },
    statuses: {
      pending: 'Awaiting decision',
      applied: 'Applied',
      rejected: 'Rejected',
      stale: 'Stale (outdated)',
      blocked: 'Blocked',
    },
    approve: 'Approve',
    reject: 'Reject',
    resolving: 'Sending…',
    saved: 'Mochi settings saved.',
    actionFailed: 'The action failed.',
    openDesk: 'Open the team desk',
    answerLabel: 'Suggested answer',
  },
}

function runtimeChipClass(state: MochiRuntimeState): string {
  switch (state) {
    case 'working': return 'mochi-state-chip is-working'
    case 'waiting_user': return 'mochi-state-chip is-waiting'
    case 'blocked': return 'mochi-state-chip is-blocked'
    case 'disabled': return 'mochi-state-chip is-disabled'
    default: return 'mochi-state-chip is-idle'
  }
}

function shortId(value: string): string {
  return typeof value === 'string' && value.length > 26 ? `${value.slice(0, 24)}…` : value
}

export function MochiPanel({ teamId, visible, onOpenDesk, onSnapshot }: MochiPanelProps) {
  const locale = useLocale()
  const s = stringsByLocale[locale]

  const [snapshot, setSnapshot] = useState<MochiSnapshot | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [resolvingIds, setResolvingIds] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const onSnapshotRef = useRef(onSnapshot)
  onSnapshotRef.current = onSnapshot
  useEffect(() => { if (snapshot) onSnapshotRef.current?.(snapshot) }, [snapshot])
  const inFlight = useRef(false)

  const refresh = useCallback(async (signal: AbortSignal) => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = await fetchMochiSnapshot(teamId, signal)
      setSnapshot(next)
      setLoadError(null)
    } catch (error) {
      if (signal.aborted) return
      setLoadError(String((error as Error)?.message ?? 'Unknown error') || 'Unknown error')
    } finally {
      inFlight.current = false
    }
  }, [teamId])

  // Snapshot polling: only while visible, single-flight, light rate; a GET
  // never triggers model inference or any action by contract.
  useEffect(() => {
    if (!visible || !teamId) return undefined
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => void refresh(controller.signal), POLL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [visible, teamId, refresh])

  // Catalog read: once per visibility window, model ids never come from polling.
  useEffect(() => {
    if (!visible || !teamId) return undefined
    const controller = new AbortController()
    fetchOpenCodeModels(controller.signal).then(list => {
      setModels(list)
      setModelsError(null)
    }).catch(error => {
      if (controller.signal.aborted) return
      setModels([])
      setModelsError(String((error as Error)?.message ?? 'Unknown error') || 'Unknown error')
    })
    return () => controller.abort()
  }, [visible, teamId])

  async function patchConfig(patch: MochiConfigPatch, savedText: string | null) {
    if (!teamId || savingConfig) return
    setSavingConfig(true)
    setActionError(null)
    setNotice(null)
    try {
      setSnapshot(await saveMochiConfig(teamId, patch))
      if (savedText) setNotice(savedText)
    } catch (error) {
      setActionError(String((error as Error)?.message ?? 'Unknown error') || 'Unknown error')
    } finally {
      setSavingConfig(false)
    }
  }

  // Stop stays clickable in every state, including loadError/actionError.
  function stopMochi() {
    void patchConfig({ enabled: false }, null)
  }

  function toggleEnabled(next: boolean) {
    if (next && (!snapshot?.config.model || !snapshot.config.model.trim())) {
      setActionError(null)
      setNotice(s.modelRequired)
      return
    }
    void patchConfig({ enabled: next }, next ? s.saved : null)
  }

  function selectModel(modelId: string) {
    if (!modelId) return
    void patchConfig({ model: modelId }, null)
  }

  async function resolveProposal(proposal: MochiProposal, decision: 'approve' | 'reject') {
    if (proposal.status !== 'pending' || resolvingIds.includes(proposal.id)) return
    setResolvingIds(pending => [...pending, proposal.id])
    setActionError(null)
    setNotice(null)
    try {
      setSnapshot(await resolveMochiProposal(teamId, proposal.id, decision))
    } catch (error) {
      setActionError(String((error as Error)?.message ?? 'Unknown error') || 'Unknown error')
    } finally {
      setResolvingIds(current => current.filter(id => id !== proposal.id))
    }
  }

  const config = snapshot?.config ?? null
  const runtime = snapshot?.runtime ?? null
  const pendingProposals = (snapshot?.proposals ?? []).filter(proposal => proposal.status === 'pending')
  const decidedProposals = (snapshot?.proposals ?? []).filter(proposal => proposal.status !== 'pending')

  return (
    <section role="region" aria-label={s.region} className="mochi-panel">
      <header className="mochi-panel__head">
        <div className="mochi-panel__title">
          <h3>Mochi</h3>
          {runtime ? (
            <span className={runtimeChipClass(runtime.state)} aria-label={s.stateLabel}>
              {s.states[runtime.state]}
            </span>
          ) : null}
        </div>
      </header>

      {runtime?.error ? <p className="mochi-banner mochi-banner--error" role="alert">{runtime.error}</p> : null}

      {loadError ? (
        <div className="mochi-banner mochi-banner--error" role="alert">
          <p>{s.loadError}</p>
          <p className="mochi-banner__detail">{s.serverSaid}: {loadError}</p>
          <button type="button" className="mochi-btn" onClick={() => {
            const controller = new AbortController()
            void refresh(controller.signal)
          }}>{s.retry}</button>
        </div>
      ) : null}

      {notice ? <p className="mochi-banner mochi-banner--notice" role="status">{notice}</p> : null}
      {actionError ? (
        <p className="mochi-banner mochi-banner--error" role="alert">
          {s.actionFailed}
          <span className="mochi-banner__detail"> · {s.serverSaid}: {actionError}</span>
        </p>
      ) : null}

      <section className="mochi-panel__section" aria-busy={savingConfig}>
        <h4>{s.configTitle}</h4>

        <div className="mochi-field-row">
          <div className="mochi-field">
            <label htmlFor="mochi-enabled">{s.enabledLabel}</label>
            <p className="mochi-hint">{s.enabledHint}</p>
          </div>
          <div className="mochi-field-row__controls">
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(config?.enabled)}
              id="mochi-enabled"
              className={config?.enabled ? 'mochi-switch is-on' : 'mochi-switch'}
              disabled={savingConfig}
              onClick={() => toggleEnabled(!config?.enabled)}
            >
              {config?.enabled ? '✓' : '—'}
            </button>
            <button type="button" className="mochi-btn" title={s.stopHint} disabled={savingConfig} onClick={stopMochi}>
              {s.stopLabel}
            </button>
          </div>
        </div>

        <div className="mochi-field">
          <label htmlFor="mochi-mode">{s.modeLabel}</label>
          <select id="mochi-mode" className="mochi-select"
            value={config?.mode ?? 'suggest'}
            disabled={savingConfig}
            onChange={event => void patchConfig({ mode: event.target.value as 'suggest' | 'automatic' }, s.saved)}>
            <option value="suggest">{s.modes.suggest}</option>
            <option value="automatic">{s.modes.automatic}</option>
          </select>
        </div>

        <div className="mochi-field">
          <label htmlFor="mochi-model">{s.modelLabel}</label>
          {models.length ? (
            <OpenCodeModelPicker id="mochi-model" label={s.modelLabel} placeholder={s.modelPlaceholder}
              models={models} value={config?.model ?? ''} disabled={savingConfig}
              onChange={selectModel} />
          ) : (
            <p className="mochi-hint">
              {modelsError ? <>{s.catalogError}<span className="mochi-banner__detail"> · {s.serverSaid}: {modelsError}</span></> : s.noModels}
            </p>
          )}
          <p className="mochi-hint">{s.modelHint}</p>
        </div>

        <fieldset className="mochi-flags">
          <legend>{s.flagsTitle}</legend>
          <label className="mochi-check">
            <input type="checkbox"
              checked={Boolean(config?.autoAnswer)}
              disabled={savingConfig}
              onChange={event => void patchConfig({ autoAnswer: event.target.checked }, event.target.checked ? s.saved : null)} />
            <span>{s.autoAnswerLabel}</span>
          </label>
          <p className="mochi-hint mochi-hint--indent">{s.autoAnswerHint}</p>
          <label className="mochi-check">
            <input type="checkbox"
              checked={false}
              disabled={true}
              onChange={event => void patchConfig({ autoResume: event.target.checked }, event.target.checked ? s.saved : null)} />
            <span>{s.autoResumeLabel}</span>
          </label>
          <p className="mochi-hint mochi-hint--indent">{s.autoResumeHint}</p>
          <label className="mochi-check mochi-check--disabled">
            <input type="checkbox" checked={Boolean(config?.autoApproveTools)} disabled={true} readOnly />
            <span>{s.autoApproveLabel}</span>
          </label>
          <p className="mochi-hint mochi-hint--indent">{s.autoApproveHint}</p>
        </fieldset>

        <p className="mochi-hint">{s.refreshNote}</p>
      </section>

      <section className="mochi-panel__section" aria-busy={resolvingIds.length > 0}>
        <h4>{s.proposalsTitle}</h4>
        {pendingProposals.length === 0 && decidedProposals.length === 0 ? (
          <p className="mochi-empty" role="status">{s.emptyProposals}</p>
        ) : null}
        <ul className="mochi-proposals thin-scroll">
          {pendingProposals.map(proposal => (
            <li key={proposal.id} className="mochi-proposal">
              <div className="mochi-proposal__head">
                <span className="mochi-chip">{s.kinds[proposal.kind]}</span>
                <span className="mochi-identity">
                  {shortId(proposal.teamId)} · {shortId(proposal.slotId)} · {shortId(proposal.threadId)} · {shortId(proposal.taskId)}
                </span>
              </div>
              {proposal.answer && Object.keys(proposal.answer).length ? (
                <dl dir="ltr" className="mochi-answer" aria-label={s.answerLabel}>
                  {Object.entries(proposal.answer).map(([key, value]) => <div key={key}><dt className="font-semibold">{key}</dt><dd>{value}</dd></div>)}
                </dl>
              ) : null}
              <p className="mochi-reason">{proposal.reason}</p>
              <div className="mochi-proposal__actions">
                {onOpenDesk ? <button type="button" className="mochi-btn" onClick={() => onOpenDesk(proposal.slotId)}>{s.openDesk}</button> : null}
                <button
                  type="button"
                  className="mochi-btn mochi-btn--approve"
                  disabled={proposal.kind === 'escalate' || resolvingIds.includes(proposal.id)}
                  onClick={() => void resolveProposal(proposal, 'approve')}
                >
                  {resolvingIds.includes(proposal.id) ? s.resolving : s.approve}
                </button>
                <button
                  type="button"
                  className="mochi-btn mochi-btn--reject"
                  disabled={resolvingIds.includes(proposal.id)}
                  onClick={() => { if (!resolvingIds.includes(proposal.id)) void resolveProposal(proposal, 'reject') }}
                >
                  {resolvingIds.includes(proposal.id) ? s.resolving : s.reject}
                </button>
              </div>
            </li>
          ))}
          {decidedProposals.slice(-6).map(proposal => (
            <li key={proposal.id} className="mochi-proposal mochi-proposal--decided">
              <div className="mochi-proposal__head">
                <span className="mochi-chip mochi-chip--muted">{s.kinds[proposal.kind]}</span>
                <span className="mochi-status">{s.statuses[proposal.status]}</span>
              </div>
              <p className="mochi-reason">{proposal.reason}</p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
