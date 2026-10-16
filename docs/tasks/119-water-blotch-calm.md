# Task 119 — Water blotch fix + calm water

Switching the Water toggle off used to leave dark animated "blotches" on
the lakebeds: the terrain shader's underwater tint + drifting caustics ran
unconditionally, so hiding the water surface exposed them shimmering on
dry ground. (There is no "standing water" layer in the code — the
blotches were the seabed tint and its animated caustic webs.) The
underwater treatment is now gated on the same visibility condition as the
water surface, and the whole water system runs at roughly half pace with
halved swell height.

## What changed

- `apps/web/src/renderer/shaders.ts`
  - `terrainFragment` gains a `showWater` uniform; the underwater block
    (wet tint + warped caustics) renders only when
    `showWater > 0.5 && vWorld.y < waterY`. Water off now shows a dry
    lakebed in its normal albedo — no tint patches, no animation.
  - Calmer, lower water everywhere (GLSL + JS mirrors kept in lockstep):
    swell layers 1.15/0.85/1.6 speed and 1.35/1.05/0.55 amp become
    0.6/0.45/0.8 and 0.7/0.55/0.3; ripple sines 1.1/0.9/1.7 become
    0.55/0.45/0.85; foam sines 2.0/1.6 become 1.0/0.8; caustic sines
    1.0/0.7 become 0.5/0.35; every noise-domain scroll rate halved
    (amp envelope, ripple/foam/caustic warps, foam patch mask).
    Worst-case crest drops from ~3.8 to ~2.0 world units.
- `apps/web/src/renderer/TerrainCanvas.tsx` — `terrainMat` declares the
  `showWater` uniform and the tick loop drives it with the exact surface
  condition (`opt.showWater && map.seaLevel > 0`), so tint/caustics and
  the mesh can never disagree.
- `apps/web/src/renderer/shaders.test.ts` — new "gated calm water"
  block (4 tests): underwater GLSL gated on the uniform, canvas wiring
  (init + per-tick with the surface condition), swell caps (speed ≤ 0.8,
  amp ≤ 0.7, total ≤ 1.6, sampled crest ≤ 2.1), and half-pace literals
  present / old fast literals gone.
- `.changeset/water-blotch-calm.md` (patch, web only).

## Decisions

- Gate the whole underwater block (tint AND caustics), not just the
  animation: the user flagged the blotches themselves, so water-off
  ground renders fully dry rather than keeping static dark patches.
- Halve rather than retune: every time coefficient and swell amplitude
  is ~50% of its old value, preserving the interference character
  (layer ratios, warp shapes, foam breakup) while reading clearly
  slower and lower. Directions, frequencies, and the amp envelope
  [0.7, 1.3] are untouched.
- No README change: visual tuning + toggle bug fix, no architecture or
  feature surface change.
