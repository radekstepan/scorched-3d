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
