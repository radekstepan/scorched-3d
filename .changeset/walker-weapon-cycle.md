---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Walkers now visibly work their guns when they fire: the peewee's hand-cannon pumps its tube back into the mount and springs forward, and the tube-less commander braces its torso back off its chest cannon and recovers — the "reloading" read at the weapon itself, on top of the shared muzzle flash and turret slide. Tanks keep exactly their old feedback.

## Task writeup (task 147)

# Task 147 — Walker weapon cycle ("reloading" animation)

Tanks read their shots clearly — long tube, big muzzle pop, turret slide —
but the two walkers fired with no visible weapon motion of their own: the
peewee's tiny scaled flash and the commander's chest-level pop gave no
"my gun just cycled" beat. Both now get a weapon-cycle animation at the
gun, reusing the existing turret-recoil clock inside the same `Nudge`
entry (no new systems, no new clocks).

## What changed

- Renderer (`apps/web/src/renderer/combatFx.ts`):
  - `BARREL_PUMP_KICK` (1.2u): on every peewee shot the barrel pivot
    slides rearward along the gun line in the turret frame and springs
    back on the turret envelope — a pump/lever read at the hand-cannon.
    The rest seat is captured once per kick and restored bit-exact.
  - `COMMANDER_BRACE_KICK` (0.07 rad): on every commander shot the torso
    pitches back off its chest cannon and recovers on the same envelope,
    tracked through `appliedNod` (subtract-before-repose, like the hull
    rock) so aim traverse composes exactly.
  - Both ride `kickRecoil`/`advanceNudges` with the turret slide, refresh
    on re-kicks (firing through a hit rock still cycles the weapon),
    restore exactly on envelope expiry, and settle on the kill transition
    (before the turret pops / torso slumps), on `clearTransients`, and on
    the white-box wreck-hold branch.
  - Gated by kind: tanks keep the slide alone — their visuals are
    bit-identical.
- Renderer (`apps/web/src/renderer/units.ts`): `setUnitAim` is now
  yaw-only on the turret (was `rotation.set(0, rel, 0)`). The old reset
  would have wiped the commander's brace mid-envelope (aim runs before
  the nudge pose every tick) and leaked pitch on expiry; it also
  future-proofs the wreck slump, which shares the pitch axis. No caller
  depended on the reset (only traverse yaw is ever asserted).

## Decisions

- Split by morphology, not one shared motion: the peewee *has* a gun tube
  so it pumps it; the commander has only a chest muzzle marker, so the
  torso itself braces. One mechanism each, both driven by the same clock.
- No new envelope or scheduler state: the cycle is pure fire feedback on
  the 0.25 s turret clock, so rapid walker refire (peewee ~0.19 s mean)
  simply re-kicks it — sustained fire reads as continuous cycling.
- Kept tanks untouched deliberately: their long-barrel slide already
  reads, and doubling their motion would have changed every duel visual
  for a walker-scoped ask.

## Tests

- `combatFx.test.ts` "CombatFx walker weapon cycle" (4 tests, white-box
  `kickRecoil` like the turret-recoil block): peewee pump pose + refresh
  + bit-exact restore, commander brace pose + aim-yaw composition
  mid-envelope + exact recovery, tank gating (tube seated, torso level,
  slide intact), kill-settle for the pump and clear-restore for the brace.
- `units.test.ts`: `setUnitAim` leaves turret pitch/roll alone.
- New tests were run before the fix (4 failures) and after (all green).
- Full suites: `yarn test` and `yarn typecheck` clean (see commit verification).
