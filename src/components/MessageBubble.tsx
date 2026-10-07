import { tr } from '../lib/i18n'
import { Bot, Sparkles, UserRound } from 'lucide-react'
import { memo } from 'react'
import { cx } from '../lib/cx'
import type { ChatMessage, Speaker } from '../lib/types'

const agentName: Record<Speaker, string> = { codex: 'Codex', opencode: 'OpenCode' }

/** One chat line. The two agents stay visually distinct without splitting the flow. */
export const MessageBubble = memo(function MessageBubble({ message, speaker }: { message: ChatMessage; speaker: Speaker }) {
  const isUser = message.role === 'user'

  return <article className={cx('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
    <div
      aria-hidden="true"
      className={cx(
        'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
        isUser ? 'bg-user-surface text-user-ink' : speaker === 'codex' ? 'bg-relay-tint text-relay-ink' : 'bg-ready-tint text-ready-ink',
      )}
    >
      {isUser ? <UserRound className="h-3.5 w-3.5" /> : speaker === 'codex' ? <Sparkles className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
    </div>

    <div className="min-w-0 max-w-[85%] text-start">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-ink-soft">
        <span>{isUser ? tr("أنت") : agentName[speaker]}</span>
        {message.live ? <span className="inline-flex items-center gap-1 text-relay" role="status">{tr("يكتب الآن")}<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-relay" /></span> : null}
      </div>
      <div className={cx('whitespace-pre-wrap rounded-xl px-3.5 py-3 text-[13px] leading-7 shadow-[0_1px_1px_rgba(25,35,48,0.04)]', isUser ? 'bg-user-surface text-user-ink' : 'border border-line bg-card text-ink')}>
        {message.text}
      </div>
    </div>
  </article>
}, (previous, next) => previous.speaker === next.speaker
  && previous.message.id === next.message.id
  && previous.message.role === next.message.role
  && previous.message.text === next.message.text
  && previous.message.live === next.message.live)
