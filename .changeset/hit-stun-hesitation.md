---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Splashed hulls now hesitate their drive for a brief damage-scaled beat (up to 0.8 s for a direct heavy hit, down to a 0.25 s floor for fringe chips) while the existing impact rock plays the visible jerk back away from the blast. Re-hits refresh under the cap instead of parking the hull, and wrecks never stun. Renderer plus core shaping only — no API break.

## Task writeup (moved from docs/tasks/47-hit-stun-jerk.md)

# Task — Hit-stun hesitation under the impact rock

Hit hulls used to keep driving through splashes without missing a beat: the
rock (task 40) jerked the eye, but the mover never flinched, so a direct
hammer hit read as a shrug from anything watching the column. Every splash
now also hesitates the victim's drive for a damage-scaled beat — a hammer
point-blank hit holds ~0.8 s, a flash chip ~0.3 s, fringe sparks pin at a
0.25 s floor — while the existing renderer-side rock plays the visible jerk
back away from the blast. The hull resumes exactly where it held; re-hits
refresh under the cap instead of parking it, and wrecks never stun.

## What changed

- Core `units/impact.ts`: pure stun shaping, no rng, no clocks.
  - `stunDuration(damageAdd)` sizes one hit's hesitation: 0 for
    non-positive damage, otherwise linear (`STUN_PER_DAMAGE = 5`) under the
    `[STUN_MIN_DURATION, STUN_MAX_DURATION] = [0.25, 0.8]` s band.
  - `accumulateStun(current, damageAdd)` refreshes the countdown with the
    longer beat, capped at the max; `tickStun(stun, dt)` counts down,
    floored at 0, leaving non-positive steps alone.
- Core `units/movement.ts`: the mover owns the countdown.
  - `Mover.stun?: number` — seconds of hesitation remaining, absent (not
    zero) when unstunned, matching the `stuck` convention so unstunned
    snapshots compare equal with never-stunned ones.
  - `stunMover(mover, damageAdd)` refreshes the clock (pure; misses return
    the move untouched). `advanceMover` short-circuits stunned hulls through
    `tickStunned`: the hull still turns toward its frozen target at the
    kind's turn rate and the clock ticks down, but X/Z hold, the order
    cursor never advances, and no blocked time accrues. Separation still
    applies afterward in `advanceMovers` (the crowd can jostle a stunned
    hull — it just cannot drive itself), and driven-path prediction inherits
    the hold for free since it simulates `advanceMover`.
- Renderer `combatFx.ts`: new `onUnitStunned(index, damageAdd)` hook, fired
  per surviving hull per splash after the kill transition — killing blows
  skip it (the wreck holds instead) and wrecks never re-fire it. The visual
  jerk is unchanged (same nudge map, same caps, same envelope).
- Renderer `movement.ts`: new `stunUnit(index, damageAdd)` (refuses wrecks
  and misses via core `stunMover`); `markDestroyed` now also drops a live
  stun so frozen wreck movers stay key-clean.
- `TerrainCanvas.tsx`: wires `combat.onUnitStunned` to `movement.stunUnit`;
  `README.md`: one-phrase splice in the damage clause.
- Tests: core `impact.test.ts` (8 new stun cases — miss silence, mid-band
  linearity, floor/cap pins, band bounds, determinism, refresh-under-cap,
  tick flooring); core `movement.test.ts` (6 new — miss no-op, damage
  sizing, hold-while-turning then exact resume with key drop, frozen order
  cursor, no-op dt, separation-through-stun); web `combatImpact.test.ts`
  (stun hook fires with dealt damage on survivors, silent on kills and
  post-death barrages); web `movement.test.ts` (`stunUnit` holds one tick,
  misses no-op, wrecks refuse).
- `.changeset/hit-stun-hesitation.md` (new) — **patch** for core + web
  (visible battle feel; no API break).

## Important decisions

- **Drive-only stun; firing untouched.** The task suggested a weapons pause
  "if trivial" — it is not: aim/fire live in the ambient scheduler per
  attacker/target pair with traverse state, so a per-victim fire pause would
  fight the scheduler without reading any clearer than the drive beat plus
  the rock. A hull that stops mid-patrol while jerking away from the blast
  already reads as stunned.
- **No gameplay displacement (movers still never move).** A positional
  knockback would fight separation, spacing stops, and slope gating — the
  exact systems tasks 11/13/18/22 stabilized. The "jerks back away from the
  direction of the hit" is the existing impact shove (up to 7 u, side-biased,
  decaying over 1.1 s); this task adds the gameplay beat under it. Stunned
  hulls still turn (retail's blocked movers keep turning) and still separate,
  so the pause composes instead of deadlocking.
- **One hook, not a shared clock.** Combat owns damage, movement owns
  movers; the `onUnitStunned` callback bridges them next to the existing
  `onUnitKilled` precedent instead of threading movers through combat.
- **Caught while testing: float residue on the countdown.** A 0.5 s stun
  ticked at 0.05 s leaves ~7e-17 > 0 after 10 ticks, so the key-drop test
  ticks to expiry instead of asserting an exact tick count.

## Verification

- `yarn test` — all pass (core 315 incl. 14 new stun cases: 8 impact
  shaping + 6 mover hesitation; web 250 incl. 2 new stun cases).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
