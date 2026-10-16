---
"@scorched-3d/web": patch
"@scorched-3d/core": patch
---

Shrink the in-flight projectile ground highlight to a smaller, fainter disc

## Task writeup (moved from docs/tasks/63-projectile-highlight.md)

# Task 63 — Smaller projectile ground highlight

The additive ground blob under each in-flight round read as too much: a
radius-70 disc at 0.4 peak opacity, roughly twice the widest scorch mark
(hammer scorch radius is 34). It now stamps a smaller, fainter highlight.

## Decisions

- `SHOT_GLOW_RADIUS`: 70 → 32 (under the smallest scorch scale, so the
  highlight never out-reads a blast scar).
- `SHOT_GLOW_OPACITY`: 0.4 → 0.22 (subtle additive pooling, still visible
  on low skimmers at night).
- Riding `PointLight`s untouched (`SHOT_GLOW_PEAK = 1800`): the complaint
  was the ground circle, and Lambert neighbors (trees/hulls/rocks) already
  read correctly. Blast glow, muzzle/explosion pools, and falloff range
  untouched.
- Extracted pure `projectileGlowRadius(falloff)` (clamped 0..1, 60% at
  zero → full at one) so the seating math is unit-testable; `poseShotGlow`
  calls it instead of inlining the scale.

## Files

- `apps/web/src/renderer/combatFx.ts` — smaller constants, new
  `projectileGlowRadius` helper, seating uses it.
- `apps/web/src/renderer/combatFx.test.ts` — 2 new cases: radius/opacity
  caps + pure radius math, and seated-blob scale/height under live rounds.
- `.changeset/projectile-highlight.md` (patch), `docs/tasks/63-projectile-highlight.md` (this writeup).

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn workspace @scorched-3d/web test` — 28 files, 346 tests pass.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
