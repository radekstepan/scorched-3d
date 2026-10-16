---
"@scorched-3d/web": patch
---

Fix camera flipping backwards when panning into a map corner or edge. The orbit target clamp now carries the camera with it, so forward motion stops at the bound while the viewing angle is retained.

## Task writeup (moved from docs/tasks/109-pan-corner-clamp.md)

# Task 109 — Pan stops at corners instead of flipping the view

Panning into a map corner/edge (keyboard or right-drag) made the view
suddenly flip backwards. Root cause: the tick clamped only
`controls.target` to the map while the camera kept travelling — at the
bound the camera crossed over the stuck target, inverting the
position→target vector (and the polar/azimuth angle with it).

## What changed

- `cameraPan.ts`: new `clampPanTargetWithCamera(target, position, worldW,
  worldD)` — clamps the target exactly like `clampPanTarget` (same
  `PAN_EDGE_MARGIN` bounds) but carries the camera position by the
  clamped-away delta, so the viewing offset (yaw/pitch/distance) never
  changes. Forward motion stops per axis at the bound; sliding along a
  blocked edge still works. `clampPanTarget` itself is untouched (still
  used by `minimap.ts`, which already moves its camera by the clamped
  delta — i.e. minimap jumps never had this bug).
- `TerrainCanvas.tsx`: both clamp sites now use the new helper —
  keyboard pan (after `applyPan`) and the post-`controls.update()`
  re-clamp that covers right-drag pan and cursor-anchored zoom-target
  migration.
- Tests: `cameraPan.test.ts` gains a `clampPanTargetWithCamera` suite
  (edge stop retains angle, corner stop on both axes, slide-along-edge,
  in-bounds no-op, camera height untouched); `cameraZoom.test.ts`
  re-pins the post-update clamp on the new helper name.

## Important decisions

- **Stop, don't bounce or re-orbit.** Per the request: blocked axes drop
  their component, free axes keep moving, angle retained — no flip, no
  forced re-aim.
- **One helper for both pan paths.** Keyboard and OrbitControls pans had
  the identical target-only clamp bug; the same carry-the-camera fix
  covers both, plus zoom-to-cursor target migration for free.
- **No README change.** View-behavior fix with no architectural change,
  same call as tasks 36/88/103/107.

## Verification

- `yarn workspace @scorched-3d/web test src/renderer/cameraPan.test.ts src/renderer/cameraZoom.test.ts`: 2 files / 46 tests pass.
- `yarn test`: 505/508 pass; the 3 failures
  (`combatFx.test.ts` — dead-hull fire, 2 lob-aiming cases) are
  pre-existing, failing identically on the clean tree with this change
  stashed, and unrelated (combat FX, no camera touch).
- `yarn typecheck` — clean; `yarn build` succeeds (renderer touched).
- Playwright not run (per task rules).
