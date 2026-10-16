---
"@scorched-3d/web": patch
---

Closer minimum zoom: the wheel/pinch can now dolly in to 30 world units (was 80) for single-unit close-ups; zoom-out ceiling, near plane, and cursor-anchored behavior unchanged.

## Task writeup (moved from docs/tasks/82-closer-zoom.md)

# Task 82 — Be able to zoom in closer

The wheel/pinch zoom floor was 80 world units, so the closest view still
showed a whole squad and single-unit detail (damage charring, camo, the new
track trails) stayed far away. The floor is now 30: close enough to frame
one ~26-unit tank hull as a close-up, one constant change, everything else
untouched.

## What changed

- `cameraPan.ts`: new exported `MIN_ZOOM_DISTANCE = 30` /
  `MAX_ZOOM_DISTANCE = 8400` constants (the ceiling just names the doubled-map
  value that was already there). 30 sits just outside the 27-unit team ring
  and ~15x past the 2-unit near plane, so hulls never clip and no near-plane
  change was needed; the polar clamp still holds the camera above the dirt.
- `TerrainCanvas.tsx`: `controls.minDistance` / `maxDistance` now read those
  constants. Cursor-anchored zoom, zoomSpeed, pan behavior, and the opening
  frame are untouched.
- Tests: `cameraPan.test.ts` pins the new range (30 < old 80, 10x past the
  near plane, ceiling 8400); `cameraZoom.test.ts` drives the real
  OrbitControls clamps from the constants and pins the canvas wiring to them.

## Verification

- `yarn test` — 32 files / 394 tests pass, including the updated
  `cameraZoom.test.ts` (extreme wheel marathons clamp at exactly 30/8400
  with a finite pose) and the new range pins.
- `yarn typecheck` clean, `yarn build` succeeds (renderer changed).
- Playwright not run (per task rules).
