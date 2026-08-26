// Reine Geometrie-Helfer für den Layout-Editor: Klemmen, Snapping, Resize.
// Alle Werte in Layout-Pixeln. Keine React-/DOM-Abhängigkeit → leicht testbar.

export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const MIN_REGION = 40

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Snap-Zielkanten (vertikale x- und horizontale y-Linien) aus Layout + anderen Regionen. */
export function snapTargets(
  others: { x: number; y: number; width: number; height: number }[],
  layoutW: number,
  layoutH: number,
): { vx: number[]; hy: number[] } {
  const vx = [0, layoutW / 2, layoutW]
  const hy = [0, layoutH / 2, layoutH]
  for (const r of others) {
    vx.push(r.x, r.x + r.width / 2, r.x + r.width)
    hy.push(r.y, r.y + r.height / 2, r.y + r.height)
  }
  return { vx, hy }
}

function bestSnap(anchors: number[], targets: number[], tol: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null
  let bestDist = tol + 1
  for (const a of anchors) {
    for (const t of targets) {
      const d = Math.abs(a - t)
      if (d < bestDist) { bestDist = d; best = { delta: t - a, line: t } }
    }
  }
  return best
}

/** Verschiebe-Snapping: prüft linke/mittige/rechte Kante gegen die Ziel-Linien. */
export function snapMove(
  rect: Rect, targets: { vx: number[]; hy: number[] }, tol: number, layoutW: number, layoutH: number,
): { x: number; y: number; guidesV: number[]; guidesH: number[] } {
  let x = rect.x, y = rect.y
  const guidesV: number[] = [], guidesH: number[] = []
  const sx = bestSnap([x, x + rect.width / 2, x + rect.width], targets.vx, tol)
  if (sx) { x += sx.delta; guidesV.push(sx.line) }
  const sy = bestSnap([y, y + rect.height / 2, y + rect.height], targets.hy, tol)
  if (sy) { y += sy.delta; guidesH.push(sy.line) }
  x = clamp(x, 0, layoutW - rect.width)
  y = clamp(y, 0, layoutH - rect.height)
  return { x, y, guidesV, guidesH }
}

/** Neues Rechteck aus Start-Rechteck + Ziehdelta für einen der 8 Griffe (geklemmt). */
export function resizeRect(
  handle: Handle, start: Rect, dx: number, dy: number, layoutW: number, layoutH: number, keepAspect: boolean,
): Rect {
  const right = start.x + start.width
  const bottom = start.y + start.height
  let x = start.x, y = start.y, w = start.width, h = start.height

  if (handle.includes('w')) { x = clamp(start.x + dx, 0, right - MIN_REGION); w = right - x }
  if (handle.includes('e')) { w = clamp(start.width + dx, MIN_REGION, layoutW - start.x) }
  if (handle.includes('n')) { y = clamp(start.y + dy, 0, bottom - MIN_REGION); h = bottom - y }
  if (handle.includes('s')) { h = clamp(start.height + dy, MIN_REGION, layoutH - start.y) }

  if (keepAspect && handle.length === 2) {
    const ratio = start.width / start.height || 1
    // Führende Achse = die mit der größeren relativen Änderung.
    const relW = Math.abs(w - start.width) / start.width
    const relH = Math.abs(h - start.height) / start.height
    if (relW >= relH) {
      h = clamp(Math.round(w / ratio), MIN_REGION, layoutH)
      if (handle.includes('n')) y = clamp(bottom - h, 0, bottom - MIN_REGION)
    } else {
      w = clamp(Math.round(h * ratio), MIN_REGION, layoutW)
      if (handle.includes('w')) x = clamp(right - w, 0, right - MIN_REGION)
    }
    // Nach Aspekt-Korrektur erneut in die Layoutgrenzen zwingen.
    if (x + w > layoutW) w = layoutW - x
    if (y + h > layoutH) h = layoutH - y
  }
  return { x, y, width: w, height: h }
}

/** Resize-Snapping: nur die aktiv gezogenen Kanten rasten ein. */
export function snapResize(
  handle: Handle, rect: Rect, targets: { vx: number[]; hy: number[] }, tol: number,
): { rect: Rect; guidesV: number[]; guidesH: number[] } {
  let { x, y, width: w, height: h } = rect
  const guidesV: number[] = [], guidesH: number[] = []
  const right = x + w, bottom = y + h

  if (handle.includes('w')) {
    const s = bestSnap([x], targets.vx, tol)
    if (s) { const nx = x + s.delta; if (right - nx >= MIN_REGION) { x = nx; w = right - x; guidesV.push(s.line) } }
  }
  if (handle.includes('e')) {
    const s = bestSnap([right], targets.vx, tol)
    if (s) { const nr = right + s.delta; if (nr - x >= MIN_REGION) { w = nr - x; guidesV.push(s.line) } }
  }
  if (handle.includes('n')) {
    const s = bestSnap([y], targets.hy, tol)
    if (s) { const ny = y + s.delta; if (bottom - ny >= MIN_REGION) { y = ny; h = bottom - y; guidesH.push(s.line) } }
  }
  if (handle.includes('s')) {
    const s = bestSnap([bottom], targets.hy, tol)
    if (s) { const nb = bottom + s.delta; if (nb - y >= MIN_REGION) { h = nb - y; guidesH.push(s.line) } }
  }
  return { rect: { x, y, width: w, height: h }, guidesV, guidesH }
}

export function round(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
}
