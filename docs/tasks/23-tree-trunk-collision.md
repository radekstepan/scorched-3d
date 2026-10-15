# Task 23 — Units stop clipping through tree trunks

Units used to drive straight through standing trees: woods only cost extra
A* weight (+1.25) and bled speed to 0.6×, so every hull going anywhere near a
forest threaded its trunks. Trunks now collide at three levels, all
deterministic (fixed scan orders, fixed candidate lists, no RNG) and all
keyed off the static attribute grid, so replays and seeded maps are
untouched.

## What changed

- Trunk keepout circles (`pathfinding.ts` `TRUNK_RADIUS` 4 +
  per-kind hull flank → 11–14 world units; `terrain.ts` `trunkKeepoutFor`,
  `hullBodyRadius`). Radius 4 matches the instanced trunk geometry (base
  3.2, scaled to ~3.7); canopy overhang is deliberately excluded — hulls
  may pass under branches, never through wood.
- Pathing (`pathfinding.ts`):
  - A* diagonal steps now need both orthogonal neighbours walkable *and
    trunk-free* (a diagonal past a trunk grazes its keepout at ~11u even
    with open sides). Orthogonal threading keeps ≥16u clearance, so it
    stays legal.
  - Smoothing refuses legs within generic keepout (14, widest hull) of any
    trunk (`legClipsTrunk` + shared `segmentPointDistSq`) — this catches
    corner grazes whose samples never land on the tree cell itself.
  - `nearestWalkable` and the formation rescue scan prefer trunk-free cells
    in a first pass, falling back to any walkable cell in dense woods;
    `findWorldPath` nudges intermediate tree-cell waypoints onto open ground
    and re-pulls once.
- Drive (`terrain.ts`, `movement.ts`):
  - `stepBlocked` (new optional kind) refuses steps entering a keepout;
    split out `terrainStepBlocked` (water/steep only) so drivers can tell a
    hard wall (hold, as before) from wood.
  - Trunk-only blocks slide: ideal deflected bearings (±15–60°, forward
    hemisphere) are evaluated with the hull assumed turned, the capped turn
    swings toward the first free one, and the hull drives once the lagged
    step opens. Slides count as pinned time, so patrols still skip wood
    they can never clear and orders keep working around it.
  - `pushOutOfTrunks` march-out + per-tick ease (`TRUNK_PUSH_SPEED` 30,
    `stepBlocked`-gated with axis-slide fallback) rescues spawns parked on
    trunks; steps starting inside a keepout are exempt from that trunk's
    pass-through test, otherwise the final exit step could never leave.
  - Patrol waypoints skip trunk cells (spawn waypoint 0 exempt — relaxed
    placement may drop it on a trunk, and the exit rule + push-out ease it
    out).
- A straight order into a solid belt now holds at the first trunk line like
  a steep wall; pathfound orders detour around and arrive. The old
  "pushes through tree belts and arrives" test is replaced by hold / detour
  / push-out tests.

## Important decisions

- **Felled trees keep blocking.** Toppled/stump/snag instances persist
  (fell, don't remove), so the wood is still there. This also keeps live
  `DamageField` state out of deterministic core pathing — no repathing, no
  seed perturbation (same reasoning as task 18's visual-only damage).
- **Cells stay walkable.** Blocking whole 16u cells for 4u trunks would
  turn sparse woods into walls; keepout circles + corner rule + slide keep
  isolated trees threadable while dense stands honestly hold.
- **No retreat slides.** Deflections stay in the forward hemisphere — a
  blocked hull slides around wood, never moonwalks away from its goal.
- **Rocks untouched.** Boulder clipping is the same class of bug but out of
  scope; rocks keep cost + drag only.
- **X/Z only, so exaggeration re-snaps are unaffected** (re-seats pose Y,
  never move X/Z) — covered by a web test asserting X/Z survive `resnap()`.

## Verification

`yarn build`, `yarn typecheck`, `yarn test`: 197 core + 134 web tests pass,
including new trunk suites in `terrain.test.ts` (keepout sizing,
endpoint/segment/escape rules, march-out incl. overlapping keepouts),
`movement.test.ts` (single-tree arrival, belt hold, belt detour arrival,
spawn push-out, real-map patrol waypoint avoidance), `pathfinding.test.ts`
(corner-graze flag, smoothing refusal, trunk-free snaps + dense fallback,
trunk-free formation), and a web `UnitMovement` integration test (belt
detour arrival with per-tick keepout asserts + resnap X/Z stability).
