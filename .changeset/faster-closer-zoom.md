---
"@scorched-3d/web": patch
---

Faster, closer zoom by default: the View-menu zoom speed now ships at 2x (was 1x, slider range unchanged) and the wheel/pinch floor drops to 15 world units (was 30) for tight single-hull close-ups.

## Task writeup (moved from docs/tasks/87-zoom-speed.md)

# Task 87 — 2x default zoom speed and closer still

Wheel zoom felt sluggish at the stock 1x default, and the 30-unit floor from
task 82 still framed a whole squad where a single-hull close-up was wanted.
The default zoom speed is now 2x and the floor drops to 15 world units: one
constant change each, everything else untouched.

## What changed

- `cameraPan.ts`: `DEFAULT_ZOOM_SPEED` 1 → 2 (slider range stays 0.2–3, so
  the new default sits inside the existing guardrails; non-finite input still
  falls back to the default via `clampZoomSpeed`). `MIN_ZOOM_DISTANCE` 30 →
  15. 15 sits just outside the longest hull half-length (stump, 14) and ~7.5x
  past the 2-unit near plane, so hulls never clip, no near-plane change was
  needed, and the polar clamp still holds the camera above the dirt.
- `App.tsx`: View-options default `zoomSpeed` 1 → 2, so the Zoom speed slider
  opens at 2.0x. Pan default stays 1x (a separate task owns pan speed).
- `TerrainCanvas.tsx`: untouched — it already seeds `controls.zoomSpeed`
  from `clampZoomSpeed(options.zoomSpeed)` and `controls.minDistance` from
  `MIN_ZOOM_DISTANCE`, so both changes flow through with no canvas edit.
  Cursor-anchored zoom, max distance, and the opening frame are untouched.
- Tests: `cameraPan.test.ts` pins the new defaults/range (2x default inside
  0.2–3, 15 < 30, 15 > 14 hull bound, 15 > 5x near plane); `cameraZoom.test.ts`
  adds a headless behavioral case driving two real OrbitControls instances
  (1x vs 2x) through the actual wheel listener — the 2x step lands well clear
  of 1x (ratio > 1.5, exponential dolly so no exact-ratio assert) — plus the
  2x default pin and the updated floor pins; `App.controls.test.ts` pins the
  `zoomSpeed: 2` default state.
- `.changeset/faster-closer-zoom.md` (new) — **patch** for web (view-only
  change; core untouched since the constants live in the renderer).

## Important decisions

- **Default up, range unchanged.** Widening the slider (e.g. max 5x) would
  move two variables at once; 2x already sits inside 0.2–3, so only the
  default moves and anyone who hates it can still dial back to 1x or below.
- **15, not lower.** Halving 30 → 15 mirrors the 2x theme and stops just
  outside the longest hull (14): any closer and the camera could sit inside
  the hull it is zoomed onto at shallow polar angles. The 7.5x near-plane
  margin keeps depth precision comfortable.
- **No README change.** Same call as tasks 36/51/82: a view-panel default
  plus a zoom-floor constant, self-documenting in the slider readout.

## Verification

- `yarn workspace @scorched-3d/web exec vitest run` (targeted): 3 files /
  41 tests pass, including the new 2x-vs-1x dolly case.
- `yarn test` — all pass (core + web: 34 web files / 412 web tests, whole
  turbo run 3 tasks successful).
- `yarn typecheck` — 3 tasks successful; `yarn build` succeeds (renderer
  constants touched).
- Playwright not run (per task rules).
