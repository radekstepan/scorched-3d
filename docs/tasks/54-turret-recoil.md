# Task 54 — Turret recoil (the gun slams back when it fires)

The turret itself now recoils when shooting: on every shot the whole
turret subgroup slides a short distance rearward along the live barrel
line, then glides back to its seat — while the hull takes its existing
straight-back kick underneath.

## Decision: turret slide inside the unified nudge map, not a second system

Task 40 merged hull recoil + impact rock into one per-unit nudge map
(single seated base, exact restore). A separate turret-recoil map would
reintroduce exactly the cross-restore residue that merge eliminated, so
the slide lives in the same entry on its own shorter clock:

- `TURRET_RECOIL_KICK = 1.5` world units at full envelope (~1/3 of the
  5 u hull kick — felt on the gun, not the hull) with
  `TURRET_RECOIL_DURATION = 0.25` s: full strength on the firing tick
  (fast out), linear decay home (smooth return), always re-seated before
  the 0.28 s hull kick restores.
- Direction is re-read from the live turret yaw every tick
  (`-(sin yaw, cos yaw)` in the hull frame), so traverse during the kick
  tracks the gun instead of freezing the firing line. Aim yaw itself is
  never touched (rotation), the slide lives on position, idle breathing
  lives on the hull — the three compose with no fighting.
- Firing through a hit reaction re-kicks only the turret (the rock keeps
  its envelope and duration); re-firing mid-slide refreshes the slide to
  full instead of stacking past the cap.
- Restores touch only X/Z (Y is the commander wreck-slump axis), so the
  walker slump survives. Wrecks never kick: `kickRecoil` refuses destroyed
  units, the kill transition settles any mid-recoil slide first, and the
  per-tick advance settles white-box kills the same way.

## What changed

- `apps/web/src/renderer/combatFx.ts`: `Nudge` gains
  `turret`/`turretAge`/`turretDur`; `kickRecoil` stacks the turret kick
  onto standing rock entries instead of bailing when an entry exists;
  `advanceNudges` poses both envelopes and drops the entry only once both
  have restored; `settleNudge`/`clearTransients`/the wreck branch reset the
  turret slide (X/Z only). No core change, no new pools or allocations.
- Occlusion needed no code: the ghost already syncs live turret transforms
  every tick, so the silhouette follows the slide (and the restore) for
  free — covered by a test rather than new logic.

## Tests

- `combatFx.test.ts` → "CombatFx turret recoil" (5 tests): organic fire
  kicks exactly one turret rearward along the live barrel line at
  `KICK·(1−dt/dur)` with yaw untouched; solo white-box slide returns to
  bit-exact zero; slide stacks with a flank impact rock and both restore
  exactly; a mid-recoil kill settles the slide and wrecks never re-kick;
  `clearTransients` restores the slide.
- `occlusionFx.test.ts`: ghost turret mirrors a recoil-style offset and
  follows it back to the seat.

## Verification

`yarn test` (289 passed, 23 files), `yarn typecheck`, `yarn build` —
all green.
