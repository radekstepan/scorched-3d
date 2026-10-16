---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Slope-aware explosions: blasts on graded terrain wash downhill instead of stamping flat circles — scorch decals drape to the terrain normal and stretch down the fall line, crater bowls dig deeper downhill, the shockwave ring/glow tilt to the slope with ejecta biased downhill, and tree/rock/unit damage reach extends downhill while uphill targets are shielded. Flat-ground blasts render exactly as before.

## Task writeup (moved from docs/tasks/35-slope-blasts.md)

# Task — Slope-aware explosions (blasts wash downhill, not flat)

Every explosion used to be a flat circular stamp: the scorch decal was a
horizontal disc (floating downhill, clipping uphill), the crater a symmetric
bowl, the shockwave ring a horizontal circle slicing through the uphill
grade, and damage reach identical in all directions. On a gradient the whole
thing read as pasted on. Blasts now respect the terrain fall line: they
stretch downhill and are cut short uphill, like ejecta and a fire front
running with the slope in real life.

## What changed

- Core (`packages/core/src/units/destruction.ts`): new `BlastSlope`
  (`sx`/`sz` unit downhill vector + `skew` 0..`MAX_BLAST_SKEW` 0.45) with
  `blastSkewForGrade` (linear to saturation at grade 0.9 ≈ the drive gate),
  `blastSlope` (unitizing normalizer), and `effectiveBlastDist`
  (`dist / (1 + skew·cosθ)` — ±45% reach along the fall line, exactly `dist`
  when flat so flat behavior is bit-identical). `indicesInBlast`,
  `applyBlastToTrees`/`applyBlastToRocks` (including the flatten-core and
  chip thresholds), and `craterDepthAt` all run on effective distance;
  `Crater` and `ScorchMark` carry optional wash fields (absent = flat,
  so old marks render exactly as before).
- Core (`packages/core/src/units/unitDamage.ts`): `applyBlastToUnits`
  takes the same optional wash — inclusion and linear falloff both use
  effective distance, so a hull above the blast is shielded by the rise
  while one below is reached further out. No rng consumed either way.
- Core (`packages/core/src/units/terrain.ts`): `downslopeAt` (one-cell
  finite-difference fall line + raw grade, exactly zero on the flat) and
  `blastSlopeAt` mapping it to a `BlastSlope`.
- Renderer (`apps/web/src/renderer/combatFx.ts`): `CombatEnv` gains
  optional `slopeAt`; `blastFeatures`/`dentTerrain` accept the wash.
  Each blast tilts its shock ring + ground glow to the seated-surface
  normal, biases smoke drift and spark ejecta downhill (fixed offsets, no
  extra rng — replay sequences untouched), and scars washed scorch/craters.
  `syncScorch` drapes every decal to the live terrain normal (tilt from the
  normal, so re-snaps and later dents re-seat correctly) and elongates
  washed marks down the fall line (major axis `×(1+skew)`, minor
  `×(1−skew/2)`, seed-jittered ±26° so parallel hillsides don't stamp
  copies). Flat ground takes the exact legacy path (identity tilt,
  golden-angle yaw).
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): implements `slopeAt`
  via `blastSlopeAt(map, …)` and threads the wash through
  `blastFeatures`/`dentTerrain` (wash stored on craters only when skewed).

Important decisions: damage and visuals share one warp
(`effectiveBlastDist`), so the dent, the scar, and the fell/hit boundary
always agree; tilt comes from the live `groundY` normal (adapts to crater
accumulation) while elongation comes from the stored wash (session-stable);
pathing and hull seating still read the static heightfield — wash is
visual + reach only and can never trap a unit.

Tests: core pins flat-identity, skew ramp/cap, downhill-vs-uphill reach
(`destruction.test.ts`, `unitDamage.test.ts`, `terrain.test.ts`: 13 new);
web pins wash delivery to env hooks, scorch stretch + tilt, tilted
ring/glow vs legacy flat rings, and asymmetric mesh dents
(`combatFx.test.ts`, `craters.test.ts`: 5 new). `yarn build`, `yarn
typecheck`, `yarn test` pass (242 core + 188 web).
