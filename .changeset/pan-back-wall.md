---
"@scorched-3d/web": patch
---

Stop pan-back at a wall behind the camera instead of warping the angle: the camera reaches its world bound first when panning backwards, and the target now stops with it (carried by the clamped delta, per axis) so the viewing angle is retained exactly — the target can no longer catch the pinned camera, collapse the ground-plane forward basis, and snap the view top-down. Orbiting and cursor-anchored zoom at the edge keep the old reel-in behavior so the focus point stays put.

## Task writeup (moved from docs/tasks/136-pan-back-wall.md)

# 136 — pan-back wall

Task: when we pan "back" at some point we need to stop — right now the
angle warps. Just stop as if there was a wall behind us.

## The warp mechanism

The camera sits behind the orbit target, so panning backwards drives the
camera into its world bound first. The tick then ran `clampCameraToWorld`,
which pins the camera but lets the target keep advancing: the target
catches up to the pinned camera until both coincide on the ground plane
(xzDist → 0, reproduced: 1000 → 550 → 50 → 0 over four 500-unit steps).
With target and camera coincident, the ground-plane forward basis
collapses and the view snaps top-down / the pan basis flips — the reported
angle warp.

This is the exact mirror of the pan-forward bug fixed by
`clampPanTargetWithCamera` (task 109): there the target hit its bound
first and the camera kept travelling past it.

## Fix

- New `clampCameraToWorldWithTarget` in `cameraPan.ts`: clamps the camera
  to the world rectangle and carries the orbit target with the clamped-away
  delta, per axis — backward motion stops at the bound with yaw/pitch/
  distance retained exactly, and sliding along the wall still works.
- Keyboard-pan tick site uses the carrying clamp (rigid by construction).
- Post-`controls.update()` site branches on the new `isRigidPan` check
  (pre/post-update pose snapshot): right-drag pans translate target and
  camera by the same delta, so they hit the wall with the angle retained;
  orbiting/zooming move target and camera apart, so they keep the old
  reel-in (`clampCameraToWorld`) and the focus point stays put. A
  stationary target reads non-rigid, so quiet ticks and pure orbits always
  reel in. The minimap-jump exemption still guards both sites.

## Decisions

- Carry instead of reel-in for pans (not the reverse): at the wall the
  whole view freezes with zero visual change, which is the "wall" feel;
  reel-in would shorten the offset (visible zoom/angle shift) every frame
  at the bound.
- Kept the orbit/zoom reel-in rather than always carrying: carrying on
  orbit would drag the focus point along when the camera swings past the
  edge at far zoom, regressing task 118. The rigid-pan discriminator is
  ~10 lines and pinned headless through real OrbitControls.
- Epsilon 1e-6 for the rigid check: float64 rounding of identical pan
  offsets applied to different bases is ~1e-10 at these coordinates;
  the damped glide still detects as rigid every frame (proven in test).

## Tests

- `cameraPan.test.ts`: unit tests for the carrying clamp (wall stop with
  angle retained, corner, edge slide, in-bounds no-op, heights untouched);
  `isRigidPan` true/false/epsilon-boundary cases; a 40-step sustained
  pan-back regression (every step still pushes +Z, parks camera at 2550 /
  target at 1550 with the exact opening offset) plus a contrast test
  pinning the old-order collapse (xzDist → 0); headless real-OrbitControls
  tests (canvas settings: damping, polar clamp, zoom-to-cursor) proving a
  60-tick drag pan-back stops at the wall with separation exactly 1000
  throughout and `rigid === true` every frame, and that the orbit branch
  still reels in with the focus unmoved.
- Updated source-wiring pins: `cameraPan.test.ts` world-bounds wiring
  (2 carrying sites + 1 plain orbit/zoom site, rigid-branch shape) and
  `App.minimap.test.ts` jump-exemption test (both sites still conditional).
- Full web suite: 40 files / 632 tests pass; `tsc --noEmit` clean.
  No Playwright (unit/integration only).
