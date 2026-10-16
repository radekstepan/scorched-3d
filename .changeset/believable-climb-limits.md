---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Believable climb physics and a gentler default height scale: the shared climb gate tightens from 24 to the retail-tank 15 (hulls refuse volcanic-cone grades they used to scale, A* routes around them, placement and patrol waypoints never sit above the gate, rough-terrain cost tiers rescale below it), hull pitch/roll slews toward the grade seat instead of snapping, and new maps open at 2.0x height scale instead of 3.6x.

## Task writeup (moved from docs/tasks/22-believable-climb-limits.md)

# Task 22 — Believable climb physics + smaller height scale

Two complaints, one root cause each. Hulls scaling cliffs: the shared climb
gate `PATH_MAX_SLOPE` sat at 24 raw height units per cell edge (grade 1.5,
~56° raw, ~79° rendered at the old exaggeration), far above anything retail
allows — stock tank movement classes block past `MaxSlope` 15
(`TANKSH`/`TANKBH`; nanolathe `04-units-orders-scripts-and-movement.md`
§R-DOC04). And the towering relief read: new maps opened at 3.6× height
exaggeration, which multiplied every grade nearly fourfold on screen.

Fix (old → new):

- Climb gate 24 → 15 (`pathfinding.ts` `PATH_MAX_SLOPE`, with the retail
  citation in the doc comment). The single constant drives `isWalkable`,
  the drive clamp (`MAX_DRIVE_GRADE` 1.5 → 15/16 ≈ 0.94), relaxed placement
  (`RELAXED_SLOPE` 24 → 15, so spawns always sit on legally standable
  ground), and patrol waypoints (`ROUTE_MAX_SLOPE` 24 → 15) — a leg the
  pathfinder blesses still never reads as blocked. Strict placement (12)
  already sat below the new gate, untouched.
- Rough-terrain cost tiers rescaled below the gate (8/14/20 → 5/9/12,
  ~1/3–4/5 of 15; the old top band is now unwalkable ground and never
  reaches costing). The octile heuristic stays admissible (minimum cell
  cost still 1); retail's `BadSlope` ≈ `MaxSlope`/2 soft-tier parallel is
  noted in the comment.
- Grade drag needs no retune: the same linear curve to `ROUGH_SLOPE_FLOOR`
  now bites harder in absolute terms (a grade that read "half" now reads
  "four-fifths"), and the at-gate climb rides exactly on the floor.
- Tilt smoothing (new `terrain.ts` `HULL_TILT_SLEW` 2 rad/s + pure
  `slewTilt`): the renderer slews posed pitch/roll toward the grade seat
  per tick instead of snapping, so cresting a ridge settles like
  suspension (~0.25 s for a full swing); height still applies instantly so
  tracks never float, and exaggeration re-snaps land exactly. `MAX_HULL_TILT`
  (0.5 rad) unchanged — already sane.
- Default height scale 3.6 → 2.0 (`App.tsx`; slider range untouched, so the
  tall look stays one drag away). Crater-depth comments updated to the new
  default (~2 world units per blast).

Important decisions: `generate.ts` amplitudes deliberately untouched —
measured relief shows cell slopes are already gentle almost everywhere
(max 8–17 raw outside archipelago's cones; 90%+ of dry cells walkable at
gate 15), so the exaggeration multiplier, not the heightfield, was the
"too tall" culprit; every seeded map regenerates byte-identically, and no
placement/patrol snapshot churned. Scorch stays visual-only for pathing
and crater dents stay mesh-only (Tasks 2/5 guarantees kept). The roster
keeps one shared movement profile (tanks + commander climb like retail
tanks) rather than per-kind gates — determinism over nuance, as before.

Tests: `terrain.test.ts` re-pins the gate (15/16), adds the retired-band
refusal (20-grade blocked, 15-grade boundary passes), at-gate drag == floor,
and `slewTilt` step/hold/snap/settle cases; `pathfinding.test.ts` pins the
15-gate, cone-grade refusal vs boundary pass, and the 5/9/12 cost tiers with
walkability handoff at 15/16; `movement.test.ts` waypoint pin 24 → 15;
web `movement.test.ts` asserts tilt slews partway per tick and lands
exactly on resnap. Real-map suites (smoothed legs off steep ground on all
four presets, patrol clamp/skip, formation fan-out) still pass with the
tighter gate — archipelago keeps 90% walkable dry ground, so routes,
A* paths, and fan-out stay connected. `yarn typecheck` and `yarn test`
pass (184 core + 133 web tests).
