/**
 * Transcript readers.
 *
 * Each agent has its own envelope, and both are untrusted. These functions turn
 * a raw payload into the single `ChatMessage` shape the UI renders, dropping
 * anything that has no readable text.
 */
import { asArray, asRecord } from './guards'
import { readText } from './format'
import type { ChatMessage, CodexItem } from './types'

/** Codex sends `userMessage` / `agentMessage` items in chronological order. */
export function readCodexChat(items: CodexItem[] | null): ChatMessage[] {
  return asArray<CodexItem>(items).flatMap<ChatMessage>((item) => {
    if (item.type === 'userMessage') {
      const text = readText(item.content)
      return text ? [{ id: item.id, role: 'user', text }] : []
    }
    if (item.type === 'agentMessage') {
      const text = item.text ?? readText(item.content)
      return text ? [{ id: item.id, role: 'assistant', text, live: item.live }] : []
    }
    return []
  })
}

/**
 * OpenCode returns newest-first, so it is reversed into reading order. Only
 * text parts survive; tool calls and reasoning are summarised separately by
 * the activity strip.
 */
export function readOpenCodeChat(messages: unknown[] | null | undefined): ChatMessage[] {
  const chronological = asArray(messages).flatMap<ChatMessage>((message, index) => {
    const record = asRecord(message)
    const info = asRecord(record.info)
    const type = record.type ?? info.role
    if (type !== 'user' && type !== 'assistant') return []
    const content = Array.isArray(record.content)
      ? record.content.filter((part) => asRecord(part).type === 'text')
      : record.content ?? record.parts
    const rawText = readText(record.text ?? content ?? record.message ?? record.summary)
    const text = type === 'user' ? rawText.replace(/^\[Relay Room role: OpenCode is the planner and reviewer;[\s\S]*?\]\r?\n\r?\n/, '') : rawText
    const id = String(record.id ?? info.id ?? `opencode-${index}`)
    const parentId = record.parentID ?? info.parentID
    return text ? [{ id, role: type, text, ...(typeof parentId === 'string' ? { userMessageId: parentId } : {}) }] : []
  }).reverse()

  let lastUserMessageId: string | undefined
  const owningUserByMessage = new Map<string, string>()
  const associated = chronological.map(message => {
    if (message.role === 'user') {
      lastUserMessageId = message.id
      owningUserByMessage.set(message.id, message.id)
      return message
    }
    const userMessageId = message.userMessageId
      ? owningUserByMessage.get(message.userMessageId) ?? message.userMessageId
      : lastUserMessageId
    if (userMessageId) owningUserByMessage.set(message.id, userMessageId)
    return { ...message, userMessageId }
  })
  return associated.map((message, index) => {
    if (message.role !== 'assistant' || !message.userMessageId) return message
    const next = associated[index + 1]
    return next?.role === 'assistant' && next.userMessageId === message.userMessageId
      ? { ...message, userMessageId: undefined }
      : message
  })
}
