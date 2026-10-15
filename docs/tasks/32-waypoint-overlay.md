# Task — Waypoint overlay toggle in the View menu

Units already patrol seeded looping routes and drive player-issued move
orders, but neither was visible. The View panel gains a `Waypoints` toggle
(off by default) that overlays both: every live unit's patrol loop plus its
in-progress order path.

## What changed

- Core (`packages/core/src/terrain/types.ts`): `ViewOptions` gains
  `showWaypoints: boolean` (view-only flag, no sim logic).
- App (`apps/web/src/App.tsx`): default `showWaypoints: false` plus a
  `Waypoints` toggle in the View panel.
- Renderer (`apps/web/src/renderer/waypoints.ts`, new): `WaypointFx`
  owns one `THREE.Group` in the scene —
  - patrol loops as slate `LineLoop`s (`WAYPOINT_PATROL_COLOR`) with an
    octahedron diamond on every waypoint, static per regen;
  - live order paths as amber `THREE.Line`s (`WAYPOINT_ORDER_COLOR`)
    from the hull through the mover's remaining order points, with a
    larger destination diamond, rebuilt per tick;
  - lines ride at `groundY + WAYPOINT_LIFT` so they never z-fight the
    mesh, at render order 9 (above scorch decals, below selection
    markers); depth-tested so hills occlude them naturally.
  - pure helpers `isHoldingRoute()` (degenerate all-coincident routes
    draw no loop) and `remainingOrderPoints()` (live position +
    unvisited order points) are exported for tests.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): builds `WaypointFx`
  from the same `planRoutes()` result as movement, ticks
  `setVisible(opt.showWaypoints)` + `update(movement, count)` after
  `movement.update()`, re-seats via `resnap()` on exaggeration change,
  and disposes on unmount/regen.
- Tests (`apps/web/src/renderer/waypoints.test.ts`, new): 6 vitest cases
  driving the real class headless (no WebGL) — route helpers, one loop
  per live unit, hold-route/wreck hiding, order tracking + arrival
  hiding, toggle + resnap heights.
- `.changeset/waypoint-overlay.md` (new) — **patch** for core + web
  (view-only addition).

## Important decisions

- **Patrol loops show the full loop, orders show the remainder.** The
  patrol is a static future the unit will keep walking, so the whole
  closed loop draws; an order is a one-shot errand, so only the
  unvisited tail draws (live position → remaining points → destination).
- **Wrecks and holders show no patrol.** A destroyed hull holds forever
  and a degenerate hold-route parks in place — drawing a loop for either
  would promise motion that never comes.
- **Amber orders vs slate patrols.** Selection already owns white/cyan
  and move pings flash cyan, so patrols take neutral slate (always a
  background layer) while orders take amber — the RTS-standard "this
  unit is going somewhere" accent.
- **No README change.** This is a small view toggle, not an architecture
  or complex feature; the View panel is self-documenting.

## Verification

- `yarn test` — all pass (229 core + 172 web, 6 new waypoint tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
