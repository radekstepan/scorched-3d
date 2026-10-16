---
"@scorched-3d/web": patch
---

Close-up zoom backed off and holds its angle: the zoom floor returns to 30 world units (was 15, which showed half a hull and felt too close), and the render tick now floors the orbit target on the terrain so max zoom no longer pitches fully vertical.

## Task writeup

# Back off max zoom and keep the view angle

Two complaints in one: the close-up was too close, and at max zoom-in the
view angle snapped to completely vertical.

## What changed

- `cameraPan.ts`: `MIN_ZOOM_DISTANCE` is 30 again (restoring the task-82
  floor). 30 frames a single ~26-unit tank hull (~27 units tall at the 48°
  fov); the 15-unit floor showed half a hull. It also keeps a typical
  close-up pitch above the 6-unit surface floor (30·cos(74°) ≈ 8.3), so
  center zoom preserves the angle exactly instead of steepening onto the
  floor. New exported `clampTargetAboveSurface` helper: holds the orbit
  target at or above the local terrain with zero clearance (a focus point
  may rest exactly on the dirt — the same seating minimap jumps use).
- `TerrainCanvas.tsx`: the tick now floors the target's final terrain
  column right after the eye floor, with no jump exemption (an underground
  focus is never a valid request, same rationale as the eye).
- Tests: `cameraPan.test.ts` re-pins the 30 floor and unit-tests the new
  helper; `cameraZoom.test.ts` gains a tick-chain regression suite proving
  close-ups arrive at the zoom floor with the pitch intact, a test
  documenting the old vertical snap, and a wiring pin for the new tick call.

## Why the view went vertical (root cause)

Pure OrbitControls cursor zoom preserves pitch exactly — the snap came from
the canvas tick chain. Every wheel tick re-seats the orbit target along the
camera's downward forward ray, while `clampCameraAboveSurface` holds only
the eye up: zooming toward low ground sank the target ~390 units
underground, the camera→target offset stretched ~13x past the zoom floor,
and the view pitched to 0.2° (straight down). Headless reproduction against
the real OrbitControls confirmed it, and showed that backing off to 30
alone does NOT fix the snap — the target floor is the actual fix, and with
it in place no `minPolarAngle` was needed (orbiting to top-down still
works). Measured end states (start pitch 73.9°): center zoom holds 73.9°
exactly; low-cursor zoom settles at 78.5° on the eye floor.

## Verification

- `yarn test` — full suite passes except the 1 pre-existing
  `deployPages.test.ts` workflow-yaml failure (present on the untouched
  tree, unrelated).
- `yarn typecheck` clean, `yarn build` succeeds (renderer changed).
- Playwright not run (per task rules).
