---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The Waypoints overlay now traces the line each unit will actually drive — a forward simulation through the same turn-rate caps, alignment grip, and terrain gating the movers use, so corners read as arcs and walls read as stops — instead of straight waypoint-to-waypoint chords.

## Task writeup (moved from docs/tasks/46-waypoint-path-take.md)

# Task — Waypoints show the driven path, not the waypoint chords

The overlay drew straight lines from the hull through the waypoint list,
but hulls never drive straight lines: `driveToward` turns the hull toward
each leg at a capped rate while driving forward along the hull with an
alignment grip, so every corner is an arc — and terrain gating, drag, and
separation bend the line further. The overlay promised chords; the hulls
drove curves.

## What changed

- Core (`packages/core/src/units/movement.ts`): new pure
  `predictDrivenPath(kind, mover, route, terrain?, step?, maxSteps?)` —
  simulates `advanceMover` forward from the live state (spacing 1, no
  crush) and records the hull positions. Orders run to arrival-hold,
  patrols run until the leg wraps once; a 24-stall-step rule ends pinned
  trails where the hull sits ("can't climb that") instead of burning the
  320-step / 80 s budget. `PREDICT_STEP = 0.25` keeps arcs tessellated
  through a flash's 2 rad/s yaw. Never mutates the mover or the field.
- Renderer (`apps/web/src/renderer/waypoints.ts`):
  - Both live lines (amber order tail, slate patrol trail) now paint the
    predicted driven polyline via one shared `livePath()` + `paintLine()`,
    with a straight-tail fallback when the prediction stalls on step one
    (ordered-into-a-wall still shows its intent). The destination diamond
    pins the true ordered point, since the driven line may stop short
    (arrival radius, wall).
  - `WaypointFx` takes an optional `field` in its env (the canvas passes
    the map, the same `SeatField` movement drives) so trails refuse the
    slopes hulls refuse; without it they still arc. `update()` takes a new
    `WaypointMovement` interface (`moverState` / `isDestroyed` / optional
    `kindAt`, default flash) — old two-method callers keep working, and
    `UnitMovement` gains `kindAt()` so arcs use per-kind speed/turn rate.
  - Hidden overlay skips the re-simulation (up to hundreds of drive steps
    per unit per tick); toggling on repaints instantly from stashed movers.
- Canvas (`TerrainCanvas.tsx`): passes `field: map` into `WaypointFx`.
- HUD (`App.tsx`): legend now reads "the line each unit will actually
  drive".
- Tests: 6 new core cases (`movement.test.ts` — silence rules, order
  run-to-dest, full-loop waypoint visiting, crosswise-hull corner cut,
  wall refusal + purity, determinism) and 2 new web cases
  (`waypoints.test.ts` — arcs differ by kind, hidden freeze + toggle
  repaint); 3 existing web cases updated to driven-line expectations.
- `.changeset/driven-waypoint-paths.md` (new) — **patch** for core + web
  (view-only enhancement).

## Important decisions

- **Predict, don't decorate.** Smoothing or fattening the chords would
  still lie near walls and U-turns. Reusing the real `advanceMover` as the
  predictor guarantees the trail and the hull can never disagree about
  turn shape, drag, or gating — the only deliberate gaps are crowd spacing
  (intent, not traffic) and tree crush (would mutate the damage field).
- **One future per hull stays.** Prediction slots into the existing mode
  rule (amber order vs slate patrol vs nothing) — only the polyline source
  changed, so tracer animation, holder/wreck silence, next-waypoint
  scaling, resnap, and occlusion behavior are untouched.
- **No README change.** View-only overlay enhancement, same call as the
  previous waypoint tasks; the HUD legend documents it in place.

## Verification

- `yarn test` — all pass (core + web, incl. 8 new driven-path tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
