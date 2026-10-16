---
"@scorched-3d/core": patch
---

Ordered units are no longer shoved backwards by crowd separation: the resolve now strips the radial half of a push that points back away from an ordered hull's goal (keeping the sidestep circulation), so single-file columns and head-on crossings arrive measurably faster while arrival and no-deadlock guarantees still hold.

## Task writeup (moved from docs/tasks/72-crowd-separation-speed.md)

# Task 72 — Crowd separation: move away to move faster, never stuck

## Investigation: should units move away from each other?

The slowdown has two bands (`packages/core/src/units/movement.ts`):
`spacingScale` returns 0 inside `STOP_RADIUS` (30, mutual deadlock broken by
the task-13 separation shove) and `SLOW_SCALE` 0.35 inside `SLOW_RADIUS`
(72). The question was whether extending the shove into the slow band would
restore full speed. I built it (constant inner weight + linear falloff to
72) and measured deterministic arrival times on open ground before/after:

| scenario | before | with outer band |
|---|---|---|
| parallel lanes 20 apart, 400 u trip | 1205 ticks | 1298 ticks (slower) |
| parallel lanes 50 apart, 400 u trip | 1141 ticks | 1205 ticks (slower) |

The outer band is actively harmful for cruisers: the lateral position-shove
fights the homing drive into a wide S-weave (lanes swinging ±26 instead of
±14), and turn-rate grip converts the weave into lost speed. The pair can
never escape anyway - the drive's homing pulls back inward as far as the
push shoves outward, so they settle crabbing just inside the band edge.
Conclusion: a slow-zone neighbour is a convoy, not a collision. The 0.35
crawl stands; separation stays inside the stop radius. The outer band was
reverted, including a post-arrival dispersal bug it caused (arrived holders
drifted off their goals out to gap 72, which would also have broken the
40-apart formation fan).

Where pushing apart genuinely helps is files and crossings: the old full
push shoved an ordered trailer *backwards* at 22 u/s against its ~17 u/s
floor drive, and backed both halves of a head-on crossing away from their
goals. Stripping just the goal-opposed radial half fixes that.

## What changed

- `packages/core/src/units/movement.ts`
  - `separationComponents()` (new, internal): splits the existing push into
    radial (pair-axis) and sidestep (circulation) halves plus a
    `coincident` flag. `separationVector()` is byte-identical (sums both
    halves) - public API and all existing push-math tests untouched.
  - `resolveSeparation()` strips only the radial component opposing an
    ordered hull's live cursor target (`orderGoalDir()`); the sidestep is
    always kept (it staggers pairs instead of mirroring), forward-aiding
    radial is kept, and coincident splits are exempt (no pair axis means
    "away from the goal" is meaningless). Patrol/holders/pursuers/stunned
    take the full push exactly as before. Terrain gating with axis-slide
    fallback is unchanged, so pushes still never enter water/steep ground.
- Measured arrivals on open ground, before -> after (ticks @ 60 Hz):
  single-file pair 1204 -> 1123, head-on crossing 559 -> 521, coincident
  pair 1277 -> 1199. Trailer z at tick 60: 14.9 -> 20.6 (+38%); lane offset
  3.5 -> 7.5 (spacing recovers sooner). Nothing gets stuck: every scenario
  arrives, and all pre-existing deadlock/arrival tests pass unmodified.
- Tests: 4 new `crowd separation` cases (single-tick no-backward-shove
  with drive held by stun, single-file progress + arrival bound,
  head-on crossing arrival bound, coincident arrival bound) + 1 wall-slide
  case pinning terrain gating (hulls stay walkable, never enter the wall,
  pair still opens).
- `docs/architecture.md` - movement row notes goal-aware separation.
- `.changeset/crowd-separation-speed.md` (new) - **patch** for core.

## Decisions

**Strip radial only, keep the sidestep always.** The first version stripped
the whole goal-opposed push and arrived *slower* on side-by-side lanes: the
removed backward sidestep was what staggered pairs out of lockstep. Radial
is the part that costs ground; circulation is the part that breaks
symmetry. Keeping them separate preserves both.

**No outer band, even though the task suggested moving away.** Measured
data beat the intuition (see table). The honest fix is narrower: never lose
ground to the crowd, crawl correctly in convoys, never deadlock.

**Coincident splits exempt from stripping.** The golden-angle heading is
arbitrary, so projecting it against the goal would keep half the split and
slow the opening for no reason. Drive floor + full split opens the pair;
measured coincident arrivals still improved.

**Timing bounds in tests are faster-than-baseline, with margin.**
Deterministic sim, so tick counts are exact (file <1180 vs old 1204, cross
<545 vs old 559, coincident <1250 vs old 1277). If movement ever shifts
these, the bounds must be recalibrated deliberately, not silently passed.

## Verification

- `yarn typecheck` - 3 tasks successful.
- `yarn test` - all pass (core 411, web suite green).
- Playwright not run (per task rules).
