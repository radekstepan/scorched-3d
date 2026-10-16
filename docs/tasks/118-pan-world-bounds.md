# Task 118 — Virtual rectangle bounds the camera, not just the target

Panning/orbiting could still take the view "off the map" even after task
109. Root cause: the tick clamped only the orbit target (carrying the
camera by the clamped delta), so the target stayed pinned while the camera
position itself was unbounded — orbiting or zooming at far zoom-out swung
the camera thousands of units past the map edge and the view left the
world.

## What changed

- `cameraPan.ts`: new `clampCameraToWorld(position, worldW, worldD)` —
  holds the camera XZ inside the same virtual rectangle as the orbit
  target (half-extents × (1 + `PAN_EDGE_MARGIN`), i.e. ±3190 × ±2550 on
  the standard 320×256 map). Y is untouched (polar clamp + zoom distance
  own height); the target is not moved, so at the bound the viewing
  offset shortens slightly (a small zoom-in) while the focus point stays
  put. Existing helpers unchanged (`minimap.ts` still uses
  `clampPanTarget`).
- `TerrainCanvas.tsx`: both tick clamp sites now run the camera clamp
  after `clampPanTargetWithCamera` — keyboard pan and the
  post-`controls.update()` re-clamp covering right-drag pan, orbit,
  cursor-anchored zoom, and minimap jumps.
- Tests: `cameraPan.test.ts` gains a `clampCameraToWorld` suite (shared
  rectangle values, in-bounds no-op, opening-frame containment, per-axis
  edge/corner clamps, height untouched, non-square maps, orbited-out
  regression, pan-past-together) plus a `TerrainCanvas.tsx` wiring pin
  asserting the camera clamp runs at both tick sites.

## Important decisions

- **One rectangle for both.** Per the request ("a virtual rectangle
  around the whole world"), target and camera share the existing
  `PAN_EDGE_MARGIN` bounds — no second margin to tune, and the opening
  frame (camera starts 350 past the edge looking in) already fits inside,
  so no snap on load (pinned by test).
- **Stop, don't re-orbit.** Same philosophy as task 109: blocked axes
  drop their component, the focus point never moves, no forced re-aim.
- **Bounds win over exact angle preservation at extremes.** A minimap
  jump to a corner at max zoom-out with a grazing angle would need the
  camera far outside the world to keep the offset exactly; the clamp
  shortens it instead. Centering and normal-range jumps are unaffected.
- **No README change.** View-behavior fix, no architectural change — same
  call as tasks 36/88/103/107/109.

## Verification

- `yarn workspace @scorched-3d/web test src/renderer/cameraPan.test.ts src/renderer/cameraZoom.test.ts src/renderer/cameraStart.test.ts`: 3 files / 70 tests pass.
- `yarn workspace @scorched-3d/web test src/renderer/minimap.test.ts`: 30 pass.
- `yarn typecheck` — clean; `yarn workspace @scorched-3d/web build` succeeds (renderer touched).
- Playwright not run (per task rules).
