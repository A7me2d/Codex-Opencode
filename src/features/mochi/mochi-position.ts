export interface MochiBounds {
  /** Viewport-space rect of the Super Agent work area the pet may roam. */
  left: number
  top: number
  width: number
  height: number
}

export interface MochiSize { width: number; height: number }
export interface MochiAnchor { x: number; y: number }

/** Independent storage key: the pet keeps one spot across openings and teams. */
export const mochiAnchorKey = 'openzero.mochi.anchor'
/** Pointer travel before a gesture counts as a drag, not a click. */
export const mochiDragThreshold = 6
export const mochiMargin = 12
export const mochiDefaultInset = 16
export const mochiStep = 8
export const mochiBigStep = 32
/** Keyboard moves save on a short debounce, never per keystroke. */
export const mochiSaveDebounceMs = 400

export function isValidMochiAnchor(anchor?: MochiAnchor | null): anchor is MochiAnchor {
  return anchor !== undefined && anchor !== null && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
}

/** Keep the pet fully inside the work area, margins included. */
export function clampMochiAnchor(anchor: MochiAnchor, bounds: MochiBounds, size: MochiSize, margin = mochiMargin): MochiAnchor {
  const minX = bounds.left + margin
  const minY = bounds.top + margin
  const maxX = Math.max(minX, bounds.left + bounds.width - margin - size.width)
  const maxY = Math.max(minY, bounds.top + bounds.height - margin - size.height)
  return { x: Math.min(Math.max(anchor.x, minX), maxX), y: Math.min(Math.max(anchor.y, minY), maxY) }
}

/** The calm default: bottom physical-right, mirroring the original launcher spot. */
export function defaultMochiAnchor(bounds: MochiBounds, size: MochiSize, inset = mochiDefaultInset): MochiAnchor {
  return {
    x: Math.max(bounds.left + inset, bounds.left + bounds.width - inset - size.width),
    y: Math.max(bounds.top + inset, bounds.top + bounds.height - inset - size.height),
  }
}

/** A saved anchor wins unless it is missing or corrupt; then clamp whatever we keep. */
export function resolveMochiAnchor(anchor?: MochiAnchor | null, bounds?: MochiBounds | null, size?: MochiSize | null, inset = mochiDefaultInset): MochiAnchor {
  const safeBounds = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : { left: 0, top: 0, width: 1200, height: 800 }
  const safeSize = size && size.width > 0 ? size : { width: 120, height: 48 }
  return isValidMochiAnchor(anchor) ? clampMochiAnchor(anchor, safeBounds, safeSize) : defaultMochiAnchor(safeBounds, safeSize, inset)
}

/** One arrow press: an 8px step, 32px with Shift, always clamped. */
export function movedMochiAnchor(anchor: MochiAnchor, dx: number, dy: number, bounds: MochiBounds, size: MochiSize, big = false): MochiAnchor {
  const step = big ? mochiBigStep : mochiStep
  return clampMochiAnchor({ x: anchor.x + dx * step, y: anchor.y + dy * step }, bounds, size)
}

export function readMochiAnchor(storage: { getItem(key: string): string | null } | null): MochiAnchor | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(mochiAnchorKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MochiAnchor> | null
    const anchor = { x: parsed?.x ?? NaN, y: parsed?.y ?? NaN }
    return isValidMochiAnchor(anchor) ? { x: anchor.x, y: anchor.y } : null
  } catch {
    return null
  }
}

export function writeMochiAnchor(storage: { setItem(key: string, value: string): void } | null, anchor: MochiAnchor): void {
  if (!storage) return
  try {
    storage.setItem(mochiAnchorKey, JSON.stringify({ x: Math.round(anchor.x), y: Math.round(anchor.y) }))
  } catch {
    // Storage may be unavailable; the pet simply keeps its current spot this session.
  }
}

/**
 * Drawer geometry relative to the launcher origin (the pet's top-left).
 *
 * Horizontal side follows the roomier half of the work area, so RTL and LTR
 * both get a sensible side from real geometry, and the drawer is clamped to
 * stay inside the visible area right up against the edges. Vertically it
 * opens above the pet when that fits, otherwise below.
 */
export function placeMochiDrawer(anchor: MochiAnchor, pet: MochiSize, drawer: MochiSize, bounds: MochiBounds, margin = mochiMargin): { left: number; top: number; side: 'left' | 'right'; below: boolean } {
  const width = Math.max(0, drawer.width)
  const height = Math.max(0, drawer.height)
  const gap = 10
  const roomRight = bounds.left + bounds.width - margin - (anchor.x + pet.width)
  const roomLeft = anchor.x - bounds.left - margin
  const side = roomRight >= roomLeft ? 'right' : 'left'
  const rawLeft = side === 'right' ? anchor.x + pet.width + gap : anchor.x - width - gap
  const minLeft = bounds.left + margin
  const maxLeft = Math.max(minLeft, bounds.left + bounds.width - margin - width)
  const left = Math.min(Math.max(rawLeft, minLeft), maxLeft) - anchor.x
  const aboveTop = anchor.y - height - gap
  if (aboveTop >= bounds.top + margin) return { left, top: aboveTop - anchor.y, side, below: false }
  const belowTop = Math.max(bounds.top + margin, anchor.y + pet.height + gap)
  return { left, top: belowTop - anchor.y, side, below: true }
}
