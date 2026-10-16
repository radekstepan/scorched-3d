---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Group-move cohesion: orders issued together cap faster hulls at the slowest member's base speed so columns arrive together; single orders drive at full speed as before.

## Task writeup (moved from docs/tasks/92-group-cohesion.md)

# Task 92 — Group-move cohesion: columns move at the slowest member's pace

## What changed

Group orders now move as a group instead of faster hulls cutting ahead
(`packages/core/src/units/movement.ts`, `apps/web/src/renderer/movement.ts`).
Single orders are unaffected.

- Core `MoveOrder` gains an optional `groupSpeed` cap (world units/sec).
  `driveToward` drives at `min(MOVE_SPEED[kind], groupSpeed)` — the cap only
  ever slows, never speeds a slow hull past its own base. Orders without the
  key (singles, patrol, pursuit) drive at full kind speed, byte-identical to
  before (key absent, not zero, matching the `stuck`/`stun` convention).
- New `groupSpeedCap(kinds)` helper: slowest member's base `MOVE_SPEED`
  (single-kind groups are a no-op; empty rosters read as no cap).
- `orderMover(mover, points, groupSpeed?)` takes the optional cap; the order
  cursor spread (`{ ...order, at }`) and `predictDrivenPath` preserve it, so
  waypoint previews show the capped pace.
- Renderer `orderGroup` computes the cap from the live members' kinds and
  stamps every member's order; `orderUnit` without a cap stays full-speed.
  `moverState` preserves the key for tests/debugging.

## Decisions

**Cap at order time, not per-tick distance gating.** A per-tick
catch-up/slow-down rule (fast hulls brake when X ahead of the straggler)
adds coupling between `advanceMovers` members and nondeterminism risk;
stamping the slowest base speed onto each order is pure, deterministic, and
composes with spacing, separation, drag, and slope gating (all scale the
capped stride the same way). Formation-hold (leaders waiting at the goal)
was rejected: capped columns already arrive together, and waiting adds idle
states the arrival-hold path would have to special-case.

**Slowest-member pace, not average.** Average pace still splits the column
(fast ahead, slow behind); slowest-member keeps the gap bounded by path
length differences only.

## Verification

- `yarn workspace @scorched-3d/core test --run src/units/movement.test.ts` —
  60 tests pass (5 new `group cohesion` cases).
- `yarn workspace @scorched-3d/web test --run src/renderer/movement.test.ts` —
  20 tests pass (1 new cap-stamping case).
- `yarn typecheck` — 3 tasks successful.
- `yarn test` (all) — one failure in
  `apps/web/src/renderer/combatFx.test.ts > dead hulls stop firing and stop
  drawing fire`, pre-existing (same failure on clean main per task 91;
  unrelated to movement). Not fixed (out of scope).
- Playwright not run (per task rules).
