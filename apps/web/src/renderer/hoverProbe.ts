// Hover-probe gate for the terrain canvas.
//
// Symptom: parking or moving the cursor over the canvas cost ~50 fps
// (120 → ~70). Two hot loops fed it, both in the render tick: a full-mesh
// raycast against the 320×256 terrain (~163k triangles, no BVH) every frame
// while the pointer was over the canvas, plus a React setState → full App
// re-render on every one of those frames — even with the cursor parked.
//
// The gate fixes both with behavior-identical output:
// - pointermove only records the latest client coords and marks the probe
//   dirty (no getBoundingClientRect in the event handler, so no per-event
//   layout read; rapid moves coalesce into one probe per tick);
// - the tick probes at most once, and only when dirty — a fresh pointer
//   position, or camera motion under a parked cursor (OrbitControls
//   'change', keyboard pan, minimap jump, exaggeration re-snap all funnel
//   through `cameraMoved`);
// - emission is deduped on the sampled cell: the same cellX/cellZ (or both
//   null) never re-fires onHover, so React only re-renders when the probe
//   readout actually changes.
//
// Kept free of three.js and React so it stays unit-testable in a node
// environment, mirroring fps.ts / minimap.ts.

import type { HoverInfo } from "@scorched-3d/core";
import { CELL_PIXELS, worldHeight } from "@scorched-3d/core";

export interface HoverPoint {
  x: number;
  y: number;
}

export interface HoverGate {
  /** Record a pointer position; marks the probe dirty (last move wins). */
  move: (clientX: number, clientY: number) => void;
  /** Pointer left the canvas; drops any pending probe. */
  leave: () => void;
  /** Camera moved under a parked cursor; re-probe the stored position. */
  cameraMoved: () => void;
  /**
   * Take the pending probe point, or null when there is nothing new to
   * sample (pointer outside, or nothing changed since the last probe).
   * Consumes the dirty flag: at most one probe per call sequence, so any
   * number of pointermoves between ticks collapses into a single raycast.
   */
  takeProbe: () => HoverPoint | null;
  /** True while the pointer is over the canvas (probe position stored). */
  readonly inside: () => boolean;
}

/**
 * Stable identity for a probe result: the readout only depends on the
 * sampled cell (all displayed fields derive from it), so the tick skips
 * onHover entirely when the key matches the last emission.
 */
export function hoverInfoKey(info: HoverInfo | null): string {
  if (!info) return "null";
  return `${info.cellX},${info.cellZ}`;
}

export function createHoverGate(): HoverGate {
  let inside = false;
  let dirty = false;
  let x = 0;
  let y = 0;

  return {
    move(clientX: number, clientY: number): void {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      inside = true;
      dirty = true;
      x = clientX;
      y = clientY;
    },
    leave(): void {
      inside = false;
      dirty = false;
    },
    cameraMoved(): void {
      if (inside) dirty = true;
    },
    takeProbe(): HoverPoint | null {
      if (!inside || !dirty) return null;
      dirty = false;
      return { x, y };
    },
    inside(): boolean {
      return inside;
    },
  };
}

// ---------------------------------------------------------------------------
// Math terrain pick: ray vs heightfield march.
//
// Follow-up to the hover gate above. The gate killed the parked-cursor cost
// (zero raycasts while still), but sweeping the cursor still dipped fps
// 120 → ~80: every motion frame paid a full-mesh three.js raycast against
// the 320×256 terrain (~163k triangles, no BVH) plus a getBoundingClientRect
// layout read, and every cell change re-rendered React.
//
// This replaces the per-probe mesh raycast with an analytic march over the
// same heightfield the mesh is built from (corner heights × worldHeight at
// the live exaggeration — the exact surface hitToInfo samples, minus crater
// dents, which the readout ignores anyway):
// - the ray is clipped to the map bounding box first, so a miss pointing
//   away from the map costs zero height samples;
// - inside the box, a fixed coarse march (HOVER_MARCH_STEPS bilinear taps)
//   finds the first above→below crossing, then bisection refines it
//   (HOVER_REFINE_STEPS taps). Worst case ≈ 400 height taps per probe vs
//   ~163k triangle tests — same cell in practice, ~400× less work, zero
//   allocations, no three.js dependency (stays unit-testable in node).
// ---------------------------------------------------------------------------

/** Minimal heightfield view the math pick needs (TNTMap satisfies this). */
export interface PickField {
  readonly width: number;
  readonly height: number;
  readonly heights: ArrayLike<number>;
}

