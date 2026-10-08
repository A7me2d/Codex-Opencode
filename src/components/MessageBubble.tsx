import { tr } from '../lib/i18n'
import { Bot, Sparkles, UserRound } from 'lucide-react'
import { memo } from 'react'
import { cx } from '../lib/cx'
import type { ChatMessage, Speaker } from '../lib/types'

const agentName: Record<Speaker, string> = { codex: 'Codex', opencode: 'OpenCode' }

/** One chat line. The two agents stay visually distinct without splitting the flow. */
export const MessageBubble = memo(function MessageBubble({ message, speaker }: { message: ChatMessage; speaker: Speaker }) {
  const isUser = message.role === 'user'
  const lines = message.text.split('\n')

  return <article className={cx('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
    <div
      aria-hidden="true"
      className={cx(
        'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-inset ring-line/60',
        isUser ? 'bg-user-surface text-user-ink' : speaker === 'codex' ? 'bg-relay-tint text-relay-ink' : 'bg-ready-tint text-ready-ink',
      )}
    >
      {isUser ? <UserRound className="h-3.5 w-3.5" /> : speaker === 'codex' ? <Sparkles className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
    </div>

    <div className="min-w-0 max-w-[90%] text-start">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-extrabold tracking-wide text-ink-soft">
        <span>{isUser ? tr("أنت") : agentName[speaker]}</span>
        {message.live ? <span className="inline-flex items-center gap-1 text-relay" role="status">{tr("يكتب الآن")}<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-relay" /></span> : null}
      </div>
      <div className={cx('rounded-2xl px-4 py-3.5 text-[13px] leading-7 shadow-[0_2px_8px_rgba(25,35,48,0.06)]', isUser ? 'rounded-tr-md bg-user-surface text-user-ink' : 'rounded-tl-md border border-line bg-card text-ink')}>
        {lines.map((line, index) => {
          const heading = line.match(/^#{1,3}\s+(.+)$/)
          return heading
            ? <h3 key={index} className="mt-3 first:mt-0 text-sm font-extrabold tracking-tight text-current">{heading[1]}</h3>
            : <span key={index} className="block min-h-[1.25rem] whitespace-pre-wrap">{line || '\u00a0'}</span>
        })}
      </div>
    </div>
  </article>
}, (previous, next) => previous.speaker === next.speaker
  && previous.message.id === next.message.id
  && previous.message.role === next.message.role
  && previous.message.text === next.message.text
  && previous.message.live === next.message.live)
