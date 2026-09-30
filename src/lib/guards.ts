/**
 * Payload guards.
 *
 * Every collection in this app crosses a process boundary (Codex app-server,
 * the OpenCode CLI, our own state files). A bridge is free to answer with
 * `{}`, `"text"`, or `null` where we expect a list, so read arrays and records
 * through these instead of trusting the shape. `value ?? []` is not enough:
 * `{}` and `"text"` are both truthy.
 */

/** Collections arrive from several bridges, so never trust the shape blindly. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

/** Same idea for objects: anything that is not a plain record becomes `{}`. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
