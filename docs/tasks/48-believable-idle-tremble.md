# Task — Believable idle: tilt-only engine breathing replaces the positional shake

Held hulls used to slide on their tracks at rest: the idle tremble (task 41)
shaped ±0.35 u of positional jitter per axis at ~2 Hz, and in motion that
read as a distracting shake — a parked tank visibly dancing rather than a
machine running. Live hulls at rest now breathe instead: no positional
component at all (the body sits bit-exact on its mover), just a slow
~0.5–0.8 Hz tilt sway capped at 0.0015 rad (~0.09°) against the grade seat.
Felt on a watched hull, invisible across the battlefield.

## What changed

- Renderer `units.ts` (still no core change — pure presentation):
  - `IDLE_POS = 0` (was 0.35): the positional slide is gone, not shrunk —
    any nonzero slide at engine frequencies reads as driving-in-place, and
    a real idling hull never translates. Kept as a zero export so existing
    bounds imports keep compiling while asserting exact seating.
  - `IDLE_TILT = 0.0015` (was 0.005): ~0.09° sway, an order below the old
    judder and two orders below the 0.16 rad hit-reaction clamp.
  - `idleTremble` shapes x/z as constant 0; pitch/roll are averaged sine
    pairs slowed to 5.1/3.3 and 4.6/3.9 rad/s (was 9–14) — smooth
    breathing instead of judder, still deterministic and phased per unit
    via the golden-angle step, same shared-scratch return.
  - `applyIdleTremble` touches rotation only (position never written);
    `clearIdleTremble` unchanged.
- Renderer `movement.ts`: comment-only updates (breathe/sway wording);
  ownership, rest gating (`dx === 0 && dz === 0`, so stunned hulls still
  breathe while held), wreck stillness, and exact re-seat are untouched.
- Tests: `idleTremble.test.ts` (7 cases re-aimed — zero-position exactness,
  phasing asserted on pitch, tilt-only tremble/stillness checks, stacking
  test asserts rock-only X displacement); `movement.test.ts` arrival-hold
  now asserts exact X/Z seating. No combat test needed changes.
- `README.md`: patrol clause reworded (trembling → breathing).
- `.changeset/idle-engine-breathing.md` (new) — **patch** for web.

## Important decisions

- **Removed position, shrank tilt — not the reverse.** The distraction was
  almost entirely translational: ±0.35 u at ~2 Hz is a visible positional
  dance on a ~26 u hull, while 0.005 rad of tilt alone is barely
  perceptible. Keeping a smaller slide would have kept the distracting
  mode alive; tilt-only breathing keeps the "running" read with no dance.
- **Slowed the frequencies, not just the amplitude.** A small fast jitter
  still reads as vibration/shake; a slow sway reads as mass breathing at
  idle. The averaged-pair shape is kept (deterministic, phased, smooth
  beating with no sharp edges).
- **No per-kind variation.** At 0.0015 rad any kind-scaled difference
  (heavy tanks breathe less, lights more) would be imperceptible while
  adding a kind parameter to the shaper and every call site — phase
  variation already keeps neighbouring hulls from syncing. Documented
  and skipped deliberately.
- **No exhaust shimmer / extra effects.** Nanolathe (checked for
  precedent) has no idle-animation pattern to borrow, and a new particle
  or heat-haze system would be a far bigger change for a subtler read
  than the tilt sway already gives. If idle ever needs more presence,
  exhaust smoke cadence is the lever — not hull motion.
- **Stunned hulls still breathe.** The rest gate is zero travel, and a
  stunned hold is an engine idling in place — consistent with spacing
  holds, and the 0.0015 rad sway never fights the 0.16 rad impact rock
  riding on top of it (stacking re-asserted bit-exact).
- **Wrecks, driving hulls, re-seats unchanged.** Still exact stillness /
  exact seat / exact re-seat with the sway shed first.

## Verification

- `yarn test` — all pass (web 250 incl. 7 re-aimed idle cases; core
  untouched, suite green).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
