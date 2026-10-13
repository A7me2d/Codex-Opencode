import { Archive, ArchiveRestore, Check, FolderOpen, LoaderCircle, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { tr } from '../lib/i18n'

export function ConversationActions({ title, archived = false, running = false, onRename, onArchive, onRestore, onOpenFolder }: {
  title: string
  archived?: boolean
  running?: boolean
  onRename: (title: string) => Promise<unknown>
  onArchive: () => Promise<unknown>
  onRestore: () => Promise<unknown>
  onOpenFolder?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function perform(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); setEditing(false) }
    catch (failure) { setError(failure instanceof Error ? tr(failure.message) : tr('تعذّر تحديث المحادثة.')) }
    finally { setBusy(false) }
  }
  const button = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-paper hover:text-relay-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/50 disabled:cursor-not-allowed disabled:opacity-40'
  return <div className="contents">
    <div className="flex items-center justify-end gap-0.5 pe-1">
      {busy ? <LoaderCircle className="m-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-label={tr('جارٍ تحديث المحادثة…')} /> : null}
      <button type="button" className={button} disabled={busy} aria-label={tr('تغيير اسم {{0}}', [title])} title={tr('تغيير اسم المحادثة')} onClick={() => { setName(title); setEditing(!editing); setError('') }}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></button>
      <button type="button" className={button} disabled={busy || (!archived && running)} aria-label={tr(archived ? 'استعادة {{0}}' : 'أرشفة {{0}}', [title])} title={tr(!archived && running ? 'انتظر انتهاء المحادثة قبل أرشفتها' : archived ? 'استعادة المحادثة' : 'أرشفة المحادثة')} onClick={() => void perform(archived ? onRestore : onArchive)}>{archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}</button>
      {onOpenFolder ? <button type="button" className={button} onClick={onOpenFolder} aria-label={tr('فتح مجلد المحادثة')} title={tr('فتح مجلد المحادثة')}><FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
    </div>
    {editing ? <form className="col-span-2 mx-2 mb-2 flex items-center gap-1" onSubmit={event => { event.preventDefault(); if (name.trim()) void perform(() => onRename(name.trim())) }}>
      <input autoFocus maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditing(false) } }} aria-label={tr('اسم المحادثة')} className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-relay" />
      <button type="submit" className={button} disabled={busy || !name.trim()} aria-label={tr('حفظ الاسم')} title={tr('حفظ الاسم')}><Check className="h-3.5 w-3.5" aria-hidden="true" /></button>
      <button type="button" className={button} disabled={busy} onClick={() => setEditing(false)} aria-label={tr('إلغاء')} title={tr('إلغاء')}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </form> : null}
    {error ? <p role="alert" className="col-span-2 mx-2 mb-2 text-[11px] leading-5 text-review-ink">{error}</p> : null}
  </div>
}
