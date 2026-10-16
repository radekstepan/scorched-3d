---
"@scorched-3d/web": patch
---

Subtler in-flight projectile glow: daylight washes out the riding lights and ground blobs, night blooms a touch less hot.

## Task writeup

The pooled shot-glow (riding `PointLight`s plus the additive ground ellipse under each live round) staged at full strength by day and at the shared `NIGHT_LIGHT_BOOST` (1.6×) by night. Against a sunlit field the pools read too loud — daylight drowns additive light — and at night they bloomed a touch too hot off the dirt.

## What changed (`combatFx.ts` view only — no core change)

- New `SHOT_GLOW_DAY_SCALE = 0.4` / `SHOT_GLOW_NIGHT_SCALE = 1.3` plus the pure `projectileGlowLightScale(night)` selector. The shot-glow path (riding-light intensity and ground-blob opacity, including the headless no-env branch) now scales by it instead of the shared `nightLightScale`.
- Day glow drops to 40% of legacy (significantly subtler — the round itself still reads, its reflection no longer shouts); night glow drops ~19% under the old 1.6× boost (slightly subtler) while staying brighter than day, so light sources still own the dark field.
- Deliberately untouched: muzzle/explosion kick peaks keep the full `NIGHT_LIGHT_BOOST` (they are pops, not reflections), and fire/explosion ground glows are separate systems with their own tuning.

## Files

- `apps/web/src/renderer/combatFx.ts` — glow scale constants + selector, three `poseShotGlow` stagings, `setNight` doc.
- `apps/web/src/renderer/combatFx.test.ts` — night-ratio test now pins the glow scale ratio; 2 new cases pin the subtler staging (pure scale bounds + live locked-step caps).

## Verification

- `yarn test` — web suite passes (101 combatFx cases incl. 2 new); only failure is the pre-existing `deployPages.test.ts` workflow-yaml assertion on the untouched tree.
- `yarn typecheck` — passes.
- `yarn build` — passes (web single-file bundle).
- Playwright not run (per task rules).
