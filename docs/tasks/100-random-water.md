# Task 100 — Random water

The water used to read as static rectangles sliding in one direction: every
animated term was an axis-aligned `sin(x …) * sin(z …)` product, so the
swell, the specular ripple, the foam breakup, and even the underwater
caustic tint all marched along the same x/z grid. All four now scroll along
multiple non-parallel directions with phase-warped interference, so the
surface shimmers and breaks up organically instead of flowing like a
conveyor belt.

## What changed

- `apps/web/src/renderer/shaders.ts`
  - `waterVertex`: the three swell sines now sample `dot(pos.xz, dir)`
    along `(0.94, 0.34)`, `(-0.42, 0.91)`, and `(0.71, -0.71)` at the same
    frequencies/speeds/amplitudes as before (previously raw `pos.x`,
    `pos.z`, `pos.x + pos.z`).
  - `waterFragment` ripple normal: two directional layers
    (`(0.033, 0.022)` forward in time, `(-0.019, 0.041)` backward) plus a
    third layer phase-warped by the first (`+ r1 * 1.3`), blended into both
    normal components — a non-repeating interference field instead of one
    sine per axis.
  - `waterFragment` foam: the `sin(x) * sin(z)` grid is now two
    directional layers (`(0.32, 0.24)` forward, `(-0.21, 0.28)` backward,
    second phase-warped by the first), same `[-1, 1]` range feeding the
    existing foam gain.
  - `terrainFragment` underwater caustic: the `sin(x) * sin(z)` product is
    now a sum of two directional sines (`(0.10, 0.07)` and
    `(-0.06, 0.08)`), same `[0, 1]` range into the same `pow4` falloff.
  - New pure JS mirrors of the GLSL math for testing:
    `WATER_SWELL_LAYERS` + `waterSurfaceHeight(x, z, time)`,
    `waterRipple(x, z, time)` (normalized nx/nz pair), and
    `waterFoamNoise(x, z, time)` (`[-1, 1]`). Constants match the shader
    literals exactly.
  - `TerrainCanvas.tsx` untouched: no uniform was added or removed
    (`time` was already wired), so no material/canvas churn.
- `apps/web/src/renderer/shaders.test.ts` — new `random water` block
  (6 tests): swell directions mutually non-parallel (`|dot| < 0.95`),
  height deterministic/bounded/varies in x, z, and time, ripple bounded
  and tilting on both axes from both coordinates, foam deterministic/
  bounded in `[-1, 1]`/varying in x, z, time, GLSL multi-`dot` +
  phase-warp markers with the old axis-aligned patterns asserted gone,
  and vertex GLSL literals matching `WATER_SWELL_LAYERS` layer for layer.
- `.changeset/random-water.md` (patch, web only).

## Decisions

- **Directions, not noise textures.** A hash/value-noise lookup would be
  more random still, but costs ALU + entropy plumbing per fragment; three
  skewed directional sines plus one phase warp break the visible grid at
  a net cost of +1 sine in the fragment shader (ripple 2 → 3, foam still
  2, vertex still 3). Per the task-52 hot-loop learnings, fragment cost
  stays flat-ish and no render targets or uniforms were added.
- **Counter-scrolling layers.** Giving the second layer in each pair a
  negative time sign (moving against the first) is what kills the
  one-direction slide; the phase warp (`+ r1 * 1.3`, `+ f1 * 1.1`) kills
  the tiling repetition.
- **Same ranges, same gains.** Every replacement preserves the old output
  range (foam noise still `[-1, 1]`, caustic still `[0, 1]`, swell still
  bounded by total amplitude), so depth tinting, alpha, fresnel, and spec
  strengths needed no retuning.
- **JS mirrors over screenshot tests.** Shaders can't be snapshotted in
  vitest; the mirrors pin the exact math (determinism, bounds,
  multi-axis response) while GLSL-source assertions pin that the shader
  actually uses it.

## Test evidence

- Targeted: `shaders.test.ts` — 9 tests pass (3 pre-existing + 6 new).
- Full web suite: 460/461 pass; the single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire",
  `shotCount` 1 vs 0) is pre-existing — verified failing on the clean
  tree via `git stash`, same failure documented in tasks 98 and 99.
- Core suite: 486/486 pass.
- `yarn typecheck` (root, turbo) — 3 tasks successful.
- `yarn build` (web) — clean.
- Playwright not run (per task rules).
