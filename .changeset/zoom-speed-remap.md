---
"@scorched-3d/web": patch
---

Remapped camera speed sliders so both default to 1x: pan keeps its current feel and zoom is 2x faster than before via base speeds behind the slider.

## Task writeup (moved from docs/tasks/103-zoom-speed-remap.md)

# Task 103 — Zoom 2x faster by default, sliders remapped to 1x

Wheel zoom at the task-87 2x default still felt slow, and the sliders opened
at odd non-1x positions (pan 3x, zoom 2x). Both sliders now default to 1x:
the absolute feel moved into base-speed constants behind the slider, with
zoom doubled on top — 1x on the slider zooms 2x faster than the old default
while panning feels exactly as before.

## What changed

- `cameraPan.ts`: `DEFAULT_PAN_SPEED` 3 → 1, `DEFAULT_ZOOM_SPEED` 2 → 1
  (slider range stays 0.2–3, so the new defaults sit inside the existing
  guardrails; non-finite input still falls back to the default via
  `clampPanSpeed`/`clampZoomSpeed`). New `PAN_BASE_SPEED` (3) and
  `ZOOM_BASE_SPEED` (4) carry the absolute feel: pan 1x = the old 3x
  default, zoom 1x = 4x stock OrbitControls speed = 2x the old 2x default.
  New `effectivePanSpeed`/`effectiveZoomSpeed` map a slider position to the
  absolute OrbitControls speed (clamp, then scale by the base).
  `panStepDistance` now routes through `effectivePanSpeed`, so keyboard and
  right-drag panning scale together with no `PAN_SPEED_FACTOR` fork (it
  stays 1.2).
- `TerrainCanvas.tsx`: seeds and per-tick re-syncs `controls.panSpeed` /
  `controls.zoomSpeed` from `effectivePanSpeed`/`effectiveZoomSpeed` instead
  of the raw clamped slider values. Keyboard path untouched — it already
  routes through `panStepDistance`.
- `App.tsx`: View-options defaults `panSpeed: 3, zoomSpeed: 2` → `1, 1`,
  so both sliders open at 1.0x. Slider bounds unchanged (0.2 min / 3 max /
  0.1 step).
- Tests: `cameraPan.test.ts` pins the 1x defaults, the base speeds (3/4),
  effective-speed linearity/clamping/non-finite fallback, and the preserved
  pan absolute (`1000 × 1.2 × 3 × dt` at 1x); `cameraZoom.test.ts` pins
  `effectiveZoomSpeed(1) = 4` and drives two real OrbitControls instances
  (old 2x vs new 4x) through the actual wheel listener — the new default
  lands well clear (ratio > 1.5, exponential dolly so no exact-ratio
  assert); `App.controls.test.ts` pins the `1, 1` default state and the
  effective-speed wiring.
- `.changeset/zoom-speed-remap.md` (new) — **patch** for web (view-only
  change; core untouched since the constants live in the renderer).

## Important decisions

- **Base speeds, not slider rescaling.** The alternative — keeping the
  slider value as the OrbitControls speed and just moving the default —
  cannot make zoom faster than the old 3x slider max while reading 1x.
  Splitting "slider position" from "absolute speed" via base constants
  keeps the UI scale intuitive (1x = shipped feel) with one mapping each.
- **Pan feel preserved bit-for-bit.** `effectivePanSpeed(1) = 3` and
  `panStepDistance` multiplies by it exactly where `clampPanSpeed` used to
  be, so keyboard and right-drag panning at default are numerically
  identical to the task-88 behavior.
- **Range semantics change (documented).** The 0.2–3 slider range is now
  relative to the new defaults, so absolute extremes moved: pan max 3x new
  = 9x old-scale, zoom max 3x new = 12x stock. Keeping the familiar 0.2–3
  UI was preferred over odd rescaled bounds (e.g. 0.07–1); anyone who finds
  the top end wild can dial back, same as before. No stored settings exist
  (options are React state only), so no migration was needed.
- **No README change.** Same call as tasks 36/51/82/87/88: a view-panel
  default plus renderer constants, self-documenting in the slider readout.

## Verification

- `yarn workspace @scorched-3d/web test <3 files>` (targeted): 3 files /
  44 tests pass, including the new old-2x-vs-new-4x dolly case.
- `yarn test` — 490/491 web tests pass; the single failure
  (`combatFx.test.ts > dead hulls stop firing and stop drawing fire`) is
  pre-existing — it fails identically on the clean tree with this change
  stashed, and is unrelated (combat FX, no camera-speed touch).
- `yarn typecheck` — clean; `yarn build` succeeds (renderer touched).
- Playwright not run (per task rules).
