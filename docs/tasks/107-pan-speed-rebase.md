# Task 107 — Pan 1.5x becomes the new 1x

Keyboard (WASD/arrows) and right-drag panning at the task-103 1x default
still felt slow — the 1.5x slider position was the comfortable cruising
speed. The base pan speed is now 4.5 (was 3), so slider 1x equals the old
1.5x feel exactly; the slider still opens at 1.0x with bounds unchanged.

## What changed

- `cameraPan.ts`: `PAN_BASE_SPEED` 3 → 4.5 (comments updated).
  `DEFAULT_PAN_SPEED` stays 1, slider bounds stay 0.2–3, `PAN_SPEED_FACTOR`
  stays 1.2 — the whole 1.5x gain lives in the base constant, so keyboard
  (`panStepDistance`) and right-drag (`effectivePanSpeed` →
  `controls.panSpeed`) panning scale together with no fork.
- `App.tsx` / `TerrainCanvas.tsx`: untouched — defaults already 1x and both
  pan paths already route through `effectivePanSpeed` / `panStepDistance`,
  so the new baseline flows through with no UI or canvas edit.
- Tests: `cameraPan.test.ts` pins the 4.5 base, `effectivePanSpeed(1) = 4.5`,
  and a new case asserting new 1x equals old 1.5x (`3 × 1.5`) plus the
  keyboard step `1000 × 1.2 × 4.5 × dt`.
- `.changeset/pan-speed-rebase.md` (new) — **patch** for web (view-only
  change; core untouched since the constants live in the renderer).

## Important decisions

- **Base speed, not slider rescaling.** Same pattern as task 103: the
  slider position stays intuitive (1x = shipped feel) while the absolute
  speed moves behind it. No stored settings exist (options are React state
  only), so no migration was needed.
- **Range semantics change (documented).** The 0.2–3 slider range is now
  relative to the faster baseline, so absolute extremes moved: max 3x new =
  13.5x stock (was 9x), min 0.2x new = 0.9x stock (was 0.6x). Keeping the
  familiar 0.2–3 UI was preferred over odd rescaled bounds; anyone who
  finds the top end wild can dial back.
- **No README change.** View-panel default plus renderer constant, same
  call as tasks 36/88/103 — self-documenting in the slider readout.

## Verification

- `yarn workspace @scorched-3d/web test src/renderer/cameraPan.test.ts src/App.controls.test.ts` (targeted): 2 files / 31 tests pass.
- `yarn test` — 502/503 web tests pass; the single failure
  (`combatFx.test.ts > dead hulls stop firing and stop drawing fire`) is
  pre-existing — it fails identically on the clean tree with this change
  stashed, and is unrelated (combat FX, no camera-speed touch).
- `yarn typecheck` — clean; `yarn build` succeeds (renderer touched).
- Playwright not run (per task rules).
