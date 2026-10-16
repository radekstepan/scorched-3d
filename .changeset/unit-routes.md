---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Units now patrol the battlefield on seeded looping routes at per-kind speeds, hulls facing travel while turrets track and fire on the move.

## Task writeup (moved from docs/tasks/10-unit-routes.md)

# Task 10 — Unit patrol routes

## What changed

Units are no longer parked where they spawn: every unit now drives a seeded
looping patrol route at a per-kind speed, hull facing the direction of
travel, while turrets keep tracking combat targets independently and firing
on the move. All existing caps (6 shots / 8 explosions / 2 lights /
48 scorch) are unchanged.

- `packages/core/src/units/movement.ts` (new) — framework-free patrol logic,
  exported from `packages/core/src/index.ts`: `MOVE_SPEED` per kind
  (Flash 58 > Stumpy 40 > Commander 32 > Hammer 26 world u/s),
  `ROUTE_WAYPOINTS = 4` / `ROUTE_RADIUS_CELLS = 45` / `ARRIVE_RADIUS = 14` /
  stop–slow spacing radii, `planRoutes()` (waypoint 0 = spawn cell, the rest
  sampled on dry, gentle ground within patrol radius on a fresh
  `seed ^ 0x3ec1` stream), `initMover()` / `advanceMover()` (arrive → rotate
  to the next leg, hull steps at the shared `HULL_TURN_RATE`, forward drive
  along the hull with alignment grip — full speed lined up, 0.3 spun
  around), `spacingScale()` (0 inside 30 u, 0.35 inside 72 u, else 1), and
  `advanceMovers()` (whole-column step with pairwise spacing).
  `worldFromCell()` / `cellFromWorld()` / `sampleGround()` bridge grid and
  world frames for the renderer.
- `packages/core/src/units/movement.test.ts` (new) — 16 vitest cases.
- `apps/web/src/renderer/movement.ts` (new) — thin `UnitMovement` driver:
  seeds movers from live bodies, applies positions + hull yaw per tick
  (turret subgroups untouched), re-seats Y via `groundY` every tick and on
  `resnap()`, and reports per-unit shifts through `onShift` so recoil
  anchors follow. Owns no scene objects; `dispose()` just stops updates and
  regen builds a fresh instance.
- `apps/web/src/renderer/movement.test.ts` (new) — 5 vitest cases driving
  the real class against hand-made groups (no renderer needed).
- `apps/web/src/renderer/combatFx.ts` — new `setExternalHull()` mode (hulls
  stay on their patrol heading, only turrets slew the clamped remainder —
  aimed shots still leave down the turret line) plus `shiftRecoilBase()`
  (recoil anchors track patrol motion, so the 0.28 s kick restore never
  snaps a driving hull backward). Default internal-hull behavior is
  byte-for-byte the old traverse, so existing tests hold.
- `apps/web/src/renderer/combatFx.test.ts` — 2 new cases: hulls never yaw in
  external mode while turrets clamp and fire, and exactly the firing hull
  rides a shifted anchor home through `clearTransients`.
- `apps/web/src/renderer/TerrainCanvas.tsx` — builds `UnitMovement` from
  `planRoutes(map, map.units, map.seed)` per regen, enables external hulls,
  ticks movement before combat, re-seats via `movement.resnap()` after
  `clearTransients()` on exaggeration change (movement X/Z is authoritative;
  the reverse order would restore stale recoil bases), and disposes on
  unmount/regen.
- `apps/web/src/App.tsx` — legend copy now reads "Patrolling TA roster".
- `.changeset/unit-routes.md` (new) — **minor** changeset for core + web
  (new visible feature).
- `README.md` — one-line patrol mention in the demo description.

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted, no retail pathfinder here):

- `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`
  §8 outcome table — patrol arrival is `code 6 rotate to the next patrol
  point`. Mirrored by the looping `leg` advance: reaching a waypoint rotates
  to the next, forever.
- Same spec, MOVEINFO profiles + `[R-COLL-01 §1]` — cells are gated by
  slope/depth thresholds per mover, and a blocked mover "keeps turning,
  speed capped at half `MaxVelocity`". Mirrored by the dry + gentle waypoint
  acceptance and by the alignment grip (slow in turns) plus stop/slow
  spacing instead of full avoidance.
- `internal/content/compile_unit.go` unit-record fields (`MaxVelocity`,
  `TurnRate`, `BrakeRate`, `Acceleration`) — collapsed to per-kind
  `MOVE_SPEED` plus the shared hull turn-rate caps from `facing.ts`, instead
  of fixed-point yard-map stamping.

## Decisions

**Hulls belong to movement, turrets to combat.** The task pins hull = travel
direction and turrets = independent target tracking, so `CombatFx` in live
play never yaws a hull: `ensureAim()` re-syncs hull poses from live mesh
rotation every frame and `slewPending()` steps only the turret. Headless
tests keep the old hull-traverse behavior (external mode off), which is why
the existing astern/traverse suites pass untouched.

**Forward drive, not steering to the point.** Velocity runs along the hull
with speed scaled by alignment, so hard corners produce visible turning arcs
at capped rates rather than sliding or snapping. Spacing is slow/stop only —
a unit holds inside 30 u of another and crawls inside 72 u — because full
avoidance/repathing is explicitly the next task.

**Routes read the field, never reseed it.** `planRoutes` takes its own
`seed ^ 0x3ec1` stream (fresh constant per the learnings §3 rule) and only
reads heights, so terrain heightfield snapshots and unit placement snapshots
cannot shift. Routes are derived per regen in the canvas rather than stored
on `TNTMap`, keeping the map type stable.

**Recoil anchors follow the hulls.** The kick stores its restore point at
fire time; a driving unit would be restored up to ~15 u backward. Each
movement tick shifts active anchors by the hull delta, so the kick still
reads as a backward nudge on top of motion and `clearTransients` stays exact.

**Known limitation: minimap markers show spawn cells.** The minimap bakes
unit markers at regen while hulls now drive up to ~45 cells away. Redrawing
markers per frame would cost a canvas upload per tick; live minimap tracking
stays future work.

## Verification

- `yarn test` — all pass (16 new core movement tests + 5 new movement
  tests + 2 new combatFx tests; totals 83 core + 66 web).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
