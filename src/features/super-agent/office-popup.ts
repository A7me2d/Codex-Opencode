/**
 * Placement for the floating desk chat: pure geometry driven by measured element rects.
 *
 * Callers pass the *actual* client rects of the workspace container, the office scroll
 * viewport and the selected desk. Because client rects already include the current zoom
 * `scale()` transform they stay correct at any zoom, scroll offset, text direction and
 * window size. Nothing here reads global coordinates, provider names or cached sizes.
 */

export type OfficePopupSide = 'left' | 'right'
export type OfficePopupMode = 'side' | 'dock'
export type OfficePopupRect = { left: number; top: number; width: number; height: number }
export type OfficePopupPlacement = OfficePopupRect & { mode: OfficePopupMode; side: OfficePopupSide }

export type OfficePopupMetrics = {
  container: OfficePopupRect
  /** Selected desk rect, measured on the live element (already scaled/translated). */
  anchor?: OfficePopupRect | null
  /** Office scroll viewport; defaults to the container. */
  viewport?: OfficePopupRect | null
  /** Client rects of controls the panel must not sit on top of, e.g. the office toolbar. */
  avoid?: OfficePopupRect[] | null
  /** Edge used when the desk cannot be measured, e.g. inline-end of the workspace. */
  fallbackSide?: OfficePopupSide
  preferredWidth?: number
  minWidth?: number
  dockWidth?: number
  minHeight?: number
  gap?: number
  margin?: number
}

export const officePopupDefaults = {
  preferredWidth: 420,
  minWidth: 300,
  dockWidth: 460,
  minHeight: 220,
  gap: 14,
  margin: 10,
  /** Shorter workspaces drop the vertical breathing room so the composer stays usable. */
  minMarginedHeight: 280,
  /** Sub-pixel tolerance so scroll and zoom updates never bounce the panel. */
  tolerance: 0.5,
} as const

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const measure = (value: OfficePopupRect): OfficePopupRect => ({
  left: Number.isFinite(value.left) ? value.left : 0,
  top: Number.isFinite(value.top) ? value.top : 0,
  width: Number.isFinite(value.width) ? Math.max(0, value.width) : 0,
  height: Number.isFinite(value.height) ? Math.max(0, value.height) : 0,
})

/**
 * Resolves a placement that sits *beside* the selected desk and always stays inside the
 * workspace. When neither side of the desk has room for a usable panel the geometry falls
 * back to a docked panel on the side facing away from the desk, shrinking to the workspace
 * instead of clipping fields or pushing the close button off-screen.
 */
export function officePopupPlacement(metrics: OfficePopupMetrics): OfficePopupPlacement {
  const gap = metrics.gap ?? officePopupDefaults.gap
  const margin = metrics.margin ?? officePopupDefaults.margin
  const preferredWidth = metrics.preferredWidth ?? officePopupDefaults.preferredWidth
  const minWidth = metrics.minWidth ?? officePopupDefaults.minWidth
  const dockWidth = metrics.dockWidth ?? officePopupDefaults.dockWidth
  const fallbackSide = metrics.fallbackSide ?? 'right'
  const minHeight = metrics.minHeight ?? officePopupDefaults.minHeight
  const container = measure(metrics.container)
  // Obstacles arrive as client rects; the placement uses container space, so align them first.
  const obstacles = (metrics.avoid ?? []).map(value => {
    const box = measure(value)
    return { left: box.left - container.left, top: box.top - container.top, width: box.width, height: box.height }
  })
  const innerWidth = Math.max(0, container.width - margin * 2)
  const innerHeight = Math.max(0, container.height - margin * 2)
  const vertical = innerHeight >= officePopupDefaults.minMarginedHeight ? margin : 0
  const top = vertical
  const height = Math.max(0, container.height - vertical * 2)
  const viewport = measure(metrics.viewport ?? metrics.container)
  const viewLeft = Math.max(container.left, viewport.left)
  const viewRight = Math.min(container.left + container.width, viewport.left + viewport.width)
  const anchor = metrics.anchor ? measure(metrics.anchor) : null

  const docked = (side: OfficePopupSide, width?: number): OfficePopupPlacement => {
    const size = clamp(width ?? Math.min(dockWidth, innerWidth), 0, innerWidth)
    // Keep the panel inside the workspace even for degenerate (0-width) containers.
    const edge = Math.min(margin, Math.max(0, container.width - size))
    const left = side === 'right' ? Math.max(edge, container.width - margin - size) : edge
    return { mode: 'dock', side, left, top, width: size, height }
  }
  /** Trim the panel around measured controls: a tucked chat beats an unreachable toolbar. */
  const avoidControls = (placement: OfficePopupPlacement): OfficePopupPlacement => {
    const right = placement.left + placement.width
    let top = placement.top, bottom = placement.top + placement.height
    for (const obstacle of obstacles) {
      if (obstacle.width <= 0 || obstacle.height <= 0 || placement.left >= obstacle.left + obstacle.width || right <= obstacle.left) continue
      const raise = obstacle.top + obstacle.height + gap - top
      const lower = bottom - (obstacle.top - gap)
      if (raise > 0 && lower > 0) { if (raise <= lower) top += raise; else bottom -= lower }
      else if (raise > 0) top += raise
      else if (lower > 0) bottom -= lower
    }
    return bottom - top >= minHeight ? { ...placement, top, height: bottom - top } : placement
  }
  const resolve = (): OfficePopupPlacement => {
    if (!anchor) return docked(fallbackSide)
    const center = container.left + container.width / 2
    const anchorCenter = anchor.left + anchor.width / 2
    if (innerWidth < minWidth) return docked(anchorCenter <= center ? 'right' : 'left')
    const anchorRight = anchor.left + anchor.width
    const leftRoom = anchor.left - viewLeft - margin
    const rightRoom = viewRight - anchorRight - margin
    // Open the panel toward the free half of the map so the desk itself stays uncovered.
    const preferLeft = anchorCenter <= (viewLeft + viewRight) / 2
    const order: OfficePopupSide[] = preferLeft ? ['left', 'right'] : ['right', 'left']
    for (const side of order) {
      const room = side === 'right' ? rightRoom : leftRoom
      const width = Math.min(preferredWidth, innerWidth, room - gap)
      if (width < minWidth) continue
      const raw = side === 'right' ? anchorRight + gap - container.left : anchor.left - gap - width - container.left
      return { mode: 'side', side, left: clamp(raw, margin, Math.max(margin, container.width - margin - width)), top, width, height }
    }
    const side: OfficePopupSide = anchorCenter <= center ? 'right' : 'left'
    const away = side === 'right' ? anchor.left - container.left - margin - gap : container.left + container.width - anchorRight - margin - gap
    return docked(side, Math.max(minWidth, away))
  }
  return avoidControls(resolve())
}

/** Cheap, tolerance-based comparison so repeated measurements skip needless DOM writes. */
export function officePopupEqual(current: OfficePopupPlacement | null, next: OfficePopupPlacement | null, tolerance = officePopupDefaults.tolerance) {
  if (!current || !next) return current === next
  return current.mode === next.mode && current.side === next.side &&
    Math.abs(current.left - next.left) < tolerance && Math.abs(current.top - next.top) < tolerance &&
    Math.abs(current.width - next.width) < tolerance && Math.abs(current.height - next.height) < tolerance
}
