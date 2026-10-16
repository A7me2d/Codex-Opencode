import { memo } from 'react'
import { ArrowRightLeft, Bot, Sparkles } from 'lucide-react'
import { AccountAvatar } from '../../components/AccountAvatar'
import { accountIdentity } from '../../lib/accountIdentity'
import { useLocale } from '../../lib/i18n'
import type { ChatMessage } from '../../lib/types'

/** Small, safe text formatting, with no HTML rendering or extra runtime dependency. */
function inline(text: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => part.startsWith('`') && part.endsWith('`')
    ? <code key={index} dir="auto" className="rounded bg-paper px-1 py-0.5 font-mono text-[.9em] [overflow-wrap:anywhere]">{part.slice(1, -1)}</code>
    : part.startsWith('**') && part.endsWith('**') ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong> : part)
}

function body(text: string) {
  return text.split(/(```[\s\S]*?(?:```|$))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
      return <pre key={index} dir="ltr" className="thin-scroll my-2 max-h-56 overflow-auto rounded-lg border border-line bg-paper p-3 text-start font-mono text-[11px] leading-5"><code>{code}</code></pre>
    }
    return part.trim().split(/\n\s*\n/).filter(Boolean).map((paragraph, position) => {
      const quote = /^>/.test(paragraph), heading = /^#{1,3}\s/.test(paragraph)
      const content = quote ? paragraph.replace(/^> ?/gm, '') : heading ? paragraph.replace(/^#{1,3}\s/, '') : paragraph
      return <p key={`${index}-${position}`} className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${heading ? 'font-semibold' : ''} ${quote ? 'rounded-lg bg-paper/60 px-3 py-2' : ''}`}>{inline(content)}</p>
    })
  })
}

export const SuperMessage = memo(function SuperMessage({ message, provider, identity, onTransfer }: {
  message: ChatMessage; provider: 'codex' | 'opencode'; identity?: string; onTransfer: (text: string) => void
}) {
  const ar = useLocale() === 'ar', user = message.role === 'user'
  return <li data-super-message className="group/super-message min-w-0">
    <article className={`super-message min-w-0 ${user ? 'ms-5' : ''}`}>
      <div className="mb-1.5 flex min-h-5 items-center gap-1.5 text-[10px] text-ink-soft">
        {user ? <span className="inline-flex [&>span]:h-5 [&>span]:w-5 [&>span]:text-[8px]"><AccountAvatar identity={identity} /></span> : provider === 'codex' ? <Sparkles aria-hidden="true" className="h-3 w-3 text-relay-ink" /> : <Bot aria-hidden="true" className="h-3 w-3 text-ready-ink" />}
        <span dir="auto" className="min-w-0 truncate font-medium">{user ? accountIdentity(identity).name || (ar ? 'أنت' : 'You') : provider === 'codex' ? 'Codex' : 'OpenCode'}</span>
        {message.live ? <span role="status" className="text-relay-ink">{ar ? 'يكتب…' : 'Writing…'}</span> : null}
        <button type="button" title={ar ? 'نقل إلى مسودة مكتب آخر' : 'Transfer to another desk draft'} aria-label={ar ? 'نقل إلى مسودة مكتب آخر' : 'Transfer to another desk draft'} onClick={event => {
          const selection = window.getSelection(), parent = event.currentTarget.closest('[data-super-message]')
          onTransfer(selection?.rangeCount && parent?.contains(selection.getRangeAt(0).commonAncestorContainer) && selection.toString().trim() ? selection.toString() : message.text)
        }} className="ms-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-soft opacity-60 transition-opacity hover:bg-relay-tint hover:text-relay-ink hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40 sm:opacity-0 sm:group-hover/super-message:opacity-100"><ArrowRightLeft aria-hidden="true" className="h-3 w-3" /></button>
      </div>
      <div className={`space-y-2 text-[12px] leading-[1.8] ${user ? 'rounded-xl rounded-se-sm bg-user-surface px-3 py-2.5 text-user-ink' : 'px-0.5 text-ink'}`}>{body(message.text)}</div>
    </article>
  </li>
})
