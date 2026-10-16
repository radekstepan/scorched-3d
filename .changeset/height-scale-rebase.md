---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Rebased height scale so slider 1x renders the previous 2x relief: raw heights map through a shared 2x base factor (`worldHeight`/`effectiveExaggeration`), the slider remaps 1–6 to 0.5–3, and the default 1.5x preserves the previous 3.0x opening view.

## Task writeup (moved from docs/tasks/108-height-scale-rebase.md)

# Task 108 — Height-scale rebase: old 2x is the new 1x

The height-scale slider's 2x position was the look the game is balanced
around, but the slider still counted 1x from flat raw heights. The base
height scale is now doubled: slider 1x renders exactly the old 2x relief,
and the slider is remapped 1–6 → 0.5–3 so every old view is still
reachable under its new number. The opening view is unchanged (old 3.0x =
new 1.5x).

## What changed

- `packages/core/src/terrain/types.ts` — new `BASE_HEIGHT_SCALE = 2.0`
  plus `MIN_EXAGGERATION = 0.5` / `MAX_EXAGGERATION = 3.0` slider bounds,
  `DEFAULT_EXAGGERATION = 1.5` (renders the old 3.0x opening frame), and
  two shared converters: `worldHeight(raw, exag) = raw × 2 × exag` (single
  source of truth for the raw→world mapping) and
  `effectiveExaggeration(exag) = 2 × exag` (maps the rebased slider back
  onto the legacy 1–6 scale the shaders were tuned against).
- Core converters routed through `worldHeight`: `groundHeight`
  (`units/terrain.ts`), `unitAnchor` (`units/place.ts`), `hqAnchor` +
  `hqFoundationDrop` (`units/hq.ts`). Drive gating is untouched — it works
  in raw height units, so pathing/climb behavior is identical.
- Web renderer routed through the same helpers: `cellWorld` +
  `placeFeatures` (`features.ts`), `startGroundY` + `commanderCameraPose`
  (`cameraStart.ts`, now imports `worldHeight` from core),
  `applyCraters` (`craters.ts`), terrain geometry / water level / `groundY`
  closure (`TerrainCanvas.tsx`). Shader GLSL is byte-identical — the
  `exaggeration` uniforms now receive `effectiveExaggeration/slider`, so
  contour un-scaling, water depth, and foam thresholds behave exactly as
  before (plus a header comment: never feed the raw slider to the
  uniforms).
- `apps/web/src/App.tsx` — Height-scale slider reads `MIN/MAX_EXAGGERATION`
  (0.5–3) with a 0.05 step (same relative granularity as the old 0.1 step
  over 1–6); the value readout still prints `×`.
- Tests: `terrain/viewOptions.test.ts` rewritten for the rebase (base
  factor, new-1x-equals-old-2x, default preserves the old 3.0x view,
  slider-range containment, legacy-scale mapping, linearity); updated
  absolute-height expectations in core (`terrain`, `place`, `hq` tests)
  and web (`cameraStart`, `craters`, `features` tests, `movement` test
  `groundY` mirror). One real find: the `hullPitchRoll` scaling test's
  gentle stop (exag 1) now saturates the tilt clamp under doubled relief,
  so it uses the 0.5x slider floor as its unclamped reference.
- `.changeset/height-scale-rebase.md` (new) — **patch** for core + web.

## Important decisions

- **Remap the slider, don't just move the base (differs from task 107).**
  The pan rebase kept its 0.2–3 bounds and let the extremes drift, but the
  brief here explicitly says "remap slider accordingly" — so 0.5–3 keeps
  the full old view range reachable (flattest old-1x at 0.5, wildest old-6x
  at 3) instead of stranding the flat view and turning 6x into old-12x.
- **One conversion function, no mirrored constants.** Every subsystem
  (geometry, water, features, units, HQs, craters, camera, shaders) goes
  through `worldHeight` / `effectiveExaggeration`, so the slider can't
  drift between subsystems. (`cameraStart.ts` imports from core rather than
  mirroring the factor locally.)
- **No README change.** README describes the default only as "gentle"
  with no numeric value — same call as tasks 93/107. No architecture
  change: same data flow, same slider, new baseline constant.
- **No stored-settings migration.** View options are React state only;
  nothing persists an old slider value.

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn workspace @scorched-3d/core test` — 23 files / 506 tests pass.
- `yarn test` (all) — web 500/503 pass; the 3 failures
  (`combatFx.test.ts`: dead-hulls-stop-firing + 2 canopy/ridge lob cases)
  are pre-existing — verified identical on the clean tree via `git stash`
  (3 failed / 69 passed in that file before my change), unrelated ballistics
  issues, no height-scale touch.
- `yarn build` — succeeds (renderer + core touched).
- Playwright not run (per task rules).
