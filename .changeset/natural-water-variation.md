---
"@scorched-3d/web": patch
---

Break up repeating water patterns with noise-based domain warping and spatial amplitude/patch masks on swells, ripples, foam, and caustics.

## Task writeup (moved from docs/tasks/110-natural-water-variation.md)

# Task 110 — Natural water variation

The task-100 water still read as patterned: every swell, ripple, foam, and
caustic term was a sum of pure `sin(dot(world, dir))` waves, i.e. infinite
straight-crested sheets tiled edge to edge at uniform height. Taking the
cue from the terrain generator (`sampleHeight` in
`packages/core/src/terrain/generate.ts`), which never trusts raw noise but
warps domains (`warpFbm`), layers FBM octaves, and masks everything by
low-frequency envelopes — the water now gets the same treatment: domain
warping plus spatial amplitude/patch masks, all from a small shared
value-noise helper living inside the shaders.

## What changed

- `apps/web/src/renderer/shaders.ts`
  - New `wHash`/`wNoise` GLSL helpers (Hoskins-style hash, smooth
    bilinear value noise), injected into `waterVertex`, `waterFragment`,
    and `terrainFragment`. No new uniforms — all variation derives from
    world position (+ `time` drift), so `TerrainCanvas.tsx` is untouched.
  - `waterVertex`: swell sample points warped by low-frequency noise
    (`±45` world units, so crests meander), and the summed swell scaled by
    a drifting envelope `ampMod ∈ [0.7, 1.3]` (some patches run high,
    others lie nearly flat).
  - `waterFragment` ripple: ripple coordinates warped (`±20` units,
    slow time drift) — highlight fields wander instead of tiling.
  - `waterFragment` foam: shoreline falloff width now varies per patch
    (`14 × (0.6 + 0.8·noise)`), breakup sines sampled on warped coords
    with a noise wobble folded into `foamNoise`, plus a ragged patch mask
    (`0.5 + 0.8·noise`) so foam clumps instead of forming a uniform band.
  - `terrainFragment` caustics: sampled on warped coords and gated by a
    drifting noise mask, so light webs pool and drift instead of marching
    on a diagonal grid.
  - New/updated JS mirrors for testing: `waterHash`, `waterNoise`,
    `waterWarp`, `waterAmpMod`, `waterFoamBand`, `waterFoamPatch`,
    `waterCaustic`; `waterSurfaceHeight` (warp + envelope),
    `waterRipple` (warped domain), `waterFoamNoise` (warped domain +
    noise wobble, clamped to `[-1, 1]`).
- `apps/web/src/renderer/shaders.test.ts`
  - Old swell bound widened by the `1.3` envelope factor; old
    `dot(vWorld.xz` counter now also matches the warped `rp`/`fp` domains.
  - New `natural water variation` block (6 tests): noise
    determinism/bounds/smoothness, envelope range + regional difference,
    ripple non-repetition over a pure-sine period, foam band/patch ranges
    + spatial spread, caustic determinism/bounds/time-drift, and GLSL
    markers (`wHash`/`wNoise` in all three shaders, warp sites, no new
    uniforms).
- `.changeset/natural-water-variation.md` (patch, web only).

## Decisions

- **Noise in-shader, not a texture.** A noise texture would need a new
  sampler uniform + canvas wiring and mip/filter setup; two ALU value-noise
  evaluations per warp site cost ~4 hashes each and keep the uniform set
  (and `TerrainCanvas`) untouched.
- **Warp + mask, not more sines.** Task 100 already pushed directional
  sines as far as they go — more layers would just make a denser grid.
  The terrain code shows the fix: keep the same sines, but sample them on
  a bent domain and gate them with a slow envelope.
- **JS mirrors approximate the GPU math.** Like task 100, the mirrors pin
  properties (determinism, bounds, spatial variance, non-periodicity)
  while GLSL-source assertions pin that the shader actually uses them;
  float32-vs-float64 hash exactness is intentionally not asserted.
- **No README change.** Shader-internal variation, no API/architecture
  surface change.

## Test evidence

- Targeted: `shaders.test.ts` — 15/15 pass (9 pre-existing + 6 new).
- Full web suite: 511/514 pass; the 3 `combatFx.test.ts` failures are
  pre-existing — verified identical on the clean tree via `git stash`
  (task 100 documented 1 of them; the file now shows 3 on main without
  this change).
- `yarn typecheck` (root, turbo) — 3 tasks successful.
- `yarn build` (web) — clean.
- Playwright not run (per task rules).
