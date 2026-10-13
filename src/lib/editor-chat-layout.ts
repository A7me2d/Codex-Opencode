import { preferenceKeys } from './preferences'

export type ChatBox = { x: number; y: number; width: number; height: number }
export function constrainChatBox(box: ChatBox, viewport: { width: number; height: number }): ChatBox {
  const maxWidth = Math.max(1, viewport.width - 24), maxHeight = Math.max(1, viewport.height - 72)
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
  const width = clamp(box.width, Math.min(320, maxWidth), maxWidth)
  const height = clamp(box.height, Math.min(360, maxHeight), maxHeight)
  return { width, height, x: clamp(box.x, 12, Math.max(12, viewport.width - width - 12)), y: clamp(box.y, 60, Math.max(60, viewport.height - height - 12)) }
}
export function defaultChatBox(viewport: { width: number; height: number }): ChatBox {
  return constrainChatBox({ x: viewport.width - 444, y: 84, width: 420, height: 620 }, viewport)
}
export function readEditorChatLayout() {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferenceKeys.editorChatLayout) || '{}')
    const box = saved.box
    return { pinned: saved.pinned === true, box: box && ['x', 'y', 'width', 'height'].every(key => typeof box[key] === 'number' && Number.isFinite(box[key])) ? constrainChatBox(box, viewport) : defaultChatBox(viewport) }
  } catch { return { pinned: false, box: defaultChatBox(viewport) } }
}
