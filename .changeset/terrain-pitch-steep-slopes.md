---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Units now ride the terrain instead of sliding flat through it: hulls pitch and roll to the local grade, sit on bilinearly sampled ground at the highest track under their footprint, and refuse steps into too-steep or unwalkable ground (turning in place like retail's blocked movers, with patrols skipping past pinned legs).

## Task writeup (moved from docs/tasks/12-terrain-pitch-steep-slopes.md)

# Task 12 — Terrain pitch + steep-slope pathfinding

## What changed

Units no longer slide flat through hillsides. Hulls now pitch nose-up on upgrades, roll across fall lines, sit on continuously sampled ground at the highest track under their footprint, and refuse steps into too-steep or unwalkable ground — while pathfinding's steep gate (previously water-tested only) is now proven against synthetic ridges and densely sampled real-map legs.

- `packages/core/src/units/terrain.ts` (new) — framework-free seating/probing, exported from `packages/core/src/index.ts`: `sampleHeightBilinear()` (continuous world-space height, no mid-cell pops), `groundHeight()`, `hullPitchRoll()` (footprint-tap tilt in rendered heights, `YXZ`-frame signs, clamped to `MAX_HULL_TILT = 0.5`), `seatHull()` (max-of-5-taps height + `HULL_CLEARANCE`, per-kind `HULL_FOOTPRINT`; collapses to the old `groundY + 0.5` on flat ground), and `stepBlocked()` (destination `isWalkable` + raw point-grade over `MAX_DRIVE_GRADE = PATH_MAX_SLOPE / CELL_PIXELS`, so the drive clamp agrees exactly with the pathfinder gate).
- `packages/core/src/units/movement.ts` — `advanceMover()` / `advanceMovers()` take an optional terrain (`SeatField`, no `features` needed); blocked steps hold X/Z while the hull keeps turning (retail's blocked-mover behavior). `Mover` gains optional `stuck` seconds: patrol legs pinned past `BLOCKED_SKIP_AFTER = 2.5 s` skip to the next waypoint (patrol legs cut straight across terrain), while orders hold at the steep edge. Terrain-less stepping is byte-identical — the key stays absent unless blocking ever engages, so all existing patrol/order tests hold untouched.
- `packages/core/src/units/terrain.test.ts` (new) — 12 cases: bilinear corners/edges/flat, pitch/roll signs (climb/descend/cross), exaggeration scaling + cliff clamp, flat collapse, max-tap ride, real-map no-clip sweep (greenreach seed 7, every walkable cell × 4 yaws), `stepBlocked` flat/water/steep/gentle.
- `packages/core/src/units/movement.test.ts` — 3 new cases: ordered hull pins against a synthetic wall (turning, order live) while the terrain-less twin drives through; patrol skips a pinned leg; a 60 s full-column patrol on a real map never leaves walkable ground and keeps travelling.
- `packages/core/src/units/pathfinding.test.ts` — 4 new cases: steep (dry) ridge cells read unwalkable with the same shore parity as water, A* detours around a steep ridge, smoothing keeps the steep detour, and smoothed world legs sampled every 8 units stay walkable on all four presets (seed 11).
- `apps/web/src/renderer/movement.ts` — `MovementEnv.seat` (optional; flat `groundY + 0.5` fallback keeps headless tests honest), `YXZ` posing per tick + on `resnap()`, terrain threaded into `advanceMovers()`. Field type widened `UnitField` → `SeatField` (the driver never needed `features`; keeps test fields light). Turret subgroups still untouched. `movement.test.ts` — 3 new cases: nose-up pitch matching the core seat, exaggeration re-seat steepening tilt, cliff pinning over 20 s.
- `apps/web/src/renderer/units.ts` — `buildUnits()` / `placeUnitsGroup()` seat statically (grade tilt on build, tilt-only re-snaps preserving aim yaw); `setUnitAim()` keeps the `YXZ` order so aiming never flattens a posed hull. `units.test.ts` — 2 new cases: ramp tilt on build/re-snap with yaw preserved, flat maps still level.
- `apps/web/src/renderer/TerrainCanvas.tsx` — `groundY` is now bilinear (continuous for hulls, scorch, probes, pings) tracking live exaggeration; a `seat` closure feeds the driver.
- `.changeset/terrain-pitch-steep-slopes.md` (new) — **minor** for core + web (visible: tilting hulls, no clipping, slope-pinned driving).
- `README.md` — patrol clause extended with grade posing + steep refusal.
- `docs/architecture.md` — key-files table gains the units + renderer rows (was stale since task 08; new `terrain.ts` listed).

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted — retail stamps fixed-point yard maps under a budgeted scheduler; this samples a float heightfield synchronously):

- `internal/path/smooth.go` (`standable` / `clear`) — a leg is kept only when the mover footprint can stand all along it, probing half a footprint to either side. Mirrored by seating/probing at ±halfLen / ±halfWid taps instead of a single center sample (`seatHull`, `hullPitchRoll`).
- `internal/path/search.go` steep tier (`terrainTerm = 30` for steep cells, `SteepCost`) — steep ground is effectively unwalkable, not just slower. Mirrored by the shared binary `isWalkable` gate plus the hard `stepBlocked` clamp rather than a cost tier.
- `research/retail-executable-spec/04-units-orders-scripts-and-movement.md` MOVEINFO slope gating + blocked-mover outcome ("keeps turning, speed capped") — mirrored by the dry + gentle gate (unchanged) and the turn-in-place-while-pinned clamp.

## Decisions

**Two height frames on purpose.** Drive gating uses raw heights (must agree with the pathfinder's `isWalkable` gate, or blessed legs would read blocked); posing uses exaggerated heights (the tilt must match the rendered mesh). Mixed up once during development — caught by the real-map no-clip sweep.

**Binary steep refusal, not a cost tier.** The demo roster shares one movement profile and A* stays deterministic; the slope penalty some movers deserve in retail collapses to the same gate every unit already uses for placement, routes, and search. Revisit if per-kind profiles (e.g. a spider that climbs) ever land.

**Max-tap seating, not center seating.** A rigid hull rests on its highest corner — seating at the footprint max keeps the downhill track from burying at the cost of slight floating on sharp crests, which the pitch largely takes up. On flat ground every tap agrees, so flat behavior is exactly the old pose.

**Patrol skips, orders hold.** A patrol leg can straddle a slope its waypoints never anticipated, so patience expiry skips it (the demo keeps moving). A player-sent destination holds at the edge instead — "can't climb that" reads honestly, and the pathfinder already routes orders around steep ground in the common case.

**Caught while testing: exact-zero tilt assertions.** Bilinear taps at non-axis yaws carry ~1e-15 float noise, so flat-pose tests assert tight closeness (`toBeCloseTo(0, 12)`) rather than `toBe(0)`; and `-0` from `-atan2` is normalized in `clampTilt`. Same lesson as task 11: assert on real maps — the x/z transposition class of bug only shows up there, so the no-clip sweep, 60 s patrol, and leg-sampling cases all run on generated maps.

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — all pass (core 123: +12 terrain, +3 movement, +4 pathfinding; web 80: +3 movement-driver, +2 units).
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
