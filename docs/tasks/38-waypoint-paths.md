# Task — Waypoint overlay shows each unit's live path

The Waypoints toggle used to draw static context: full patrol loops that
never moved plus amber order tails. Patrols gave no sense of direction —
no indication of which waypoint a hull was steering at, or where the hull
was along its loop — so the overlay looked frozen even mid-battle.

## What changed

- Renderer (`apps/web/src/renderer/waypoints.ts`):
  - New pure helpers `remainingPatrolPoints()` (live position + upcoming
    loop waypoints in visit order, wrapping leg → … → leg−1),
    `activeTrailMode()` (`"order"` / `"patrol"` / `null`), and
    `pointAlongPath()` (distance-along-polyline walk for the tracer).
  - New per-unit live layer: a bright-slate patrol **trail** rebuilt per
    tick from the mover's live position through its remaining loop, plus
    one animated **tracer diamond** per unit flowing along whichever live
    path is active (`WAYPOINT_FLOW_SPEED = 70 u/s`, per-unit stride offset
    so tracers never march in sync, looping modulo path length).
  - Ordered units keep their amber order tail and gain an amber tracer
    riding it; their patrol loop hides while ordered so the overlay
    promises exactly one future per hull. Arrival-holders and wrecks show
    no loop, no trail, and no tracer (previously an arrival-holder kept
    its patrol loop, promising motion that never comes).
  - The next patrol waypoint's diamond scales ×1.7 to mark the current
    leg; `update()` takes an optional `time` (defaults 0, old calls keep
    working) and `resnap()` re-seats trails + tracers with the terrain.
  - Cost is one small line rebuild + one mesh move per live unit per tick
    (~6 hulls × ≤5 points) — negligible next to combat/scene work; no
    allocations beyond the existing dispose-and-rebuild pattern, and all
    new GPU objects are disposed in `rebuildPatrol()`/`dispose()`.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): passes the render
  clock (`t`) into `waypoints.update()` so tracers animate.
- HUD (`apps/web/src/App.tsx`): Units panel gains a one-line waypoint
  legend (slate loop + travelling marker = patrol, amber = ordered move).
- Tests (`apps/web/src/renderer/waypoints.test.ts`): 10 new vitest cases
  — patrol-trail ordering/wrapping, holder/order/hold-route emptiness,
  mode resolution, polyline walking + end clamping, live trail contents,
  ordered patrol-hiding with amber tracer, holder/wreck silence, tracer
  advance + wraparound, resnap re-seating of trail/tracer heights.
- `.changeset/live-waypoint-paths.md` (new) — **patch** for core + web
  (view-only enhancement).

## Important decisions

- **One future per hull.** Showing the full patrol loop *and* the order
  tail for an ordered unit reads as two simultaneous plans. The loop hides
  while an order drives (and after arrival-hold), so color alone tells the
  story: slate = walking its patrol, amber = driving your order, nothing =
  holding still.
- **Motion via tracers, not shaders.** Marching-ants dashes would need
  custom shader work on `LineDashedMaterial` (no dash-offset uniform);
  a single flowing diamond per unit shows direction through motion itself,
  costs almost nothing, and stays readable at any zoom.
- **Trail restarts at the hull.** The static loop stays as faint context,
  but the bright trail begins at the live position — the "path trying to
  take" — so a hull halfway around its loop no longer appears to promise
  the half it already drove.
- **No README change.** View-only overlay enhancement, same call as the
  original overlay task; the HUD legend line documents it in place.

## Verification

- `yarn test` — all pass (core + web, incl. 16 waypoint tests total).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
