---
"@scorched-3d/core": patch
---

Units move noticeably faster overall, especially through rough terrain and woods: base speeds up ~25% per kind, slope/tree/rock/crush drags lightened (worst grade keeps 60% pace, canopy brush 75%, fresh crush lanes 40%), crowd crawl raised to 50% with a faster separation shove to match, and slightly quicker hull turn rates. Kind ordering, crush-vs-brush labouring, and separation/no-deadlock guarantees are unchanged.

## Task writeup (moved from docs/tasks/91-faster-movement.md)

# Task 91 — Faster unit movement, especially through rough terrain and woods

## What changed

Base speeds up, penalties down (`packages/core/src/units/movement.ts`,
`terrain.ts`, `facing.ts`). Ordering and balance invariants preserved:
peewee > flash > stump > commander > hammer; crush still slower than canopy
brush; separation still outruns the ordered floor drive.

- `MOVE_SPEED`: flash 58 → 72 (+24%), stump 40 → 50 (+25%), commander
  32 → 40 (+25%), hammer 26 → 34 (+31%), peewee 64 → 80 (+25%).
- Rough drags (`terrain.ts`): `ROUGH_SLOPE_FLOOR` 0.45 → 0.6 (worst legal
  grade keeps 60% pace, +33% relative), `TREE_DRAG` 0.6 → 0.75 (+25%),
  `ROCK_DRAG` 0.5 → 0.65 (+30%), `CRUSH_DRAG` 0.25 → 0.4 (+60% on fresh
  forest lanes — still well below canopy brush, so first passes labour and
  second passes over felled lanes ride lighter, as before).
- Crowd (`movement.ts`): `SLOW_SCALE` 0.35 → 0.5 (convoys crawl 43%
  faster); `SEPARATION_SPEED` 22 → 30 so the shove still beats the fastest
  ordered floor drive (80 × 0.3 = 24) and head-on pairs open instead of
  stacking. `ORDER_SPACING_FLOOR` stays 0.3.
- `HULL_TURN_RATE` (+0.2 per kind, peewee 2.6 → 2.7): hulls spend less time
  grip-limited in corners, so effective trip times drop by more than the
  straight-line ratios. Every turret slew rate still exceeds its hull rate
  (peewee 2.8 > 2.7 is the tightest), so aim hierarchy is untouched.
- `TRUNK_PUSH_SPEED` 30 → 36 (`terrain.ts`): stays faster than the new
  separation shove so spawns parked on trunks still ease out promptly.
- Tests: `facing.test.ts` small-boresight case now derives its bound from
  `HULL_TURN_RATE` instead of a hardcoded 1.5; `terrain.test.ts` crush
  pin updated (0.4 < 0.75 < 1); `movement.test.ts` gains a `faster
  movement tune` block (kind ordering + minimums, separation-beats-floor
  invariant, flat 400 u covered in 360 ticks, ramp keeps >55% of flat
  pace, canopy drag value pin).
- `.changeset/faster-unit-movement.md` (new) — **patch** for core.

## Decisions

**Lift everything, don't just cut the woods penalty.** The complaint was
overall slowness with woods/rough worst; raising base speeds and cutting
every drag together keeps the *relative* cost of terrain (route-around vs
plough-through decisions, pathfinder cost tiers) while making the whole
game feel brisker.

**Kept the crush-vs-brush gap, narrowed.** 0.25 → 0.4 closes the
fresh-lane crawl from 0.15× to 0.30× open pace (× canopy 0.75) — still a
clear labouring read, and lanes stay felled so repeat traffic rides free
of crush drag. Separation never fells (unchanged).

**Kept `ORDER_SPACING_FLOOR` at 0.3.** Raising it with the new speeds
would have erased the separation margin (80 × 0.35 = 28 vs shove 30);
leaving it keeps a comfortable 30 > 24 gap with no behaviour change.

## Verification

- `yarn workspace @scorched-3d/core test --run` — 22 files, 467 tests pass.
- `yarn typecheck` — 3 tasks successful.
- `yarn test` (all) — one failure in
  `apps/web/src/renderer/combatFx.test.ts > dead hulls stop firing and stop
  drawing fire`, confirmed pre-existing by stashing and re-running on clean
  main (same test fails there); unrelated to movement.
- Playwright not run (per task rules).
