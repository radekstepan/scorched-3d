---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Start the view from behind a command unit: on every map load the camera opens outside the map edge behind the first Commander (any unit, else map center), looking inward through it.

## Task writeup (moved from docs/tasks/05-commander-camera.md)

# Task 2 — Commander camera start

## What changed

Every map load/regen now opens **from behind a command unit, outside the map
looking in**, instead of the previous fixed southwest overview.

- `apps/web/src/renderer/cameraStart.ts` (new) — framework-free pose helpers:
  `pickStartUnit()` (first `commander` in roster order, else first unit, else
  null), `commanderCameraPose()` (orbit target on the unit's ground anchor;
  camera further out on the center-through-unit ray, past the map edge),
  `cellGround()` / `startGroundY()` (exaggerated anchor height),
  `resnapHeightDelta()` (ground-height delta across an exaggeration change).
- `apps/web/src/renderer/cameraStart.test.ts` (new) — 14 vitest cases.
- `apps/web/src/renderer/TerrainCanvas.tsx` — initial camera position and
  orbit target come from `commanderCameraPose(map, exaggeration)`; on
  exaggeration change the camera and target both shift by
  `resnapHeightDelta()` so the view keeps its geometry while the terrain,
  features, and units re-snap underneath.

## Decisions

Ray-through-unit, not a fixed offset: the camera sits on the ray from the
map center through the commander at `edge + START_BEYOND_EDGE` (350 world
units past the rectangle exit), so it is outside the map regardless of which
side the commander spawned on, and the opening frame always looks through
the commander toward the interior. A commander dead on the center falls back
to a southern viewpoint. Camera height is `anchor + 0.25 × max dimension`
(~636 on the standard map), matching the previous eye height; the resulting
~2k distance sits comfortably inside the orbit `maxDistance` of 4200, so
zoom, orbit, and the task-1 keyboard pan all work unchanged from the first
frame.

Determinism comes for free: `placeUnits()` is seeded, and the pick is first
commander in roster order (first unit / map-center-south fallbacks need no
RNG). The helper takes a minimal structural field (`width`, `height`,
`heights`, `seaLevel`, `units`) with `TNTMap`/`PlacedUnit` fitting
structurally, and defines its own `START_CELL_PIXELS = 16` rather than
importing core, keeping it dependency-free and node-testable like
`cameraPan.ts`. Nanolathe was checked for spawn/camera conventions but has no
applicable opening-camera convention (its spawn logic is battle-state, not
camera framing), so the design follows the local orbit-camera idioms instead.

Exaggeration re-snap is a pure vertical translation of camera + target by the
anchor's ground-height delta. This preserves any orbiting/panning the player
has done since load, unlike re-aiming at the anchor, and keeps the camera
above the re-scaled terrain.

## Verification

- `yarn test` — all pass (14 new camera-start tests + 17 camera-pan + 28
  pre-existing core tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