/** World-space terrain hit, matching the mesh surface hitToInfo samples. */
export interface TerrainHit {
  x: number;
  y: number;
  z: number;
}

/** Coarse crossing-search taps per probe (fixed: deterministic cost). */
export const HOVER_MARCH_STEPS = 384;
/** Bisection refinement taps per probe (fixed: deterministic cost). */
export const HOVER_REFINE_STEPS = 24;
/** Hard bound on height taps per pickTerrainPoint call. */
export const HOVER_MAX_SAMPLES = 1 + HOVER_MARCH_STEPS + HOVER_REFINE_STEPS + 1;

/** Optional tap counter for tests: filled with the height-sample count. */
export interface PickStats {
  samples: number;
}

function pickGroundY(field: PickField, exaggeration: number, x: number, z: number): number {
  const w = field.width;
  const h = field.height;
  const fx = x / CELL_PIXELS + (w - 1) / 2;
  const fz = z / CELL_PIXELS + (h - 1) / 2;
  const x0 = Math.min(Math.max(Math.floor(fx), 0), w - 2);
  const z0 = Math.min(Math.max(Math.floor(fz), 0), h - 2);
  const tx = Math.min(Math.max(fx - x0, 0), 1);
  const tz = Math.min(Math.max(fz - z0, 0), 1);
  const h00 = field.heights[z0 * w + x0] ?? 0;
  const h10 = field.heights[z0 * w + x0 + 1] ?? 0;
  const h01 = field.heights[(z0 + 1) * w + x0] ?? 0;
  const h11 = field.heights[(z0 + 1) * w + x0 + 1] ?? 0;
  const raw = h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  return worldHeight(raw, exaggeration);
}

/**
 * Intersect a world-space ray with the terrain heightfield. The direction
 * need not be normalized. Returns the first above→below crossing, or null
 * when the ray misses the map box or starts below the surface (the camera
 * can never be underground, and the old front-face mesh raycast hit nothing
 * from inside either). Deterministic: bounded by HOVER_MAX_SAMPLES taps.
 */
export function pickTerrainPoint(
  field: PickField,
  exaggeration: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  stats?: PickStats,
): TerrainHit | null {
  const halfW = ((field.width - 1) / 2) * CELL_PIXELS;
  const halfD = ((field.height - 1) / 2) * CELL_PIXELS;
  const yHi = worldHeight(255, exaggeration) + 64;
  const yLo = -256;
  // Slab-clip the ray to the map box; a miss here costs zero height taps.
  let tEnter = 0;
  let tExit = Infinity;
  const clip = (o: number, d: number, lo: number, hi: number): boolean => {
    if (d === 0) return o >= lo && o <= hi;
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) {
      const t = t0;
      t0 = t1;
      t1 = t;
    }
    if (t0 > tEnter) tEnter = t0;
    if (t1 < tExit) tExit = t1;
    return tEnter <= tExit;
  };
  if (!clip(ox, dx, -halfW, halfW)) return null;
  if (!clip(oz, dz, -halfD, halfD)) return null;
  if (!clip(oy, dy, yLo, yHi)) return null;
  if (!(tExit > tEnter) || !Number.isFinite(tExit)) return null;

  let samples = 0;
  const groundAt = (t: number): { y: number; gy: number } => {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const gy = pickGroundY(field, exaggeration, x, z);
    samples++;
    return { y, gy };
  };

  const first = groundAt(tEnter);
  if (first.y <= first.gy) return null;
  let prevT = tEnter;
  let prevAbove = true;
  for (let i = 1; i <= HOVER_MARCH_STEPS; i++) {
    const t = tEnter + ((tExit - tEnter) * i) / HOVER_MARCH_STEPS;
    const cur = groundAt(t);
    if (cur.y <= cur.gy && prevAbove) {
      // Bisect the bracket for the surface crossing.
      let lo = prevT;
      let hi = t;
      for (let r = 0; r < HOVER_REFINE_STEPS; r++) {
        const mid = (lo + hi) / 2;
        const m = groundAt(mid);
        if (m.y <= m.gy) hi = mid;
        else lo = mid;
      }
      const ht = (lo + hi) / 2;
      const end = groundAt(ht);
      if (stats !== undefined) stats.samples = samples;
      return { x: ox + dx * ht, y: end.gy, z: oz + dz * ht };
    }
    prevAbove = cur.y > cur.gy;
    prevT = t;
  }
  if (stats !== undefined) stats.samples = samples;
  return null;
}
