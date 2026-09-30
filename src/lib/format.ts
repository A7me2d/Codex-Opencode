/** Presentation-only string helpers. No React, no data fetching. */

/** Accepts seconds, milliseconds, or an ISO string, and normalises to epoch ms. */
export function toEpoch(value: unknown) {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** Compact Arabic relative time: الآن / منذ ٤ د / منذ ٣ س / منذ ٢ ي */
export function relativeTime(value: unknown) {
  const timestamp = toEpoch(value)
  if (!timestamp) return 'الآن'
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `منذ ${minutes} د`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `منذ ${hours} س`
  return `منذ ${Math.round(hours / 24)} ي`
}

/** Single-line truncation for list rows and titles. */
export function clip(text: string, max = 88) {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

/**
 * Pull displayable text out of an arbitrary bridge payload: plain strings,
 * arrays of parts, or `{ text | message | content }` records, up to 4 levels.
 */
export function readText(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((part) => readText(part, depth + 1)).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (typeof record.message === 'string') return record.message
    if (record.content) return readText(record.content, depth + 1)
  }
  return ''
}
