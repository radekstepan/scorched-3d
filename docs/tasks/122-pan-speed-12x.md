# Task 122 — Pan 1x becomes the old 1.2x

Default panning at the task-116 1x baseline felt slow — the 1.2x slider
position was the comfortable cruising speed. The base pan speed is now 4.05
(was 3.375), so slider 1x equals the old 1.2x feel exactly; the slider still
opens at 1.0x with bounds unchanged.

## What changed

- `cameraPan.ts`: `PAN_BASE_SPEED` 3.375 → 4.05 (= 3.375 × 1.2, comments
  updated). `DEFAULT_PAN_SPEED` stays 1, slider bounds stay 0.2–3,
  `PAN_SPEED_FACTOR` stays 1.2 — the whole change lives in the base
  constant, so keyboard (`panStepDistance`) and right-drag
  (`effectivePanSpeed` → `controls.panSpeed`) panning scale together with
  no fork.
- `App.tsx` / `TerrainCanvas.tsx`: untouched — defaults already 1x and both
  pan paths already route through `effectivePanSpeed` / `panStepDistance`,
  so the new baseline flows through with no UI or canvas edit.
- Tests: `cameraPan.test.ts` pins the 4.05 base,
  `effectivePanSpeed(1) = 4.05`, and the rebased case asserting new 1x
  equals old 1.2x (`3.375 × 1.2`) plus the keyboard step
  `1000 × 1.2 × 4.05 × dt`.
- `.changeset/pan-speed-12x.md` (new) — **patch** for web (view-only
  change; core untouched since the constants live in the renderer).

## Important decisions

- **Base speed, not slider rescaling.** Same pattern as tasks 103/107/116:
  the slider position stays intuitive (1x = shipped feel) while the
  absolute speed moves behind it. No stored settings exist (options are
  React state only), so no migration was needed.
- **Range semantics change (documented).** The 0.2–3 slider range is now
  relative to the faster baseline, so absolute extremes moved: max 3x new =
  12.15x stock (was 10.125x), min 0.2x new = 0.81x stock (was 0.675x).
  Keeping the familiar 0.2–3 UI was preferred over odd rescaled bounds;
  anyone who finds the top end wild can dial back.
- **No README change.** View-panel constant, same call as tasks 36/88/103/
  107/116 — self-documenting in the slider readout.

## Verification

- `yarn workspace @scorched-3d/web test src/renderer/cameraPan.test.ts src/App.controls.test.ts` (targeted): 2 files / 50 tests pass.
- `yarn test` — all pass (core: 23 files / 510 tests; web: 36 files /
  571 tests, including the rebased 1.2x-feel pan cases).
- `yarn typecheck` — clean; `yarn build` succeeds (renderer touched).
- Playwright not run (per task rules).
