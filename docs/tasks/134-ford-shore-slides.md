# Task 134 — River-ford pathfinding: beaching fix

Ordered armor on "River Crossing" used to grind to a halt at the ford edges:
the waypoint overlay showed a correct route through the crossing, but hulls
parked nose-on mid-river and never arrived (reproduced on seed 7, where a
stump sat 59 units from its waypoint forever). Two compounding causes, both
fixed:

1. String-pulling threaded water corners. `hasLineOfSight` only probes
   sampled cells, so a smoothed leg could pass ~9 world units from a blocked
   cell's center without sampling it (the ford's feathered edge leaves
   1-cell-wide shallows strips at exactly the walkability threshold, ideal
   corner-graze material). Smoothing now also refuses legs passing within
   `BLOCKED_KEEPOUT` (14, one arrival radius) of any unwalkable cell center
   (`legClipsBlocked`, mirroring `legClipsTrunk`), while legs down a
   shoreline lane or a one-wide ford (16 clearance) still smooth.
2. Beached ordered hulls never recovered. Hulls home on waypoints with
   arrival slop rather than tracking legs, so even a legal leg can end with
   the hull nosed onto water and its waypoint across it — and orders never
   skip, so the grind was permanent. A beached ordered hull now fans nearby
   headings (`SHORE_SLIDE_FAN`, ±15°…±90°) and edges around the water. Only
   ordered hulls fan, and only off wet ground: patrol keeps hold-then-skip
   (its straight legs cut across bays), and steep blocks keep the honest
   "can't climb that" hold. Slides accrue `stuck` — including ordered steps
   taken more than 60° off the waypoint, which are wall-weaving rather than
   progress — so a truly unreachable goal holds beached past patience
   instead of hiking the coast forever.

## Decisions

- Keepout 14, not a full cell: corner grazes sit at ≤11.3 (half a cell
  diagonal) while beach-parallel legs sit at 16, so 14 refuses every corner
  cut and keeps shoreline smoothing. It doubles as the arrival-slop bound
  (not imported — same barrel-cycle comment pattern as the other constants).
- Fan, don't repath: a local heading fan is deterministic, turn-limited
  (hull always faces travel), and bounded; repathing around a 1-cell corner
  would churn orders for every slop deviation.
- Wet vs steep split (`destinationTooWet`): the pinned steep-wall test
  (ordered hull pins X/Z exactly into a wall) forbids sliding off cliffs,
  so only dry-gate refusals fan. Grade-only refusals hold like steep.
- The 60°-misalignment accrual rule came from a real failure: the first fan
  fought homing into a pacing equilibrium (direct shore-hugging steps kept
  clearing `stuck`), so the give-up never fired. Misaligned ordered steps
  now accrue; patrol/pursuit still always clear.
- No map-generation change: the ford feathering is fine once legs keep
  clearance and hulls can round corners. No README change: bug fix, no
  architecture or user-facing control change.

## Files

- `packages/core/src/units/pathfinding.ts` — `BLOCKED_KEEPOUT`,
  `legClipsBlocked`, wired into `smoothCellPath`.
- `packages/core/src/units/terrain.ts` — `destinationTooWet` (dry-gate vs
  slope-gate refusal).
- `packages/core/src/units/movement.ts` — `SHORE_SLIDE_FAN` + fan branch in
  `driveToward`, misalignment accrual, shared `fellTreesOnStep` helper.
- Tests: `pathfinding.test.ts` (corner-graze flag + smoothing refusal),
  `movement.test.ts` (pond rounding, unreachable give-up, patrol still
  skips at water), `terrain.test.ts` (`destinationTooWet`), and
  `battleMaps.test.ts` (driven west→east ford crossing on seeds 1, 7,
  0xa11ce — the seed-7 stall is the exact reported bug).
- `.changeset/ford-shore-slides.md` (patch), `docs/tasks/134-*` (this
  writeup).

## Verification

- New tests fail pre-fix (6 failures on stashed sources: the smoothing,
  fan, give-up, wet/steep, and driven-ford cases), pass post-fix.
- Opposing 6v6 group crossings through the fords on seeds 0–20: 12/12
  arrive on every seed (scratch probe, since removed).
- `yarn typecheck` — 3 tasks successful.
- `yarn test` — core 24 files / 573 tests pass; web 40 files / 616 tests
  pass.
