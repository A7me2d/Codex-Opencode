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
  return asArray(messages).flatMap<ChatMessage>((message, index) => {
    const record = asRecord(message)
    const type = record.type
    if (type !== 'user' && type !== 'assistant') return []
    const content = Array.isArray(record.content)
      ? record.content.filter((part) => asRecord(part).type === 'text')
      : record.content
    const rawText = readText(record.text ?? content ?? record.message)
    const text = type === 'user' ? rawText.replace(/^\[Relay Room role: OpenCode is the planner and reviewer;[\s\S]*?\]\r?\n\r?\n/, '') : rawText
    return text ? [{ id: String(record.id ?? `opencode-${index}`), role: type, text }] : []
  }).reverse()
}
