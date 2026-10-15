# Task 102 — Minimap click centers the clicked point at any angle and zoom (verification)

Task 102 asked that clicking the minimap place the clicked item in the
center of the view given the current angle and zoom. Prior work already
implemented exactly this (task 83: `minimapPointToWorld` + offset-preserving
`jumpCameraTo`; task 97 / commit `4ef4269`: seat the orbit target onto the
terrain height via `groundY` so the clicked surface point coincides with
`controls.target` and projects to screen center; commit `ec0be30`: the
original angle/zoom-preserving jump). I verified the current code path
precisely and found no remaining gap, so this task pins the behavior with
regression tests rather than re-implementing it.

## Verification (no gap found)

- `App.tsx` `jumpFromMinimap`: pointer → `minimapPointToWorld(clientX,
  clientY, rect, worldW, worldD)` → sequenced `{x, z, seq}` jump; same
  uv math as the overlay dots/HQ markers, so the clicked icon and the jump
  destination agree.
- `TerrainCanvas.tsx` tick: `jumpCameraTo(camera.position,
  controls.target, jump, worldW, worldD, groundY)` before
  `controls.update()`; `groundY` is the live bilinear terrain height ×
  exaggeration minus crater bowls. Pan/zoom code paths untouched.
- `renderer/minimap.ts` `jumpCameraTo`: destination clamped to map bounds
  (same edge margin as keyboard pan via `clampPanTarget`), height sampled
  at the *clamped* point, camera + target translated by the same full 3D
  delta — so the position→target offset vector (yaw/pitch/zoom distance,
  i.e. OrbitControls azimuthal/polar angles + radius) is preserved exactly
  while the target becomes the clicked surface point, which is what the
  camera looks at (screen center) at any angle.

## What changed

- `apps/web/src/renderer/minimap.test.ts`: new `describe` block (10 cases:
  azimuths 0/45/90/180/270° × near 300 / far 4000 zoom at 60° polar)
  asserting per case that (a) the orbit target becomes the clicked surface
  point, (b) azimuthal angle, polar angle, and zoom distance are preserved,
  and (c) the clicked point projects to NDC (0,0) through a headless
  three.js camera — the exact "item in the center of the view" criterion.
- `.changeset/minimap-center-angles.md` (patch; new filename to avoid
  colliding with task 97's still-present
  `.changeset/minimap-center-click.md`).

## Decisions

- No production code change: re-implementing would risk regressing the
  already-correct seating/clamping. The value-add is the angle×zoom matrix
  pinning the spherical math explicitly (prior tests covered one
  angle/zoom only).
- Changeset filename avoids colliding with task 97's still-present
  `.changeset/minimap-center-click.md`.

## Test evidence

- Targeted: `minimap.test.ts` — 22/22 pass (12 prior + 10 new).
- Full `yarn test` (web): 488/489 pass; the single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire") is
  pre-existing — verified failing on the clean tree via `git stash`, same
  failure documented in task 99.
- `yarn typecheck` — clean.
- Playwright not run (per task rules).
