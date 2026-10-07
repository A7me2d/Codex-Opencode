import { tr } from '../lib/i18n'
import { useState } from 'react'
import { ChevronDown, Plug, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { usePolling } from '../hooks/usePolling'
import { Spinner } from './ui/Spinner'
import { cx } from '../lib/cx'

function statusLabel(status: string) {
  const statuses: Record<string, string> = { connected: tr("متصلة"), ready: tr("متصلة"), disabled: tr("معطّلة"), disconnected: tr("غير متصلة"), failed: tr("فشل الاتصال"), starting: tr("جاري الاتصال"), notStarted: tr("لم يبدأ الاتصال"), needs_auth: tr("تحتاج تسجيل دخول") }
  return statuses[status] ?? status
}

export function McpPanel({ agent, busy = false }: { agent: 'codex' | 'opencode'; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const servers = usePolling(open ? () => api.mcpServers(agent) : null, 0, { resetKey: agent })
  const label = agent === 'codex' ? 'Codex' : 'OpenCode'
  async function toggle(name: string, enabled: boolean) {
    if (changing || busy) return
    setChanging(name); setError(null); setNote(null)
    try {
      const result = await api.setMcpEnabled(agent, name, enabled)
      setNote(result.note)
      await servers.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("تعذّر تغيير حالة MCP."))
      await servers.refresh()
    } finally { setChanging(null) }
  }
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="group/mcp shrink-0 border-b border-line bg-card text-start">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-[11px] font-bold text-ink-soft marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-relay/30">
      <Plug className="h-3.5 w-3.5" aria-hidden="true" /><span className="flex-1">{tr("أدوات MCP ·")}{' '}{label}</span>
      {servers.data ? <span>{servers.data.filter((entry) => entry.enabled).length} / {servers.data.length}</span> : null}
      <ChevronDown className="h-3 w-3 transition-transform group-open/mcp:rotate-180" aria-hidden="true" />
    </summary>
    {open ? <div className="px-4 pb-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-ink-soft">
        <span>{agent === 'codex' ? tr("إعدادات Codex المحلية · تُطبّق مع الرسالة التالية") : tr("اتصالات OpenCode · المشروع الحالي · حتى إعادة التشغيل")}</span>
        <button type="button" onClick={() => void servers.refresh()} disabled={Boolean(changing)} aria-label={tr("تحديث MCP {{0}}", [label])} className="rounded p-1 hover:bg-paper disabled:opacity-40"><RefreshCw className="h-3 w-3" /></button>
      </div>
      {busy ? <p className="mb-2 text-[10px] text-review-ink">{tr("انتظر انتهاء التنفيذ لتغيير الأدوات.")}</p> : null}
      {servers.status === 'loading' ? <div className="flex items-center gap-2 text-xs text-ink-soft"><Spinner />{tr("جاري تحميل الأدوات…")}</div> : null}
      {error || servers.error ? <p role="alert" className="mb-2 text-xs text-review-ink">{tr(error || servers.error || '')}</p> : null}
      <ul className="thin-scroll max-h-52 space-y-1.5 overflow-y-auto">
        {servers.data?.map((server) => <li key={server.name} className="flex items-center gap-3 rounded-lg border border-line px-2.5 py-2">
          <div className="min-w-0 flex-1"><span dir="ltr" className="block truncate text-[11px] font-semibold text-ink" title={server.name}>{server.name}</span>
            {server.name === 'codex_apps' ? <span className="block text-[10px] text-ink-soft">{tr("موصلات التطبيقات · الإعداد الافتراضي")}</span> : null}
            <span className="text-[10px] text-ink-soft">{statusLabel(server.status)}{server.enabled && server.toolCount !== null ? tr(" · {{0}} أداة", [server.toolCount]) : ''}</span>
          </div>
          <button type="button" role="switch" aria-checked={server.enabled} aria-label={tr("{{0}} MCP {{1}} في {{2}}", [server.enabled ? tr("تعطيل") : tr("تشغيل"), server.name, label])} disabled={busy || Boolean(changing)} onClick={() => void toggle(server.name, !server.enabled)}
            className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:cursor-wait disabled:opacity-45', server.enabled ? 'bg-ready' : 'bg-ink-soft/30')}>
            {changing === server.name ? <Spinner className="mx-auto h-3 w-3 text-on-accent" /> : <span className={cx('absolute h-3.5 w-3.5 rounded-full bg-white shadow transition-[left]', server.enabled ? 'left-[19px]' : 'left-[3px]')} />}
          </button>
        </li>)}
      </ul>
      {servers.data?.length === 0 ? <p className="text-xs text-ink-soft">{tr("لا توجد خوادم MCP مهيّأة لهذا الطرف.")}</p> : null}
      {note ? <p role="status" className="mt-2 text-[10px] leading-5 text-ready-ink">{note}</p> : null}
    </div> : null}
  </details>
}
