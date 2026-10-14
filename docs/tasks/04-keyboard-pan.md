# Task 1 — Keyboard pan (arrows / WASD)

## What changed

Holding **arrow keys or WASD** now pans the camera across the map, alongside
the existing drag-orbit, scroll-zoom, and right-mouse pan.

- `apps/web/src/renderer/cameraPan.ts` (new) — framework-free pan helpers:
  `isPanKey()` (8 codes: 4 arrows + WASD), `panInputFromCodes()` (sum + normalize
  held keys so diagonals match cardinal speed and opposites cancel),
  `panOffset()` (camera-relative ground-plane offset), `applyPan()` (translate
  camera position + orbit target equally), `clampPanTarget()` (keep the target
  within the map plus a 25% edge margin), `shouldIgnoreKeyEvent()` (editable
  controls keep native arrow behavior).
- `apps/web/src/renderer/cameraPan.test.ts` (new) — 17 vitest cases.
- `apps/web/vitest.config.ts` (new) + `apps/web/package.json` — web `test`
  script now runs vitest (same hoisted binary as core; no new dependencies).
- `apps/web/src/renderer/TerrainCanvas.tsx` — window `keydown`/`keyup`/`blur`
  tracking with a held-key set, `preventDefault()` on pan keys to stop page
  scroll, per-frame pan in `tick()` before `controls.update()`; speed is
  `camera distance × 1.2 /s` (zoom-proportional) with `dt` clamped to 50ms.
- `apps/web/src/App.tsx` — footer hint gains `WASD / ARROWS pan`.

## Decisions

Camera-relative (not world-axis) panning: screen-up moves the view away from
the viewer along the camera's ground-projected forward, screen-right along
`forward × up`. This matches the nanolathe convention (held arrows drive the
camera scroll pass in screen space) and stays correct after orbiting. Orbit
`maxPolarAngle` keeps the camera above the horizon, so the ground projection
never degenerates; a world-north fallback covers the overhead case anyway.

`dt` comes from `clock.getDelta()` (replacing `getElapsedTime()`; `elapsedTime`
is read after the delta call) so pan speed is frame-rate independent. The
target clamp mirrors the map half-extents with `PAN_EDGE_MARGIN = 0.25`, so
players can look slightly past the shoreline without getting lost.

## Verification

- `yarn test` — all pass (17 new camera-pan tests + 28 pre-existing core tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
