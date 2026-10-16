---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Unit tests for the remaining untested core logic: terrain noise/palette/texture helpers, renderer shader sources, and the `cn` class-name util

## Task writeup (moved from docs/tasks/39-core-logic-tests.md)

# 39 — Unit tests for all the core logic

## Audit

Most core logic already had vitest coverage (checked every `*.test.ts`
against its sibling source). The genuinely untested pure modules were:

- `packages/core/src/terrain/noise.ts` — mulberry32, hash2, lerp, clamp,
  smoothstep, valueNoise, fbm, ridged, warpFbm
- `packages/core/src/terrain/palette.ts` — buildPalette, TILE_RAMPS, palRGB
- `packages/core/src/terrain/texture.ts` — composeAlbedo/Height/Minimap
- `apps/web/src/renderer/shaders.ts` — terrain/water/sky GLSL sources
- `apps/web/src/utils/cn.ts` — tailwind class merge helper

Everything else in `packages/core/src` (generate, combat, destruction,
unitDamage, facing, locomotion, movement, terrain, pathfinding, place,
branding) and in `apps/web/src/renderer` (units, movement, selection,
combatFx, craters, features, fireFx, fps, camera, healthBars, waypoints,
damage Fx) already has a co-located test.

## Added

- `terrain/noise.test.ts` — determinism per seed, `[0, 1]` range sweeps,
  pinned reference values (generated from the implementation), lattice
  identity (`valueNoise` on integers == `hash2`), single-octave fbm ==
  valueNoise.
- `terrain/palette.test.ts` — 768-byte table, index 0 black / 255 white,
  ramp endpoint + monotonicity checks, every `TILE_RAMPS` entry in-bounds
  with valid specks. Caught one test-authoring mistake, not a code bug:
  the grass ramp (16–47) overwrites palette index 16, so the deep-green
  ramp's light endpoint is not observable — the test now pins index 1 and
  the overwrite explicitly.
- `terrain/texture.test.ts` — builds a minimal 2×2 synthetic `TNTMap` and
  asserts albedo/height/minimap dimensions, opaque alpha, and
  palette-index → RGB mapping. The node test env has no `ImageData`, so the
  test installs a minimal capture stub (runtime only; the DOM lib already
  provides the type).
- `renderer/shaders.test.ts` — all six GLSL exports non-empty with
  `void main()`; vertex shaders contain `gl_Position`, fragment shaders
  `gl_FragColor`; required uniforms (`mapTex`, `heightTex`, `seaLevel`,
  …) present; `TerrainCanvas.tsx` references every export.
- `utils/cn.test.ts` — joining, falsy filtering, tailwind conflict
  resolution, conditional object syntax.

## Coverage gaps (deliberate)

- `TerrainCanvas.tsx` — React + WebGL component; needs a DOM/GL context
  the node vitest env does not provide. Pinned at source level by
  `App.controls.test.ts`, `App.layout.test.ts`, and the new shaders test.
- `terrain/types.ts`, `units/types.ts`, `index.ts` — types/barrels only,
  nothing to execute.

## Verify

`yarn test`: core 16 files / 277 tests pass, web 18 files / 214 tests pass.
`yarn typecheck`: clean. No Playwright.
