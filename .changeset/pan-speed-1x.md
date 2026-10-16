---
"@scorched-3d/web": patch
---

Rebased pan speed so slider 1x equals the previous 0.75x feel: base pan speed 4.5 to 3.375 for slower, more controllable default panning.

## Task writeup (moved from docs/tasks/116-pan-speed-1x.md)

# Task 116 — Pan 1x becomes the old 0.75x

Default panning at the task-107 1x baseline felt too fast — the 0.75x slider
position was the comfortable cruising speed. The base pan speed is now 3.375
(was 4.5), so slider 1x equals the old 0.75x feel exactly; the slider still
opens at 1.0x with bounds unchanged.

## What changed

- `cameraPan.ts`: `PAN_BASE_SPEED` 4.5 → 3.375 (= 4.5 × 0.75, comments
  updated). `DEFAULT_PAN_SPEED` stays 1, slider bounds stay 0.2–3,
  `PAN_SPEED_FACTOR` stays 1.2 — the whole change lives in the base
  constant, so keyboard (`panStepDistance`) and right-drag
  (`effectivePanSpeed` → `controls.panSpeed`) panning scale together with
  no fork.
- `App.tsx` / `TerrainCanvas.tsx`: untouched — defaults already 1x and both
  pan paths already route through `effectivePanSpeed` / `panStepDistance`,
  so the new baseline flows through with no UI or canvas edit.
- Tests: `cameraPan.test.ts` pins the 3.375 base,
  `effectivePanSpeed(1) = 3.375`, and the rebased case asserting new 1x
  equals old 0.75x (`4.5 × 0.75`) plus the keyboard step
  `1000 × 1.2 × 3.375 × dt`.
- `.changeset/pan-speed-1x.md` (new) — **patch** for web (view-only
  change; core untouched since the constants live in the renderer).

## Important decisions

- **Base speed, not slider rescaling.** Same pattern as tasks 103/107: the
  slider position stays intuitive (1x = shipped feel) while the absolute
  speed moves behind it. No stored settings exist (options are React state
  only), so no migration was needed.
- **Range semantics change (documented).** The 0.2–3 slider range is now
  relative to the slower baseline, so absolute extremes moved: max 3x new =
  10.125x stock (was 13.5x), min 0.2x new = 0.675x stock (was 0.9x).
  Keeping the familiar 0.2–3 UI was preferred over odd rescaled bounds;
  anyone who wants the old pace back can dial up to ~1.3x.
- **No README change.** View-panel constant, same call as tasks 36/88/103/
  107 — self-documenting in the slider readout.

## Verification

- `yarn workspace @scorched-3d/web test src/renderer/cameraPan.test.ts src/App.controls.test.ts` (targeted): 2 files / 36 tests pass.
- `yarn test` — all pass (core: 23 files / 510 tests; web: 36 files /
  544 tests, including the rebased 0.75x-feel pan cases).
- `yarn typecheck` — clean; `yarn build` succeeds (renderer touched).
- Playwright not run (per task rules).
