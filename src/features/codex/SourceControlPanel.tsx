import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, FileCode2, GitBranch, LoaderCircle, Minus, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { api } from '../../lib/api'
import { usePolling } from '../../hooks/usePolling'
import { openProjectFile } from '../../components/ProjectEditor'
import type { GitChange, GitDiffPreview } from '../../lib/types'

const iconButton = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-relay-tint hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 disabled:opacity-40'

export function SourceControlPanel({ root, visible, commitModel }: { root: string; visible: boolean; commitModel?: string }) {
  const load = useCallback(() => api.sourceControl(root), [root])
  const status = usePolling(visible ? load : null, 10_000, { resetKey: root })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [remote, setRemote] = useState('')
  const [preview, setPreview] = useState<GitDiffPreview | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const locked = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!visible) dialog.current?.close() }, [visible])
  useEffect(() => { if (preview && visible && !dialog.current?.open) dialog.current?.showModal() }, [preview, visible])
  const data = status.data?.repository ? status.data : null
  const staged = data?.entries.filter(entry => entry.staged) ?? []
  const changes = data?.entries.filter(entry => entry.changed && !entry.conflict) ?? []
  const conflicts = data?.entries.filter(entry => entry.conflict) ?? []
  const selectedRemote = remote || (data?.remotes.includes('origin') ? 'origin' : data?.remotes[0] ?? '')
  async function perform(action: 'stage' | 'unstage' | 'commit' | 'push' | 'publish', paths?: string[]) {
    if (!data || locked.current) return
    locked.current = true; setBusy(action); setError(''); setNotice('')
    try {
      await api.sourceControlAction({ root, action, paths, message, stagedVersion: data.stagedVersion,
        head: data.head, branch: data.branch, remote: selectedRemote })
      if (!mounted.current) return
      if (action === 'commit') { setMessage(''); setNotice('Commit created.') }
      if (action === 'push' || action === 'publish') setNotice(action === 'publish' ? 'Branch published.' : 'Push completed.')
      await status.refresh()
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { locked.current = false; if (mounted.current) setBusy('') }
  }
  async function showDiff(entry: GitChange, staged: boolean) {
    if (locked.current) return
    locked.current = true; setBusy('diff'); setError('')
    try { const result = await api.sourceControlDiff(root, entry.path, staged); if (mounted.current && visible) setPreview(result) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { locked.current = false; if (mounted.current) setBusy('') }
  }
  async function generateMessage() {
    if (!data || locked.current || !staged.length || conflicts.length) return
    locked.current = true; setBusy('generate'); setError(''); setNotice('')
    try {
      const result = await api.generateCommitMessage({ root, stagedVersion: data.stagedVersion, model: commitModel || undefined, messageId: crypto.randomUUID() })
      if (mounted.current) { setMessage(result.message); setNotice(`Commit message generated with ${result.model}. Review it before Commit.`) }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { locked.current = false; if (mounted.current) setBusy('') }
  }
  return <section aria-label="Source Control" dir="ltr" className="flex min-h-0 flex-1 flex-col">
    <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><h2 className="text-xs font-semibold">Source Control</h2><button type="button" title="Refresh" aria-label="Refresh" disabled={Boolean(busy)} onClick={() => void status.refresh()} className={iconButton}><RefreshCw className="h-3.5 w-3.5" /></button></header>
    {status.status === 'loading' ? <p role="status" className="flex items-center gap-2 px-3 py-3 text-xs text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" />Loading repository…</p> : null}
    {status.data && !status.data.repository ? <p className="px-3 py-4 text-xs leading-6 text-ink-soft">{status.data.error}</p> : null}
    {data ? <>
      <div className="space-y-2 border-b border-line px-3 pb-3">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-soft"><GitBranch className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate" title={data.branch || 'Detached HEAD'}>{data.branch || 'Detached HEAD'}</span>{data.upstream ? <span title="Outgoing / Incoming Changes" className="shrink-0 tabular-nums">↑{data.ahead} ↓{data.behind}</span> : null}</div>
        <div className="relative">
        <textarea aria-label="Commit Message" placeholder="Message (Ctrl+Enter to commit)" disabled={busy === 'commit' || busy === 'generate'} value={message} onChange={event => setMessage(event.target.value)} rows={3} maxLength={10000} onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && message.trim() && staged.length && !conflicts.length) { event.preventDefault(); void perform('commit') }
        }} className="block w-full resize-y rounded-lg border border-line bg-paper py-2 pl-2.5 pr-9 text-xs leading-5 text-ink outline-none placeholder:text-ink-soft focus:border-relay/50 focus:ring-2 focus:ring-relay/10 disabled:opacity-60" />
        <button type="button" aria-label="Generate Commit Message" title={conflicts.length ? 'Resolve Merge Changes before generating a commit message' : !staged.length ? 'Stage Changes to Generate Commit Message' : `Generate Commit Message · ${commitModel || 'Codex default model'} · Uses 1 request`} disabled={Boolean(busy) || !staged.length || Boolean(conflicts.length)} onClick={() => void generateMessage()} className={`${iconButton} absolute right-1 top-1`}>{busy === 'generate' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}</button>
        </div>
        <button type="button" disabled={Boolean(busy) || !message.trim() || !staged.length || Boolean(conflicts.length)} onClick={() => void perform('commit')} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-relay px-3 text-xs font-semibold text-on-accent hover:bg-relay-ink disabled:opacity-45"><Check className="h-3.5 w-3.5" />{busy === 'commit' ? 'Committing…' : 'Commit'}</button>
        {!data.upstream && data.remotes.length > 1 ? <label className="block text-[10px] text-ink-soft">Remote<select aria-label="Remote" value={selectedRemote} onChange={event => setRemote(event.target.value)} disabled={Boolean(busy)} className="mt-1 w-full rounded-md border border-line bg-paper p-1.5 text-xs text-ink">{data.remotes.map(name => <option key={name} value={name}>{name}</option>)}</select></label> : null}
        <button type="button" disabled={Boolean(busy) || !data.branch || !data.head || !data.remotes.length} onClick={() => void perform(data.upstream ? 'push' : 'publish')} className="inline-flex min-h-8 w-full items-center justify-center gap-2 rounded-lg border border-line text-xs font-semibold text-ink-soft hover:bg-paper disabled:opacity-45"><ArrowUp className="h-3.5 w-3.5" />{busy === 'push' || busy === 'publish' ? 'Pushing…' : data.upstream ? 'Push' : 'Publish Branch'}</button>
        {!data.remotes.length ? <p className="text-[10px] leading-5 text-ink-soft">No remote configured. Add a Git remote to Push.</p> : null}
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto py-2">
        {conflicts.length ? <ChangeGroup title="Merge Changes" files={conflicts} staged={false} busy={Boolean(busy)} onDiff={showDiff} onAction={perform} /> : null}
        {staged.length ? <ChangeGroup title="Staged Changes" files={staged} staged busy={Boolean(busy)} onDiff={showDiff} onAction={perform} /> : null}
        <ChangeGroup title="Changes" files={changes} staged={false} busy={Boolean(busy)} onDiff={showDiff} onAction={perform} />
        {!data.entries.length ? <p className="px-3 py-5 text-center text-xs text-ink-soft">No Changes</p> : null}
      </div>
    </> : null}
    {busy ? <p role="status" className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2 text-[11px] text-ink-soft"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{busy === 'diff' ? 'Loading changes…' : busy === 'generate' ? 'Generating Commit Message…' : 'Working…'}</p> : null}
    {error || status.error ? <p role="alert" className="shrink-0 whitespace-pre-wrap break-words border-t border-line px-3 py-2 text-[11px] leading-5 text-review-ink">{error || status.error}</p> : null}
    {notice ? <p role="status" className="shrink-0 border-t border-line px-3 py-2 text-[11px] text-ready-ink">{notice}</p> : null}
    <dialog ref={dialog} onClose={() => setPreview(null)} aria-label="Changes" className="fixed inset-0 m-auto h-[80dvh] max-h-none w-[min(94vw,1100px)] max-w-none overflow-hidden rounded-xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-overlay/50">
      {preview ? <div className="flex h-full min-h-0 flex-col"><header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3"><span className="min-w-0 flex-1 truncate text-xs font-semibold" title={preview.path}>{preview.path} · {preview.staged ? 'Staged Changes' : 'Changes'}</span><button type="button" disabled={preview.deleted} onClick={() => { openProjectFile(root, preview.path); dialog.current?.close() }} className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-40">Open File</button><button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className={iconButton}><X className="h-4 w-4" /></button></header>
        <div className="thin-scroll min-h-0 flex-1 overflow-auto bg-[#1e1e1e] py-3 font-mono text-xs leading-6 text-[#d4d4d4]">{preview.text ? preview.text.split('\n').map((line, index) => <div key={index} className={`whitespace-pre px-4 ${line.startsWith('+') && !line.startsWith('+++') ? 'bg-[#203b25] text-[#b5cea8]' : line.startsWith('-') && !line.startsWith('---') ? 'bg-[#4b2525] text-[#f1abab]' : line.startsWith('@@') ? 'text-[#9cdcfe]' : ''}`}>{line || ' '}</div>) : <p className="px-4">No text changes.</p>}</div>
        {preview.truncated ? <p className="shrink-0 border-t border-line px-4 py-2 text-xs text-ink-soft">Diff preview truncated.</p> : null}
      </div> : null}
    </dialog>
  </section>
}

