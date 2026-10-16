---
"@scorched-3d/core": patch
---

Wider combat spacing so brawls share less splash damage

## Task writeup

Units in a big fight stacked hull-to-hull: the mutual spacing stop sat at 30 units while every tank splash reaches 36–64, so each shell landing on one hull dealt a third to a half of its damage to every neighbour too. The hold now parks neighbours at 48 — exactly outside the heaviest bolt splash — so a brawl shares hammer fringe at most. Nothing else in the AI moves: same stop/crawl/separate machinery, same stand-offs, same sweep.

## What changed

- `packages/core/src/units/movement.ts`: `STOP_RADIUS` 30 → 48 (`SEPARATION_RADIUS` follows by definition, keeping the `SEPARATION_RADIUS === STOP_RADIUS` invariant). At 48 a neighbour eats zero of any bolt blast (commander boundary scores zero) and a quarter of a hammer shell instead of half. `SLOW_RADIUS` stays 72 — the crawl band only paces approaches, and widening it would slow convoys without adding gap.
- `packages/core/src/units/pathfinding.ts`: `FORMATION_MIN_SEPARATION` 40 → 56, keeping the documented contract (goals wider than the spacing stop so arrivals hold their fan instead of jostling). 56 matches `PATH_FORMATION_SPACING`, so geometric ring neighbours already satisfy it.
- Tests: `spacingScale` pins the new stop/crawl boundary (40 stops, exactly-48 crawls); a doctrine test pins `STOP_RADIUS` against every bolt `BLAST_RADIUS`; a holders integration test settles two parked hulls and asserts the gap clears stump splash; a cross-module contract test pins `FORMATION_MIN_SEPARATION > STOP_RADIUS` (pathfinding cannot import movement, so the test holds the invariant).

## Decisions

- Global retune over combat-only spacing: per-mover (engaged vs idle) radii would need asymmetric pairwise gates in both `spacingScale` and `separationVector`, a bigger diff with new edge cases for what the task calls "a bit more gap". The uniform 48 keeps every resolution symmetric and deterministic, and ordered arrivals still close via the existing floor + goal-strip logic (proven by the untouched arrival tests).
- 48, not full hammer immunity (64): a 64 hold would gridlock fights and formation fans. Halving shared hammer damage while zeroing all bolt sharing is the asked-for gap without breaking AI flow.
