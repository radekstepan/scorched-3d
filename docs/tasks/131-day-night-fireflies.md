# Task 131 — Day/night toggle with fireflies

The View panel has a Night toggle (default off). Night is moonlit, not
pitch black: a cool directional moon keeps slopes readable, hemisphere
fill actually rises a touch (0.45 → 0.6 with darker blue colors), and fog
/ background go deep blue. The sky shader blends to a night palette with
a pale moon disc (same direction as the light) and sparse twinkling
stars. A seeded swarm of 90 fireflies clusters around forest stands,
drifting and flashing yellow-green; two roaming PointLights at cluster
centroids pool real light onto Lambert props (trees, rocks, hulls), and
the same pools are mirrored as additive uniforms in the terrain shader
so open ground glows too.

## What changed

- `packages/core/src/terrain/types.ts` — `ViewOptions.nightMode`.
- `apps/web/src/renderer/night.ts` (new) — `DAY_LIGHTING` /
  `NIGHT_LIGHTING` presets + `applyDayNight`, which retints scene
  background, fog, hemi/sun lights, terrain + water shader colors, and
  the sky `nightMix` in place (no recompile, no identity changes).
- `apps/web/src/renderer/fireflies.ts` (new) — seeded `placeFireflies`
  (rng, tree XZ, groundY), `fireflyBlink` / `fireflyDrift` /
  `fireflyPoolGlow` pure helpers, and `FireflyFx` (one additive
  THREE.Points + 2 pool PointLights, `setNight` / `resnap` / `update` /
  `dispose`).
- `apps/web/src/renderer/shaders.ts` — sky `nightMix` + `time` uniforms
  (night palette, moon disc, hashed twinkling stars); terrain
  `fireflyA/B` + `fireflyGlow` pool term.
- `apps/web/src/renderer/TerrainCanvas.tsx` — applies the preset on open
  + on toggle change in the tick, drives the swarm (`setNight`, `update`,
  `resnap`, `dispose`), mirrors pool positions/glow into the terrain
  uniforms every tick.
- `apps/web/src/App.tsx` — Night toggle after Water, default off.
- `night.test.ts` (9 tests), `fireflies.test.ts` (8 tests).
- `.changeset/day-night-fireflies.md` (patch, web only).

## Decisions

- Moonlight stays well above black (sun 0.7, hemi 0.6, pinned by a
  visibility-floor test) per the "actually see the damned thing" brief;
  day values are pinned to the old hardcodes so day is pixel-identical.
- Fireflies cluster near trees (forests read as the glowing patches)
  with a map-center ring fallback for treeless maps; placement is seeded
  on `map.seed` so regens are stable.
- Terrain pools live in the terrain shader, not just the PointLights:
  the custom terrain shader ignores scene lights (task 99/130 finding),
  so lights alone would leave open ground dark. Two extra uniforms, one
  `fireflyPoolGlow` JS mirror, glow forced to 0 by day.
- `THREE.Fog` copies its color at construction (does not alias the
  passed Color), so `applyDayNight` retints `scene.fog` explicitly —
  caught by test, would otherwise have left day fog on Lambert props.
- No README change: a View toggle + fx, no architecture change.

## Test evidence

- Targeted: `night.test.ts` + `fireflies.test.ts` + `shaders.test.ts` —
  38 pass (17 new).
- Full `yarn test`: web 609/609 across 39 files, core 566/566.
- `yarn typecheck` — clean.
- Playwright not run (per task rules).
