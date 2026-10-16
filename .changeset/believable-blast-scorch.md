---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Believable blast scorch: yes, the brown blotches were projectile impact decals (one flat brown disc per explosion). Each scorch is now a charred near-black center fading to a dark burnt-brown rim with an irregular feathered edge (shared baked texture, one instanced draw), an elliptical squash + rotation per impact so no two blotches share a silhouette, and a tiny visual crater bowl dented into the terrain mesh (≤1 height unit per blast, capped accumulation, purely visual — pathing and unit seating still read the static heightfield, so bowls never trap units).

## Task writeup (moved from docs/tasks/21-believable-blast-scorch.md)

# Task 21 — Believable blast scorch + tiny terrain dents

Confirmed first: yes, the brown blotches are projectile explosions. Every
shell/bolt impact ends in `CombatFx.explode` → `scarGround`, which appends
one `addScorchMark` decal (core `destruction.ts`, capped at 48,
oldest-eviction, session-persistent) rendered as a single instanced
`CircleGeometry` disc. The old disc was one solid tone
(`tone = 0.17 − intensity·0.12`, flat brown) with a hard 18-gon circular
silhouette — that is exactly the "mud" read: uniform color, perfect circle,
no char, no edge. Nothing else paints brown on the ground (tree fires are
cones/embers/smoke, unit damage tints hulls only), so the suspect list was
one item long.

Fix, all deterministic and visual-only for pathing (README guarantee kept —
core A*/seating still read the static heightfield; dents live only in the
terrain mesh + `groundY` seating, so a unit parked in a bowl still drives
out and bowls never trap):

- Two-tone baked texture (`craters.ts`, new): one shared 128² byte-baked
  `DataTexture` (no DOM, so node tests cover it) with a near-black charred
  center (`SCORCH_CORE_RGB`) fading to a dark burnt-brown rim
  (`SCORCH_RIM_RGB`, red > green > blue throughout — burnt, not mud) and an
  irregular feathered edge from a baked angular wobble
  (`scorchEdgeRadius`). Still one instanced draw; 28-gon disc for a rounder
  silhouette.
- Per-mark variety (core `destruction.ts`): `ScorchMark.seed` (position-hash
  `scorchSeed` when absent, so old marks stay deterministic),
  `scorchAnisotropy` (±14% area-preserving elliptical squash) and
  golden-angle + seed rotation in `syncScorch`, so overlapping blotches never
  share a silhouette. Instance colors are now near-white warm multipliers
  (`scorchShade`: heavier blasts scar darker) — the texture gradient carries
  the darkness, kinds keep their ordering.
- Tiny terrain flatten (`craterDepthForIntensity` ≤ 1 height unit ≈ 3.6
  world units at default exaggeration, smooth `(1−t²)²` bowl,
  `craterDepthAt` capped at 2 so overlaps never dig pits): `CombatFx`
  reports each impact through the new optional `CombatEnv.dentTerrain` hook,
  and `TerrainCanvas` owns a ≤48 crater list (evicted with the scorch cap),
  recomputing mesh Y from map − dent (`applyCraters`, pure function of
  map + craters + exaggeration, so re-snaps re-run it instead of
  accumulating). `groundY` dips by the same dent so scorch decals, pings,
  and the probe sit inside the bowl; unit hulls keep core seating (they ride
  ≤3 units proud over a direct hit — invisible at demo scale).
- `selectionFx.scorchToneRGB` now delegates to core `scorchDisplayRGB`
  (baked char × shade) so the contrast policy can't drift from the render;
  white/cyan still clear AA easily on the darker scorch.

Important decisions: denting the real mesh instead of faking a bowl in the
decal keeps grazing-angle views honest (a painted bowl goes flat edge-on);
per-blast normals are deliberately not recomputed (sub-degree lighting
change under a dark char decal — the canvas still recomputes on re-snap);
no second instanced char-core layer (the baked gradient holds the draw-call
budget at one).

Tests: core `destruction.test.ts` pins seed determinism/range, seed
fallback, elliptical area preservation, shade ordering with burnt-not-mud
channels, crater depth cap + bowl profile + overlap cap; `craters.test.ts`
(new) pins edge irregularity bounds, texel char→rim→transparent ramp,
byte-bake center/corner, texture sharing/disposal, and mesh dents (no-op
when empty, center dent vs spared rim, exaggeration scaling, re-run
reproducibility); `combatFx.test.ts` asserts one ≤1-unit dent per scar,
near-white warm instance tints, and elliptical instance scales.
`yarn typecheck` and `yarn test` pass (177 core + 132 web tests).