function ChangeGroup({ title, files, staged, busy, onDiff, onAction }: { title: string; files: GitChange[]; staged: boolean; busy: boolean;
  onDiff: (file: GitChange, staged: boolean) => Promise<void>; onAction: (action: 'stage' | 'unstage', paths: string[]) => Promise<void> }) {
  const [expanded, setExpanded] = useState(true)
  const action = staged ? 'unstage' : 'stage', label = staged ? 'Unstage Changes' : 'Stage Changes'
  return <div className="mb-2">
    <div className="flex items-center gap-1 px-2"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-[11px] font-semibold"><ChevronDown className={`h-3 w-3 ${expanded ? '' : '-rotate-90'}`} /><span className="flex-1 text-start">{title}</span><span className="rounded-full bg-paper px-1.5 text-[10px] tabular-nums">{files.length}</span></button><button type="button" title={staged ? 'Unstage All Changes' : 'Stage All Changes'} aria-label={staged ? 'Unstage All Changes' : 'Stage All Changes'} disabled={busy || !files.length} onClick={() => void onAction(action, files.map(file => file.path))} className={iconButton}>{staged ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}</button></div>
    {expanded ? <ul>{files.map(file => <li key={file.path} className="flex items-center gap-1 px-2 hover:bg-paper"><button type="button" disabled={busy} onClick={() => void onDiff(file, staged)} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-[11px] disabled:opacity-50"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-soft" /><span className="min-w-0 flex-1 truncate">{file.path.split('/').pop()}<span className="ms-1 text-[9px] text-ink-soft">{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}</span></span><span className={`text-[10px] font-semibold ${file.conflict ? 'text-review-ink' : 'text-ready-ink'}`}>{staged ? file.index : file.index === '?' ? 'U' : file.worktree}</span></button><button type="button" aria-label={`${label}: ${file.path}`} title={label} disabled={busy} onClick={() => void onAction(action, [file.path])} className={iconButton}>{staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}</button></li>)}</ul> : null}
  </div>
}
