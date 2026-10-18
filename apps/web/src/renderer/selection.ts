/**
 * RTS selection semantics: click / shift-click / drag-box over projected
 * unit screen positions. Framework-free and camera-independent — the canvas
 * projects world positions to pixels and these helpers resolve the
 * selection as sorted index lists, so vitest covers them without WebGL.
 *
 * Nanolathe parallel (adapted — retail routes its input pump through a
 * single-click path, a drag-rectangle path, and a commit/toggle truth
 * table driven by bit 2 of the drag parameter word with Shift as the
 * toggle source, `04-units-orders-scripts-and-movement.md` §3.7 "drag
 * selection and overlap picking" / "toggle and commit modifiers"): the
 * same three paths exist here — `pickNearest` (single click, nearest
 * within a pixel radius so overlapping units pick the front-most one),
 * `boxPick` (drag rectangle over projected points), and Shift choosing
 * toggle/extend versus replace in `clickSelect` / `boxSelect`.
 *
 * Deliberate deviation: retail issues every world command (including
 * moves) with the LEFT button and reserves right-click for cancel /
 * deselect. Here left-drag orbits the camera (OrbitControls), so move
 * orders go on RIGHT-click (no drag) while right-drag keeps panning —
 * documented in the HUD footer and the task writeup.
 */

/** A projected unit position in canvas pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Click-vs-drag disambiguation threshold, in pixels. */
export const CLICK_DRAG_PX = 6;
/** Selection pick radius around a click, in pixels. */
export const PICK_RADIUS_PX = 28;

/**
 * Nearest projected unit to a click within `radius` pixels, or null.
 * Ties (overlapping projections) break toward the lowest index so picks
 * are deterministic.
 */
export function pickNearest(
  points: readonly ScreenPoint[],
  click: ScreenPoint,
  radius = PICK_RADIUS_PX,
): number | null {
  let best: number | null = null;
  let bestD = radius;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const d = Math.hypot(p.x - click.x, p.y - click.y);
    if (d <= bestD && (best === null || d < bestD)) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Normalize a drag rect so x0 <= x1 and y0 <= y1 (drag any direction). */
export function normalizeRect(a: ScreenPoint, b: ScreenPoint): ScreenRect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** Indices of all projected units inside a (normalized) drag rect. */
export function boxPick(points: readonly ScreenPoint[], rect: ScreenRect): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1) out.push(i);
  }
  return out;
}

/**
 * Single-click selection: empty space clears (or keeps, when additive),
 * a hit replaces the selection, or toggles that unit when additive
 * (shift-click). Always returns a sorted list.
 */
export function clickSelect(
  current: readonly number[],
  hit: number | null,
  additive: boolean,
): number[] {
  if (hit === null) return additive ? [...current].sort((a, b) => a - b) : [];
  if (additive) {
    const set = new Set(current);
    if (set.has(hit)) set.delete(hit);
    else set.add(hit);
    return [...set].sort((a, b) => a - b);
  }
  return [hit];
}

/**
 * Selected members hostile to `target`: live across team lines from it, in
 * selection order. Same-team members, the target itself, and unknown sides
 * sit out — only guns that may legally fire take an attack order.
 */
export function hostileMembers(
  selection: readonly number[],
  target: number,
  teamAt: (index: number) => number | undefined,
): number[] {
  const foeSide = teamAt(target);
  if (foeSide === undefined) return [];
  return selection.filter((index) => {
    if (index === target) return false;
    const side = teamAt(index);
    return side !== undefined && side !== foeSide;
  });
}

/**
 * Right-click order resolution: a click on a live enemy of the selection is
 * an attack order on that unit, anything else (empty ground, a selected
 * unit, a friendly, an unknown side) is a move order to the clicked point.
 * The canvas resolves the clicked unit first (raycast, else the nearest
 * projection) and passes its roster index as `hit`, or null for ground.
 */
export function resolveRightClick(
  selection: readonly number[],
  hit: number | null,
  teamAt: (index: number) => number | undefined,
): { kind: "attack"; target: number } | { kind: "move" } {
  if (hit === null || selection.includes(hit)) return { kind: "move" };
  if (hostileMembers(selection, hit, teamAt).length === 0) return { kind: "move" };
  return { kind: "attack", target: hit };
}

/**
 * Drag-box selection: replace the selection, or union with it when
 * additive (shift-drag). Always returns a sorted list.
 */
export function boxSelect(
  current: readonly number[],
  hits: readonly number[],
  additive: boolean,
): number[] {
  if (!additive) return [...hits].sort((a, b) => a - b);
  const set = new Set(current);
  for (const h of hits) set.add(h);
  return [...set].sort((a, b) => a - b);
}
