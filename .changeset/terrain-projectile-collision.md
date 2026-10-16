---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Projectiles no longer fly through terrain: every flight is swept against the live surface (mid-flight rounds detonate on the dirt they hit), obstructed guns hold fire instead of shooting through hillsides — shells lob the high arc over a ridge when it clears — and a blocked unit repositions toward its target (higher vantage or closer) through the pursuit drive rather than firing through the hill.

## Task writeup (moved from docs/tasks/81-terrain-projectile-collision.md)

# Task 81 — Projectiles collide with terrain, blocked guns reposition

Shots used to fly their analytic arc straight to the aimed impact with only
a tree check mid-flight, so any ridge between muzzle and target let the round
visibly pass through the hillside — and guns happily fired through hills
since nothing ever gated the trigger on terrain. Both halves are fixed.

## Decision: sweep every flight against the live surface (core math)

New pure helpers in `packages/core/src/units/combat.ts` (mirroring the
`flightClearsTrees` naming):

- `flightTerrainHit(start, velocity, gravity, t0, t1, groundY)` marches the
  analytic arc over the window at ≤`TERRAIN_SAMPLE_STEP` (8 units) arc-length
  steps and bisects the first below-surface sample back to the contact face
  (`TERRAIN_REFINE_STEPS` passes, `TERRAIN_GRAZE` = 2 units of grace so
  honest crest-skimmers don't read as hits on sampling noise). Returns the
  contact time + point, or null.
- `flightClearsTerrain(...)` is the full-flight boolean twin (degenerate
  durations read as clear).

Step count derives from mean speed over the window (gravity bleed included),
capped at `TERRAIN_MAX_SAMPLES` — a 1300 u/s bolt in one long tick still
samples every ~8 units, so tunneling is impossible by construction.

## Decision: hold fire into a hill, lob over it, reposition (renderer + AI)

`apps/web/src/renderer/combatFx.ts`:

- Fire-time admission (`launchShot`): when the solved round would hit dirt,
  shells try the high ballistic root when it clears wood *and* dirt inside
  the lob time cap (barrel re-aimed); anything still blocked holds fire.
  Headless (no env surface) keeps legacy behavior.
- In-flight safety net (`advanceShots`): the flown arc window is swept every
  tick — a round whose hill rose under it (dents, exaggeration changes)
  detonates on the contact face with the full arrival stack (splash, scorch,
  structures) instead of passing through.
- New `onObstructedShot(attacker, target, x, z)` hook per hold-fire
  (target −1 for structures).

Repositioning rides the existing retaliation pursuit pipeline (stand-off
hold, disengage/leash/expiry, player-orders-win) via a new core
`seekEngage` (`retaliation.ts`): same authority rules as `notifyThreat`
*except* no engage-radius gate — a gun in admitted range behind a ridge must
still close. `attacker` is the target index (−1 for HQs, driving on
last-known position); live memories refresh in place preserving a hunt
leash. `UnitMovement.seekEngage` + the canvas wiring (`TerrainCanvas.tsx`)
close the loop: blocked hulls advance toward their target — climbing the
grade under the same slope-gated drive — instead of shooting through it.
Cross-map leash still applies (local repositioning only).

## What changed

- `packages/core/src/units/combat.ts`: terrain-collision section
  (`TERRAIN_SAMPLE_STEP/GRAZE/REFINE_STEPS/MAX_SAMPLES`, `TerrainHit`,
  `flightTerrainHit`, `flightClearsTerrain`).
- `packages/core/src/units/retaliation.ts`: `seekEngage`.
- `apps/web/src/renderer/combatFx.ts`: terrain admission in `launchShot`
  (+ high-root fallback), per-tick terrain sweep in `advanceShots`,
  `onObstructedShot` hook.
- `apps/web/src/renderer/movement.ts`: `seekEngage` method.
- `apps/web/src/renderer/TerrainCanvas.tsx`: `onObstructedShot` →
  `movement.seekEngage` wiring.

## Tests

- Core `combat.test.ts` (+6): flat clears, ridge-face contact, no tunneling
  at 1300 u/s in one window, shell lob clears what the flat root hits,
  skimmer/grazer grace boundary, degenerate windows.
- Core `retaliation.test.ts` (+6): seek past the engage gate, structure
  (−1) seeks, orders/hold refusal, leash refusal, live-memory refresh
  preserving hunt leash, invalid inputs.
- Web `combatFx.test.ts` (+3): hold-fire into a ridge (zero rounds +
  obstruction reports naming the cross-team pair/target), mid-flight
  detonation when terrain rises under a live round (all blasts short of the
  far hull), hammer-vs-hammer lob over a ridge (near-vertical barrels,
  arrivals past the ridge, zero hold-fires).
- Web `retaliation.test.ts` (+2): `seekEngage` records + drives closer,
  orders/self/wreck refusal.

## Verification

`yarn typecheck`, `yarn test` (core 22 files / 442 tests, web 32 files /
392 tests), `yarn build` — all green.
