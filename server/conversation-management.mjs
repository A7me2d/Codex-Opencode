/** Normalize provider seconds, local milliseconds, and ISO dates before sorting. */
export function conversationTime(value) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

export function conversationTitle(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Enter a conversation name.'), { status: 400 })
  const title = value.replaceAll('\u0000', '').trim().replace(/\s+/g, ' ')
  if (!title || title.length > 120) throw Object.assign(new Error('Use a conversation name between 1 and 120 characters.'), { status: 400 })
  return title
}
