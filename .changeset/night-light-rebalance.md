---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Night light rebalance: darker moonlight, hotter light sources, and fireflies that actually pool light on the ground. The night preset dims (sun 0.7 → 0.55, hemi 0.6 → 0.45, darker terrain/water triples, still above the visibility floor), while muzzle/explosion kicks, riding shot glow, HQ beacons, fire ground-glow, and firefly pools all burn at a 1.6× night boost. Firefly pools step up to muzzle-kick order (peak 1500 → 2600, range 300 → 420) with a hotter terrain-shader pool tint so the swarm visibly illuminates the dirt.

## Task writeup

# Task 145 — Night lights illuminate more, moonlight darker

Night mode had two problems: the moonlight was bright enough to wash
out light sources, and the firefly ground pools were too weak to read
as real illumination. The night ambient now drops (directional moon
0.7 → 0.55, hemi 0.6 → 0.45, every terrain/water shader channel at or
below its day value) while staying above the pinned visibility floor,
and every dynamic light budget scales up at night through one shared
`nightLightScale` (1.6×): combat kick pool + riding shot glow (+ ground
blobs), HQ beacon wash, fire ground-glow discs, and the firefly pools.

## What changed

- `apps/web/src/renderer/night.ts` — darkened `NIGHT_LIGHTING`
  (sun 0.55, hemi 0.45, cooler/darker terrain + water triples); new
  `NIGHT_LIGHT_BOOST = 1.6` + `nightLightScale(night)` helper.
- `apps/web/src/renderer/combatFx.ts` — new `setNight()`: muzzle /
  explosion kicks (`kickLight`, `glowAt`) and riding shot-glow lights
  + ground-blob opacity scale by `nightLightScale`. Struck peaks only —
  a mid-decay kick keeps its peak and fades from there.
- `apps/web/src/renderer/hq.ts` — `setHqBeaconLevel` takes an optional
  `peak` (default `HQ_BEACON_PEAK`, so day callers are unchanged).
- `apps/web/src/renderer/hqFx.ts` — new `setNight()`: live beacons
  sweep at the boosted peak; wrecks stay dark either way.
- `apps/web/src/renderer/fireFx.ts` — new `setNight()` + `glowOpacity`
  getter: ground-glow discs pool brighter (`FIRE_GLOW_OPACITY` × boost).
- `apps/web/src/renderer/fireflies.ts` — pools to muzzle-kick order:
  peak 1500 → 2600, range 300 → 420, same decay.
- `apps/web/src/renderer/shaders.ts` — terrain pool tint
  (0.45, 0.6, 0.22) → (0.66, 0.88, 0.32) so the mirrored pools read as
  light on dark dirt.
- `apps/web/src/renderer/TerrainCanvas.tsx` — `combat/fire/hq.setNight`
  on open + on toggle flip in the tick.
- Tests: night (3 new), combat (2 new), hq (1 new), hqFx (1 new),
  fire (1 new), fireflies (2 extended).

## Decisions

- One boost constant, not per-system tuning: every light owner reads
  `nightLightScale`, so night reads as one coherent grade instead of
  five separately tuned glows.
- No new lights: fires reuse the combat ignition kick (now boosted)
  plus brighter glow discs; the 2-light combat budget and 2-pool
  firefly budget hold, so night costs nothing extra per frame.
- Hemi drops to day intensity (0.45) rather than below the floor: its
  dark-blue colors do the dimming, and Lambert props keep the
  moonlit-not-black read the floor test guards.
- No README change: a lighting rebalance, no architecture change.

## Verification

- Focused: night + fireflies + fire + hq + hqFx + combat + shaders —
  181 pass (10 new/extended).
- Full `yarn test`: 662 web + core suites, all pass.
- `yarn typecheck` — 3 tasks successful.
- `yarn workspace @scorched-3d/web build` — single-file bundle ok.
- Playwright not run (per task rules).
