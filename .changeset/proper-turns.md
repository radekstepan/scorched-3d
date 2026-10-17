---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Held hulls now pivot like vehicles instead of whipping: turn authority ramps from a per-kind neutral-steer floor at rest to full traverse as soon as the hull rolls, so stunned, pinned, held, and stand-off-facing hulls turn deliberately while every rolling turn carves exactly as before.

## Task writeup

The brief suspected a 45° yaw snap — an A* heading applied straight to the hull. The investigation disproved it: every hull-yaw write in the drive pipeline already evolves through the capped turn rate (`stepAngle` in `driveToward`, `tickStunned`, and the pursuit holds; the renderer only ever poses `body.rotation.y = mover.hull`), and headless probes through the real `advanceMovers` + `UnitMovement` + `CombatFx` pipeline measured worst live per-tick deltas EXACTLY equal to each kind's cap across ordered diagonals, patrol switches, pursuit flips, separation jostles, stuns, and departures (the one 75° jump found was the death turret-pop, a dead-unit artifact). What reads as "just turning 45°" is the pivot rate: a held flash spins 45° in ~0.35s at full traverse whether it is rolling or parked.

## What changed

- Core (`packages/core/src/units/facing.ts`): new `HULL_PIVOT_FLOOR` (tracked 0.35, commander 0.55, peewee 0.65 — tracked neutral-steer is slow, walkers shuffle-turn, infantry nimblest) plus `turnAuthority(kind, speed, topSpeed)`, which ramps floor→full across the `TURN_AUTHORITY_BLEND` band (0.25× top speed, deliberately under the 0.3× grip floor so every rolling recovery keeps full authority) and fails corrupt input to the floor, never zero or NaN.
- Core (`packages/core/src/units/movement.ts`): new `turnHull` helper routes all four hull-yaw sites through authority — `driveToward` (grip now reads pre-turn intent, drag probes the current nose), `tickStunned`, and the three pursuit-hold facings all pivot at the floor when held and carve at full traverse when rolling. Turn-rate caps, top speeds, grip, drag, spacing, and the traverse-cap bound itself are untouched, so the turret-faster-than-hull invariant holds trivially and driven-path prediction follows for free.
- Docs (`docs/architecture.md`): one clause on the `facing.ts` row for turn authority. README needs no change (no described behavior became false; no new feature to announce).
- Tests: `facing.test.ts` (+4 turn-authority shape pins incl. the recovery-full guarantee), `movement.test.ts` (+5: held-pivot exactness per kind, exact-full rolling traverse, per-tick cap bound across six drive regimes on real maps, grip/blend capture contract, rolling-corner pace + completion), `apps/web` `movement.test.ts` (+1 end-to-end body-yaw continuity pin through orders, pursuit, separation, and stuns).
- `.changeset/proper-turns.md` (new) — **patch** for core + web (drive-feel refinement, no value-table changes).

## Important decisions

- **Held-only discipline, rolling untouched — forced by experiment, not taste.** The first implementation coupled authority to speed across the whole range (0.35 floor, linear to full at top speed): a hammer circled its staging loop instead of settling, and the exit-road test failed (a slow hull bullied onto the road edge by its loop-mate, 17.5% occupancy). The capture inequality (`v/ω` must stay inside `ARRIVE_RADIUS`) plus the road equilibrium prove rolling turns cannot be slowed without breaking settling — so the floor applies at rest only, and rolling keeps full traverse bit-nearly-identically (all arrival, beach, and staging bounds pass unmodified).
- **No snap to remove — pin it instead.** With continuity proven rather than assumed, the per-tick cap-bound tests across six regimes are the deliverable's core: any future yaw write that bypasses the cap fails loudly.
- **Retail precedent adapted, then bounded (nanolathe).** Retail TA brakes into corners (`turnDist`/`stopDist` tests, `[R-MOV-01 §4]`) while the turn rate stays constant — but this codebase carries no persistent speed state, so full brake-into-turn dynamics are the documented follow-up, not this task. What ports memorylessly is the coupling direction's lesson: discipline the turn by the motion state. A `GRIP_FLOOR` retune was tried (0.3→0.15/0.2) and reverted: it slowed shore-slide escapes past patience and is unnecessary once authority blends under the grip floor.
- **Follow-up recommended:** true corner reshaping (brake before the waypoint switch, pivot, accelerate out) needs persistent per-mover speed with accel/brake limits — the retail model verbatim. Rolling 90° corners still carve in ~40 ticks; the corner test pins that pace so the follow-up moves it deliberately.

## Verification

- New tests observed failing before implementation (turn-authority import errors; held-pivot and corner-behavior assertions), then green after. The pivot test fails on the untouched tree (full-rate whip) and passes with the fix.
- `yarn workspace @scorched-3d/core test`: 26 files / 709 tests pass (9 new). `yarn workspace @scorched-3d/web test`: 816 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion, confirmed identical on the untouched tree via `git stash`. `yarn typecheck` (3 tasks) and `yarn build` both green. Playwright not run (per task rules).
