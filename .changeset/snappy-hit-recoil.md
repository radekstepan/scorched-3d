---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Hit recoil is now a short, snappy rock instead of a long lean: the impact beat drops from 1.1 s to 0.45 s, the hull tilt swings back *and* forward through the beat (one damped overshoot past the seat), and the drive-hesitation/knockback beat shortens to match (max 0.8 s → 0.45 s). The physical knockback slide is unchanged in distance — it just lands faster.

## Task writeup

# Task 144 — Shorter, faster hit recoil with a back-and-forward rock

## Problem

The hit reaction felt too long and slow: a 1.1 s linear decay that tilted the hull away from the blast and eased back along the same path — a lean, not a rock. The gameplay beat (up to 0.8 s of drive hesitation) stretched the sluggishness further.

## What changed

- `packages/core/src/units/impact.ts`
  - `IMPACT_DURATION` 1.1 → 0.45 s; stun pacing tightened to match (`STUN_MAX_DURATION` 0.8 → 0.45 s, `STUN_MIN_DURATION` 0.25 → 0.15 s, `STUN_PER_DAMAGE` 5 → 3, so a hammer point-blank hit still lands the max beat and a flash point-blank hit lands ~0.18 s). The stun cap equals the visual beat, so both end together on heavy hits.
  - New `impactTiltEnvelope(age, dur)` (exported through the package index): `(1 - t) · cos(1.5πt)` — full strength at the hit, one forward overshoot past the seat (≈ ⅓ strength, zero-crossing at t = ⅓), exactly 0 at the beat end, bounded by |e| ≤ 1. Pure, no rng/clocks, like the rest of the module.
- `apps/web/src/renderer/combatFx.ts` — `advanceNudges` splits the envelope: position keeps the linear out-and-return (a hull is shoved back and returns; it never overshoots forward past its seat), tilt reads `impactTiltEnvelope`. Pure attacker-recoil kicks carry zero tilt, so they pose unchanged. Exact-restore semantics (expiry, `clearTransients`, wreck settle) are untouched.
- Tests: new `impactTiltEnvelope` cases (opens full, swings negative then settles exactly at 0, bounded, bad clocks read settled) and a new `combatImpact` case pinning the full behavior (roll reverses sign mid-beat while X never crosses the seat, then everything restores bit-exactly). Retimed the tests that pinned the old pacing: core pacing bounds + flash-chip beat + half-beat slide halves, web idle-tremble tilt stacking (now reads the rock envelope), mid-beat tick counts in `movement`/`tracks` (30 → 13 ticks at 60 Hz, since 0.5 s now exceeds the beat).

## Decisions

**Tilt oscillates, position does not.** The ask was "tilt back and forward" plus "pushed back a bit". A positional overshoot would slide the hull forward through its seat, which reads as a glitch; a tilt overshoot reads as suspension. So only the rock swings past zero.

**Single overshoot lobe, not a multi-wobble.** `(1-t)·cos(1.5πt)` gives exactly one forward swing at ≈ ⅓ strength inside 0.45 s. More lobes would need a longer beat to read, defeating the "shorter, faster" ask.

**Gameplay knockback distance unchanged.** `impactKick` shove/tilt magnitudes and caps are untouched — the same push now drains over 0.45 s instead of 0.8 s, so it lands snappier with no rebalancing risk.

## Verification

- New regression test failed on the old code first (`expected 0 to be less than -0.007…` — the roll never reversed), then passed after the fix.
- `yarn test` — all pass (core 576, web 654).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — 2 tasks successful (also refreshes core `dist/`, which web tests resolve).
- Playwright not run (per task rules).
