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

/** Accept only the exact completed edit events visible when the user clicked. */
export function acceptedCodexChangeIds(items, previous, requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 10_000
    || requested.some(id => typeof id !== 'string' || !id || id.length > 200 || id.includes('\u0000'))) {
    throw Object.assign(new Error('Choose valid Codex changes to accept.'), { status: 400 })
  }
  const completed = new Set(items.filter(item => item.type === 'fileChange' && item.status === 'completed').map(item => item.id))
  if (requested.some(id => !completed.has(id))) {
    throw Object.assign(new Error('These Codex changes are not available yet. Refresh and try again.'), { status: 409 })
  }
  return [...new Set([...(Array.isArray(previous) ? previous : []), ...requested])]
}

export function unacceptedCodexItems(items, acceptedIds) {
  const accepted = new Set(Array.isArray(acceptedIds) ? acceptedIds : [])
  return items.filter(item => item.type !== 'fileChange' || !accepted.has(item.id))
}
