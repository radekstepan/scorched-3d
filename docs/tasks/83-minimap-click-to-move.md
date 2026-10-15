# Task 83 — Click anywhere on the minimap to move there

The minimap was view-only: unit dots, HQ forts, and the hover chip updated
live, but there was no way to jump the camera to a distant fight. Clicking
(or dragging) the minimap now retargets the orbit camera to that world
point while preserving the angle of view and zoom level — only the focus
translates, yaw/pitch/distance never reset.

## What changed

- `renderer/minimap.ts` (new): pure, framework-free mapping + retarget.
  `minimapUvToWorld` / `worldToMinimapUv` share the overlay-dot math
  (left = x/worldW + 0.5, top = z/worldD + 0.5) with edge clamping;
  `minimapPointToWorld` folds a box `getBoundingClientRect()` through it
  (zero-size rects fall back to map center); `jumpCameraTo` translates
  camera position + orbit target by the same clamped ground delta, so the
  position→target offset vector (yaw/pitch/zoom, target height) survives
  even at the map edges (same edge margin as keyboard pan).
- `App.tsx`: minimap box gets `onPointerDown` (click) + `onPointerMove`
  while held (drag), `cursor-crosshair` + title hint, and a sequenced
  `jump` state (`{x, z, seq}` so repeat clicks on one spot still fire)
  passed to the canvas as `jumpTo`. Dots, HQ forts, and hover chip
  untouched.
- `TerrainCanvas.tsx`: new optional `jumpTo` prop via `jumpRef` (no
  effect restarts); the tick consumes unseen sequences before
  `controls.update()` with `jumpCameraTo(camera.position,
  controls.target, jump, worldW, worldD)`.
- Tests: `minimap.test.ts` pins uv↔world mapping (center, corners,
  clamping, dot-math round-trip), rect→world, and offset/distance
  preservation incl. the clamped-edge case; `App.minimap.test.ts` pins the
  App ↔ canvas wiring at source level (WebGL-free).
- Changeset: `.changeset/minimap-click-to-move.md` (patch).

## Verification

- `yarn typecheck` clean.
- `yarn test` — 34 files / 405 tests pass, incl. the 2 new files.
- `yarn build` succeeds (renderer changed).
- Playwright not run (per task rules).
