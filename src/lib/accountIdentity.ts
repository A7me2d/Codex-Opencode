/** The same account label and avatar initials throughout the workspace. */
export function accountIdentity(identity?: string) {
  const name = identity?.trim().split('@')[0] || ''
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  const initials = parts.length > 1
    ? parts.slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase()
    : Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase()
  return { name, initials }
}
