import type { CodexItem, SessionFileDiff } from './types'

export function readCodexFileChanges(items: CodexItem[] | null): SessionFileDiff[] {
  const byFile = new Map<string, SessionFileDiff>()
  const seen = new Set<string>()
  for (const item of items ?? []) {
    if (item.type !== 'fileChange' || item.status !== 'completed' || seen.has(item.id)) continue
    seen.add(item.id)
    for (const change of item.changes ?? []) {
      if (typeof change.path !== 'string' || typeof change.diff !== 'string') continue
      const lines = readDiffLines(change.diff)
      const previous = byFile.get(change.path)
      byFile.set(change.path, {
        file: change.path,
        patch: previous ? `${previous.patch}\n${change.diff}` : change.diff,
        additions: (previous?.additions ?? 0) + lines.filter((line) => line.kind === 'added').length,
        deletions: (previous?.deletions ?? 0) + lines.filter((line) => line.kind === 'removed').length,
        status: ({ add: 'added', delete: 'deleted', update: 'modified' } as Record<string, string>)[change.kind?.type ?? ''] ?? 'modified',
      })
    }
  }
  return [...byFile.values()]
}

export interface DiffLine {
  kind: 'added' | 'removed' | 'context' | 'hunk' | 'note'
  text: string
  oldLine?: number
  newLine?: number
}

/** Line numbers come from each unified diff hunk, not its display row. */
export function readDiffLines(patch: string): DiffLine[] {
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true
      result.push({ kind: 'hunk', text: line })
    } else if (inHunk && line.startsWith('+')) {
      result.push({ kind: 'added', text: line.slice(1), newLine: newLine++ })
    } else if (inHunk && line.startsWith('-')) {
      result.push({ kind: 'removed', text: line.slice(1), oldLine: oldLine++ })
    } else if (inHunk && line.startsWith(' ')) {
      result.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    } else if (inHunk && line.startsWith('\\')) {
      result.push({ kind: 'note', text: line })
    }
  }
  return result
}
