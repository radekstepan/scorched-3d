# Task 97 — Minimap clicks land the clicked point in the center of the view

Clicking the HQ (or anywhere else) on the minimap moved the orbit target to
that X/Z but kept the target's old height. The orbit target is what the
camera looks at, so the clicked surface point sat above/below the view-center
ray and — on oblique close-up views — rendered far off-center (a ~31° miss
at a 48° fov in the regression test: the clicked point left the frame).

## What changed

- `renderer/minimap.ts`: `jumpCameraTo` takes an optional
  `sampleY(x, z)` ground-height sampler. The destination is clamped first
  (same edge margin as keyboard pan), the height is sampled at the clamped
  point, and camera + target translate by the same full 3D delta — so the
  position→target offset vector (yaw/pitch/zoom distance) is still preserved
  exactly, but the orbit target now coincides with the clicked surface point
  and projects to the screen center at any angle. Non-finite samples (and
  omitting the sampler) fall back to the old height-preserving behavior.
- `renderer/TerrainCanvas.tsx`: the tick passes its live `groundY`
  (bilinear terrain height × exaggeration, minus crater bowls, edge-clamped
  sampling) as the sampler.
- Tests: `minimap.test.ts` pins seating (target becomes the clicked surface
  point, full offset/distance preserved), clamped-edge sampling coordinates,
  non-finite fallback, and a headless three.js projection regression test
  (old path >0.5 NDC off-center, seated path <1e-6); `App.minimap.test.ts`
  pins the canvas→`groundY` seating wiring at source level.
- Changeset: `.changeset/minimap-center-click.md` (patch).

## Verification

- `yarn test` — full suite passes.
- `yarn typecheck` clean.
- Playwright not run (per task rules).
