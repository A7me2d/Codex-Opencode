import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Read only the Desktop model preferences, never credentials or server settings. */
export function shownOpenCodeModelIds(raw) {
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw
  const model = typeof state?.model === 'string' ? JSON.parse(state.model) : state?.model
  if (!Array.isArray(model?.user)) throw new Error('OpenCode model visibility preferences are unavailable. Choose visible models in OpenCode first.')
  const visible = new Set()
  for (const entry of model.user) {
    if (typeof entry?.providerID !== 'string' || typeof entry?.modelID !== 'string') continue
    const id = `${entry.providerID}/${entry.modelID}`
    if (entry.visibility === 'show') visible.add(id)
    else if (entry.visibility === 'hide') visible.delete(id)
  }
  return visible
}

export async function visibleOpenCodeModels(models, { file = path.join(process.env.APPDATA || path.join(homedir(), '.config'), 'ai.opencode.desktop', 'opencode.global.dat'), read = readFile } = {}) {
  let shown
  try { shown = shownOpenCodeModelIds(await read(file, 'utf8')) }
  catch { throw Object.assign(new Error('Could not read your visible OpenCode models. Open OpenCode and choose which models to show.'), { status: 503 }) }
  // Deliberately do not fall back to the full catalog if preferences are absent.
  return models.filter(model => shown.has(model.id))
}
