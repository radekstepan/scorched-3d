---
"@scorched-3d/web": patch
---

Fix minimap click-to-center destroying the view: clicking the minimap (e.g. an HQ marker) now transports the camera to the clicked point with the zoom level and viewing angle preserved and the clicked item in the middle of the screen. Previously the world-bounds camera clamp yanked the fresh teleport back inside its rectangle, collapsing zoom and swinging the angle on most mid/far-view jumps; jump-placed cameras are now exempt from that clamp until they drift back inside on their own.

## Task writeup (moved from docs/tasks/120-minimap-click-center.md)

# Task 120 — Minimap clicks survive the camera clamp (zoom + angle preserved, click centered)

## Symptom

Clicking the minimap (e.g. on an HQ marker) did not transport the view to
that area with the clicked item centered: the view reframed violently to a
different zoom and angle instead. Prior tasks (83/97/102/112) had verified
the math pipeline — `minimapPointToWorld` → sequenced jump →
offset-preserving, terrain-seated `jumpCameraTo` — with bare-camera NDC
tests, yet the bug persisted in the browser.

## Root cause

Task 118's `clampCameraToWorld` (post-`controls.update()`, every tick)
yanks the jump-placed camera back into the ±3190×±2550 rectangle. A minimap
jump is a rigid translation whose offset IS the requested zoom/angle, so
when the preserved offset lands outside that tight rect — the common case
for mid/far views jumping to a map-end HQ — the clamp destroys the request:
a headless reproduction through REAL `OrbitControls` (same settings as the
canvas) measured a far-east-view → east-HQ click collapsing zoom ~2.6x
(dist 3374 → 1314) and swinging the polar angle ~38° (71° → 33°), with the
clicked point out of frame (NDC r≈1.7) on the jump tick because the yank
lands after `update()` aimed the camera. Even center-ish clicks with
|camera.z| > 2550 were mangled. Task 118 had accepted this as an
"extremes" tradeoff — the probe shows it bites routine jumps.

## What changed

- `renderer/cameraPan.ts`: new pure predicate `isCameraOutsideWorld`
  (same bounds as the clamp, read-only; height ignored like the clamp).
  `clampCameraToWorld` semantics unchanged.
- `renderer/TerrainCanvas.tsx`: the tick sets a `jumpPlacedCamera` flag
  when it applies a minimap jump, both `clampCameraToWorld` sites (keyboard
  pan, post-`update()`) skip while the flag holds, and the flag clears via
  the re-entry check once the camera drifts back inside. The target clamps
  are untouched, so the focus never leaves the world.
- Tests:
  - `renderer/minimap.test.ts`: task-120 block driving real
    `OrbitControls` headless (stub DOM, canvas settings) — exempt jumps
    preserve dist/azimuth/polar and center NDC≈0 on the jump tick (two
    poses); a contrast test pins the pre-fix collapse (out-of-frame flash,
    zoom/angle gone after settling); a lifecycle test pins no delayed yank
    over five quiet ticks, re-entry clearing, and the clamp trimming
    gradual drift again afterwards.
  - `renderer/cameraPan.test.ts`: `isCameraOutsideWorld` suite, including
    exact agreement with the clamp (a mismatch would yank jumps or exempt
    drift).
  - `App.minimap.test.ts`: source-level wiring pins (flag set at the jump
    site, both clamp sites conditional, re-entry check present) — the
    canvas needs WebGL, so the tick itself is pinned by source like the
    existing minimap wiring.
- Changeset: `.changeset/minimap-click-center.md` (patch).

## Important decisions

- **Exempt until re-entry, not for one tick.** Skipping the clamp on the
  jump tick alone just delays the yank by one frame (the camera is still
  outside on tick 2). The exemption must persist until the camera comes
  back inside on its own (zoom in / pan / orbit) — then gradual motion is
  trimmed smoothly every tick with no snap.
- **No rigid-shift or dolly-fit alternative.** Shifting target+camera
  together would preserve the offset but break centering; dollying the
  offset to fit would preserve the angle but break the requested zoom.
  Only yielding the bounds satisfies all three demands (transport +
  zoom/angle + centered).
- **Task 118 stays intact.** The pure clamp, its unit tests, and both call
  sites are unchanged in shape (the 118 wiring pin still counts 2 sites);
  non-jump flows (orbit/zoom/pan drift) are still reeled in. The only
  behavior change: a jump-placed camera — an explicit teleport to an
  in-bounds focus, a good view by construction — is not yanked until it
  re-enters. Documented tradeoff: 118's eye-inside-rect protection pauses
  in that window (the target clamp still holds the focus in the world).
- **No README change.** View-behavior fix, no architectural change.

## Verification

- Touched: `minimap.test.ts` + `cameraPan.test.ts` + `App.minimap.test.ts`
  — 90/90 pass.
- Full `yarn test`: core 510 + web 569 pass, 0 failures.
- `yarn typecheck` — clean.
- Playwright not run (per task rules).
