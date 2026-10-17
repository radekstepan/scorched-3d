import type { DamageField, TreeStand } from "@scorched-3d/core";

/**
 * Per-tick tree-stands snapshot, shared by the occlusion x-ray, combat
 * tree-interception, and hunt visibility — one build per invalidation
 * instead of one per tick.
 *
 * A stand is pure derived state: the tree's fixed X/Z, its live `groundY`
 * height (which moves only when craters dent the dirt or the exaggeration
 * re-snaps), and whether its damage state still stands (intact, burning,
 * or smouldering — ignitions and smoulder entries never flip it). So the
 * snapshot is rebuilt lazily on first read after `dirty()` and shared by
 * identity until the next invalidation: quiet ticks cost zero probes for
 * ~15k Ashen Pass trees instead of ~15k `groundY` calls each, and ticks
 * with mid-tick fells rebuild exactly once on the next read (the old
 * per-tick null-out rebuilt twice on crush ticks: once in movement, once
 * in occlusion).
 *
 * Invalidation is caller-owned: every mutation that can flip `standing`
 * (blast flattens, hull crushes, burn resolutions — see the canvas
 * `dirtyStands` sites) or move heights (crater dents, exaggeration
 * re-snaps) must dirty. The returned array is shared while clean and must
 * not be mutated (callers already treat stands as readonly).
 */
export class StandsCache {
  private points: readonly { x: number; z: number }[];
  private field: DamageField;
  private groundY: (x: number, z: number) => number;
  private snapshot: TreeStand[] | null = null;

  constructor(
    points: readonly { x: number; z: number }[],
    field: DamageField,
    groundY: (x: number, z: number) => number,
  ) {
    this.points = points;
    this.field = field;
    this.groundY = groundY;
  }

  /** Current snapshot, rebuilt lazily after the last `dirty()`. */
  get(): TreeStand[] {
    return (this.snapshot ??= this.build());
  }

  /** Invalidate: the next `get()` rebuilds from live field + heights. */
  dirty(): void {
    this.snapshot = null;
  }

  private build(): TreeStand[] {
    return this.points.map((p, fid) => {
      const state = this.field.trees[fid] ?? "intact";
      return {
        x: p.x,
        z: p.z,
        groundY: this.groundY(p.x, p.z),
        standing: state === "intact" || state === "burning" || state === "smouldering",
      };
    });
  }
}
