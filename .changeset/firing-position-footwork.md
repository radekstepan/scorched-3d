---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Engaged hulls holding at stand-off now shuffle for better firing positions instead of standing statue-still: a short lateral sidestep toward clearer ground or a flanking angle, taken rarely and only when it genuinely improves the seat.

## Task writeup (task 146)

# Task 146 — Firing-position footwork

Stand-off holders never moved: once a hull closed to its brawl distance it
planted itself and let the turret do all the work — even when parked in
wood with a blocked lane, even when doubled up on a mate's firing line.
Stationary guns read as weird next to a battlefield where everything else
drives.

## What changed

- Core (`packages/core/src/units/combat.ts`): `firingSidestep` — pure
  firing-seat judgment scoring the two lateral candidates one
  `SIDESTEP_OFFSET` (48u) off the firing line. Crossed crowns on the lane
  dominate the score, trees crowding the seat break near-ties, and a mate
  stacked on the same target inside `FLANK_STACK_ANGLE` (~29° at the
  target) pulls the step to the far side. Exact ties break on the roster
  indices (no rng — replays stay identical).
- Core (`packages/core/src/units/retaliation.ts`): `ThreatMemory.sidestep`
  — an optional short lateral point carried on live-duel memories.
- Core (`packages/core/src/units/movement.ts`): `pursueStep` walks a
  carried sidestep through the normal drive (turn caps, grip, slope
  gating) while holding, clears it inside `SIDESTEP_ARRIVE_RADIUS` (12u),
  and drops it while closing (stale by arrival — re-evaluated on the
  hold). No sidestep, no behavior change: the legacy hold is byte-identical.
- Renderer (`apps/web/src/renderer/movement.ts`): the hunt sweep attaches
  steps to holders on a `SIDESTEP_COOLDOWN` (7s) cadence, staggered per
  hull so the squad never shuffles as one. Refuses like the rest of the
  sweep: ordered/holding hulls, wrecks, advances and HQ assaults, closing
  hulls, outnumbered hulls waiting for backup — and the cooldown burns
  only when a step attaches, so an open 1v1 holds forever.

## Important decisions

- **Restraint is the mechanism, not a tuning pass.** Small step (48u, a
  couple of hull lengths), rare (7s cooldown), and only on strict
  improvement or a genuine flank — a flank never steps into worse wood
  (clearer consolation step, else hold). The visible effect is an
  occasional shuffle, never dancing.
- **Built on the task 143 pipeline, not beside it.** The forest-futility
  reposition fires after consecutive stuck rounds *prove* the lane
  blocked; this keeps the gun off the blocked lane (and off its mate's
  line) before the embers strand — same threat memory, same pursuit
  drive, same stand-off hold. No new hook, no canvas wiring, no combatFx
  change.
- **Turrets stay on target mid-step.** The drive turns the hull to walk
  the shuffle while combat aim keeps tracking independently, so the gun
  never leaves the target during footwork.
- **No README change.** Small behavior addition reusing the existing
  pursuit pipeline — no architecture change, no complex feature.

## Verification

`yarn test` (588 core + 665 web pass, including 15 new cases: 8
`combat.test.ts` judgment cases — open-lane hold, clearer-side pick with
deterministic index tie-break, crowded-seat step-out, flank-away,
flanked-already hold, never-flank-into-worse-wood, degenerates; 4 core
`movement.test.ts` drive cases — walks the step, legacy hold, arrival
clear, closing drop; 3 `retaliation.test.ts` sweep integrations — mate
flanks then the opened angle holds, blocked lane steps to clear ground,
open 1v1 never steps), `yarn typecheck` clean. Playwright not run (per
task rules).
