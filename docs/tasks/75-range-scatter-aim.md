# Distance-scaled aim dispersion

Shots no longer land on a fixed ±11 box around the target regardless of
range. Aim now scatters around the mark with a radius proportional to firing
distance — artillery worst of all — while staying bounded so rounds never
stray "too far off target".

## Decisions

- **Dispersion lives in core (`units/combat.ts`), not the renderer.**
  `scatterRadius(kind, distance)` is pure math and `disperseAim(point, kind,
  distance, rng)` rolls a uniform-disc offset (even density via `r = R·√rng`)
  with the caller's seeded rng — the same deterministic-friendly pattern as
  `rollTreeStick` (no entropy inside the deadzone, two draws otherwise), so
  replay streams stay stable. The renderer's `impactPoint` just threads
  muzzle-to-target distance through it and keeps its existing height lift.
- **Deadzone of 150 world units.** Hulls park ≥160 apart, so the opening
  exchange is still dead-on gunnery; scatter only opens up once guns are
  genuinely reaching. Zero/low distance returns the aim point untouched.
- **Artillery spreads ~3x faster than bolts.** Rates: hammer 0.06 vs
  0.02–0.025 for flash/stump/commander. At max range (~900–1000) that reads
  as ~51 units of shell stray vs ~15 for bolts — visible bracketing without
  comedy misses.
- **Caps sit at or under blast radius (24–60).** Hammer caps at 60 vs its 64
  blast radius, bolts at 24–28 vs 36–48: even a worst-case max-range stray
  still splashes its mark, so long-range fire degrades into chipping rather
  than whiffing. Scatter is XZ-only; height stays the caller's seat.
- **Targeting rules untouched.** Pairs still come from cross-team
  `pickHostilePair` only — friendlies never draw fire; only the impact point
  moves. The range admission gate still runs on the scattered impact, so a
  max-range round that scatters outward may hold fire that volley and retry
  (same as any out-of-range pair).
- **No README change.** Player-facing behavior, no architecture or config
  change; the changeset is `minor` (gameplay behavior addition, no API
  break).

## Verification

- `yarn typecheck`: 3 tasks green.
- `yarn test`: full suite green (core 420, incl. 5 new `aim dispersion`
  tests covering deadzone/no-scatter, growth with distance, hammer > every
  other kind at 200–1200 units, hard caps + untouched height + determinism;
  web `combatFx.test.ts` 63 green with the rewritten `impactPoint` block:
  dead-on at 50 units, bounded hammer stray ≤60 at 900 with visible spread,
  flash stray ≤24 and smaller than the shell's).
