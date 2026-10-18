---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Unit Folio units no longer re-light when the Terrain toggle flips: the study sun/rim/hemisphere rig and tone-mapping exposure are now identical with terrain on or off, so the toggle only swaps the backdrop (textured Greenreach field vs measure grid).

## Task writeup

Task: "Why do the units in Unit Folio look different if Terrain is toggled on /off?"

Root cause: the Terrain toggle did far more than show/hide the study field. Every folio frame with a changed toggle re-ran `applyStudyLighting`, which treated the toggle as a lighting-mode switch — sun 1.15 vs 1.8, hemi 0.45 vs 0.85, rim 0 vs 0.8, a different sun position, and tone-mapping exposure 1.05 vs 1.15. The "terrain on" branch was a dimmed outdoor rig mirroring the battlefield (`TerrainCanvas`: sun 1.15, hemi 0.45, exposure 1.05); "terrain off" was a brighter studio rig. Same unit, two different light setups — hence the visibly different paint.

## What changed

- Web (`apps/web/src/folio/settings.ts`): `applyStudyLighting` now drives the light rig (sun/hemi/rim intensities, sun position, light colors) and the returned tone-mapping exposure from night mode only. The `terrain` parameter survives but governs just the backdrop: scene background plus fog. Studio fog also moved 260 → 500 near so it starts past the farthest studio camera stop (size × 8 zoom-out plus half a hull — measured worst case 466 for the Hammer), keeping field depth without ever hazing the subject at full zoom-out.
- Web (`apps/web/src/folio/UnitFolio.tsx`): mount-time sun/rim intensities and sun position aligned with the single stable rig (they were overwritten before the first frame anyway, but the stale values implied a third lighting setup).
- Tests (`apps/web/src/folio/settings.test.ts`): new pins — light rig + exposure byte-identical across the terrain flip in day and night modes while background/fog still follow the toggle; fog-near exceeds every kind's farthest camera stop; daylight restore stays non-accumulating.
- Tests (`apps/web/src/folio/UnitFolio.test.ts`): new wiring pin that the folio still passes `current.terrain` into `applyStudyLighting`, so the backdrop keeps following the toggle.

## Important decisions

- **Stabilize on the studio rig, not the battlefield rig.** The folio is a model-study stage ("Look closer"); the brighter setup with rim fill (sun 1.8, hemi 0.85, rim 0.8, exposure 1.15) flatters hulls in both modes, and it matches the folio's own mount defaults. Battlefield lighting stays untouched.
- **Keep the backdrop terrain-dependent.** Background color and fog still flip with the toggle — they never touch unit pixels at studio range (fog-near is now pinned past max zoom), and the outdoor-vs-studio backdrops are deliberate scene dressing, not the bug.
- **No README change.** Small rendering-bug fix with no architecture impact.
- **Nanolathe:** checked the sibling repo for a preview/folio equivalent; it has no unit-folio concept (Go backend), so no inspiration applied.

## Verification

- `apps/web` folio suite: 43/43 pass (3 new/rewritten lighting cases + wiring pin).
- Full `apps/web` suite: 1115 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. Playwright not run (per task rules).
- `tsc --noEmit` green.
