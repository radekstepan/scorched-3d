---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Units keep firing while driving, but at half pace: a volley fired on the move reloads 2× slower than the same volley fired at rest, while stationary fire is bit-identical.

## Task writeup

Driving guns already fired on the move (external-hull mode slews the turret onto the target while the hull keeps its travel heading), but the ambient scheduler reloaded every volley at the same beat whether the gunner was dug in or mid-march — a headless baseline showed a circling flash duel firing 21–27 volleys vs 26–28 stationary, the gap coming only from traverse-miss fast retries. The ask was an explicit "not as fast" penalty for fire on the move.

## What changed

- Core (`packages/core/src/units/combat.ts`): new `MOVING_REFIRE_MULTIPLIER = 2`, and `nextShotDelayFor(kind, rng, moving = false)` scales the drawn delay post-draw when the gunner displaced. Post-draw scaling keeps the rng stream aligned either way (one draw, then an exact power-of-two multiply), so the stationary beat is bit-identical with or without the flag.
- Core (`packages/core/src/units/movement.ts`): new pure `isMoverMoving(mover, displaced)` predicate. Holds read stationary even when separation jostles the hull, and stun beats read stationary even mid-recoil-slide (both are involuntary displacement, never driving; an expired `stun: 0` counts as no stun). Everything else keys off caller-measured displacement alone, so orders, patrol legs, pursuits, departures, footwork steps, and separation coasts all read the same way; spacing-held and slope-pinned hulls read stationary with no special case because the drive clamp leaves them undisplaced.
- Renderer (`apps/web/src/renderer/movement.ts`): `UnitMovement` records per-hull X/Z displacement each drive tick (`movedLastTick`, fed by the same dx/dz that already drives locomotion and recoil-anchor shifts) and exposes `isMoving(index)` over the core predicate; unknown indices read stationary.
- Renderer (`apps/web/src/renderer/combatFx.ts`): `CombatEnv` gains an optional `isMoving` hook (absent reads as nobody moving — legacy behavior), the launch path records `lastAttacker` next to `lastKind`, and the scheduler reload passes the gunner's moving state into `nextShotDelayFor`. The penalty follows the volley that just left, not the whole schedule.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): wires `isMoving: (index) => movement.isMoving(index)` into the combat env, the same live-closure pattern as `isEngaged`.
- Tests: `combat.test.ts` (+2: exact 2× post-draw scaling for every kind, stationary beat + rng stream untouched), core `movement.test.ts` (+5: displacement/hold/stun/expired-stun/drive-mode predicate legs), web `movement.test.ts` (+5: patrol-driving, ordered, mid-recoil-slide stun, wreck, slope-pinned cliff), `combatFx.test.ts` (+3: twin-skirmish half-pace ratios — fired 0.48–0.54, ticks-to-12 1.91–1.95 across seeds — per-volley penalty attribution, stationary bit-identical with/without the hook).
- `.changeset/fire-while-moving.md` (new) — **patch** for core + web (behavior retune, no API break).

## Important decisions

- **Rate penalty only — no accuracy/scatter change, no steering change.** Target selection, pursuit, stand-off, and the ~0.15 s traverse-retry path are untouched; a moving gun that cannot bear still retries fast, and only the post-volley reload stretches.
- **One consistent rule for every round.** The penalty lives at the shared scheduler reload keyed to the firing gunner, so bolts, shells, peewee grenade lobs, and HQ structure shots all slow down the same way when their gunner displaces — no per-weapon branches.
- **Footwork/strafe steps count as moving.** Sidestep and orbit steps displace through the pursuit drive under the hull's own duel intent, so strafing brawlers pay the penalty like any driving gun — the simplest rule that matches what the eye sees.
- **Stunned hulls fire at the stationary rate.** Recoil slides are involuntary, so a mid-slide gunner reads stationary and reloads normally; the penalty only ever slows genuine driving.
- **Nanolathe (checked, not ported).** R-STANCE-01 §6 confirms stock retail mobiles are maneuver + fire-at-will and retail reloads run per weapon slot with no move/fire-rate coupling — which matches this repo's pre-existing external-hull fire-on-the-move design. The 2× penalty itself is original game feel for readability of "not as fast", sized as an exact power of two so the ratio pins exactly in tests.
