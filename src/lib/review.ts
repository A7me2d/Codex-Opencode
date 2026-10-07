import { tr } from './i18n'
import { readOpenCodeChat } from './chat'
import type { HandoffData } from './types'

/** Give Codex the actual exchange, rather than assuming every reply is code. */
export function openCodeReviewPrompt(handoff: HandoffData | null): string {
  const messages = readOpenCodeChat(handoff?.messages)
  const latestRequest = messages.map((message) => message.role).lastIndexOf('user')
  const exchange = latestRequest >= 0 ? messages.slice(latestRequest) : messages.slice(-1)
  const transcript = exchange.map(({ role, text }) => {
    const content = text.replace(/\$opencode\b/gi, tr("[وسم التفويض]")).slice(0, 24_000).replace(/\r\n?/g, '\n').trim()
    const quote = content.split('\n').map((line) => `> ${line}`).join('\n')
    return tr("**{{0}}**\n\n{{1}}", [role === 'user' ? 'طلبي' : 'رد OpenCode', quote])
  })
  return [
    tr("راجع رد OpenCode: لخّصه، وقل لي هل لبّى طلبي وهل يحتاج متابعة."),
    ...transcript,
    ...(exchange.some((message) => message.role === 'assistant') ? [] : [tr("لم يصل رد من OpenCode بعد.")]),
  ].join('\n\n')
}
