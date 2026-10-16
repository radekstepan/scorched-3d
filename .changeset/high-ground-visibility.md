---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Terrain-aware visibility: units on high ground spot enemies farther, ridges and mountains block sight entirely, and thick forest shrinks notice range — hunts and HQ spotting now acquire spotted enemies, not just near ones.

## Task writeup (moved from docs/tasks/128-high-ground-visibility.md)

# 128 — Terrain-aware visibility: high ground sees farther, ridges hide, forests shade

Task: a unit higher up has better visibility; units cannot see through
mountains; visibility through thick forest is reduced.

## What already existed

Hunt acquisition was a flat distance gate: `acquireHunt` /
`acquireStrategicHunt` / `chooseTarget` noticed any live enemy inside
`HUNT_ENGAGE_RADIUS` (1100, 1500 for peewee scouts) regardless of the
ground between. Firing already respected terrain (`flightClearsTerrain`
holds ridge-blocked guns) and wood (interception rolls), but *spotting*
did not — a hull in a valley saw as far as a hull on a ridge, through
mountains, and through deep forest.

## What changed

New core module `visibility.ts`: per-kind eye heights (`EYE_HEIGHT` —
commander 32 down to peewee 10), a high-ground notice bonus
(`SIGHT_ELEVATION_GAIN` 2/unit, capped at +140), a per-tree forest
penalty (60/tree, capped at 60% of the gate, floored at 200 point-blank),
and `sightClearsTerrain` (eye-to-eye march against the live surface —
the spotting twin of `flightClearsTerrain`). `canSpot` / `canSpotPoint`
combine the three into one gate.

Threading: `acquireHunt`, `chooseTarget` (`TargetOptions.sight`), and
`acquireStrategicHunt` take an optional trailing `SightContext` and
resolve the legacy distance gate byte-identically without it. The
renderer sweep (`UnitMovement.sweepHunt`) builds one sight snapshot per
tick — per-hull eye heights on live ground plus the shared per-tick
tree stands (new optional `MovementEnv.treeStands`, wired to the
canvas `getStands` cache in `TerrainCanvas.tsx`) — and HQ fort spotting
plus HQ assaults use the same gate via `canSpotPoint` against the
bunker roof (`STRUCTURE_SIGHT_LIFT` 18).

## Decisions

- Spotting only: the gate applies to hunt acquisition and HQ spotting,
  never to pursuit (a chased contact is remembered), retaliation (taking
  fire is ground truth), or gun admission (firing gates already hold
  into hillsides and wood). Guns still shoot what the side knows.
- Bonus capped under hysteresis (+140 keeps 1100 < 1250 and scout
  1500 < 1650, pinned by test), so an elevated acquisition never starts
  past the disengage bound — no `pursueStep` changes needed.
- Forest shrinks, mountains block: wood costs range down to a floor
  (neighbours are heard, not just seen); terrain fails the spot at any
  range. Felled wood never counts.
- Cheap reject first (`dist > base + max bonus` skips all surface
  probes), so distant pairs cost nothing per sweep tick.

## Verification

- `packages/core/src/units/visibility.test.ts` (30 tests): bonus/penalty
  math, hysteresis-cap pin, terrain march (ridge blocks, swell clears,
  high eyes peer over), forest shade + point-blank floor, felled-wood
  ignore, and sight-gated `acquireHunt` / `chooseTarget` /
  `acquireStrategicHunt` with legacy no-sight controls.
- `apps/web/src/renderer/visibility.test.ts` (8 tests): live-sweep hunts
  across open ground, blocked by a ridge, extended from high ground
  (one-way), shaded by forest, plus HQ assault spotted vs ridge-hidden.
- Full suites green: core 564, web 589; both typechecks clean.
- README untouched: behavior refinement inside the existing hunt
  architecture, matching tasks 125–127 precedent.
