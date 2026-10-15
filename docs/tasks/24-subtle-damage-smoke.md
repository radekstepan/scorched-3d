# Task 24 — Subtler unit damage smoke + softer charring

Units on fire read too strong: one big constant smoke column per scorched
hull (radius-9 sphere, opacity 0.34, always on, heavy tier near-black at
tone 0.16) plus a large constant additive ember (radius 3.4, opacity 0.95),
and charring that lerped all the way to `0x1b140f` — fully battered hulls
went effectively black. Damage now reads as intermittent wisps with hulls
staying readable.

## What changed (`unitDamageFx.ts` view only — core `DamageField` untouched)

- Charring capped: `CHAR_TARGET` `0x1b140f` → `0x4a3a2c` (warm mid-brown)
  and a new `CHAR_MAX_MIX = 0.45` caps the effective lerp, so
  `charredColor(base, 1)` lands 45% toward the target instead of on it.
  Fully charred hulls keep their hue (red leads blue) with a luminance
  floor well above near-black. No core change: `charMix`/thresholds/splash
  math are byte-identical.
- Puff cadence: new pure `puffPhase` / `puffDuty` / `isPuffVisible`
  (period 3.6 s, duty 0.42 light / 0.6 heavy, golden-ratio per-index
  offset) — each smoking hull emits one small puff per window with real
  gaps between, heavy hulls puff more often, neighbours desync with no rng.
  Inside a window the puff lives: `localT` rises 32u, swells via a
  `sin(pi·localT)` envelope, then dissipates.
- Smaller/softer draws: smoke sphere 9 → 5.5, opacity 0.34 → 0.22, scale
  ≤0.62 (heavy) / 0.45 with wobble ±3; ember sphere 3.4 → 2.2, opacity
  0.95 → 0.7, flicker 0.35–0.6 dancing low; ember blink gated by its own
  `emberPhase`/`isEmberVisible` (period 2.1 s, duty 0.65) so sparks blink
  out instead of burning constantly.
- Smoke tones lifted: heavy 0.16 → 0.38 charcoal grey, light 0.52 → 0.58 —
  neither tier goes near-black.

## Important decisions

- **View-only, field preserved.** All cadence/size/color tuning lives in
  the `UnitDamageFx` transient view; core `unitDamage.ts` (thresholds,
  `charMix`, splash) is untouched, so determinism and the DamageField-vs-view
  split from task 19 hold.
- **Gaps are the feature.** `update` skips instances outside their window
  rather than parking them at scale 0 — `smokeCount`/`emberCount` now vary
  over time, which is exactly the "puffs here and there" read.
- **Per-instance fade via scale, not opacity.** The shared materials keep
  one opacity; the swell/dissipate envelope carries the fade without new
  materials or per-instance alpha.

Tests: `unitDamageFx.test.ts` grows 8 → 12 — capped-mix equality,
luminance floor + warm-hue asserts, gap/visible sweeps for both tiers and
embers, emission-gap `update` test, small/soft/never-black instance sweep
(geometry radii, opacities, per-instance scales ≤0.75/0.65, smoke tone
≥0.35), plus the carried determinism/rebuild suites with window-aware
elapsed picks. `yarn test` (197 core + 139 web) and `yarn typecheck` pass.
