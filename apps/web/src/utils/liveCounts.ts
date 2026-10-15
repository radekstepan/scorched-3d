import { UNIT_KINDS, type PlacedUnit, type UnitKind } from "@scorched-3d/core";

/** Minimal live-broadcast shape (`TerrainCanvas` `onPositions` entries). */
export interface LiveUnitState {
  alive: boolean;
}

/**
 * Live per-kind hull counts in `UNIT_KINDS` order (commander … peewee).
 *
 * A roster entry reads alive when its broadcast slot is missing (pre-first
 * broadcast) or reports `alive !== false`; wrecks (`alive === false`) are
 * excluded. Spawned reinforcements share the same index space — `placed`
 * grows via `TerrainCanvas.onSpawn` while `live` broadcasts from
 * `movement.positions()` — so appended slots count once both arrays cover
 * them, and a short `live` array treats the tail as alive.
 */
export function countLiveUnitsByKind(
  placed: Pick<PlacedUnit, "kind">[],
  live: readonly LiveUnitState[] | undefined,
): Record<UnitKind, number> {
  const counts: Record<UnitKind, number> = {
    commander: 0,
    stump: 0,
    flash: 0,
    hammer: 0,
    peewee: 0,
  };
  placed.forEach((u, i) => {
    if (live?.[i]?.alive === false) return;
    counts[u.kind] += 1;
  });
  return counts;
}

/** Live counts as an ordered [kind, count] list (commander first, peewee last). */
export function liveCountsOrdered(
  placed: Pick<PlacedUnit, "kind">[],
  live: readonly LiveUnitState[] | undefined,
): [UnitKind, number][] {
  const counts = countLiveUnitsByKind(placed, live);
  return UNIT_KINDS.map((k) => [k, counts[k]]);
}
