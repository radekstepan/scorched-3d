---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Right-click attack orders: right-clicking a live enemy unit with 1+ units selected orders the hostile selected members to hunt it down instead of moving

## Task writeup

# Right-click attack orders

Right-click used to mean exactly one thing: move the selection to the clicked ground. Now the click is resolved first — raycast, else the nearest projected hull within the pick radius, the same resolution left-click uses — and a click that lands on a live enemy of the selection issues an attack order on that unit. Everything else (empty ground, a selected unit, a friendly, an unknown side) still moves, so existing move behavior, orbit, and right-drag pan are untouched.

## What changed

- Core `retaliation.ts`: new `orderAttack(mover, attacker, x, z)` writes an `ordered` threat memory on the wide team-advance leash, clearing any move order and lifting holds. `notifyThreat` never steals an ordered drive and `seekEngage` never repoints one — the guns still answer close threats through their own traverse goals, but the drive holds its order.
- Core `movement.ts` (`pursueStep`): ordered memories are exempt from the disengage give-up (a fleeing quarry is chased) and the outnumbered hold (explicit intent charges where a volunteer would wait), and the per-tick memory rebuild carries the `ordered` flag. The carried leash and memory expiry still release the hull.
- Web `movement.ts`: new `attackUnit`/`attackGroup` (hostile live members only; wrecks, self-targets, same-team and unknown-side targets refuse) plus a sweep refresh that re-seats every live ordered memory against the live target each tick — the order stands until the target dies, a move order supersedes it, or the hull dies.
- Web `combatFx.ts`: new `orderAim(attacker, target)` traverses the gun onto the ordered enemy immediately, replacing any live aim where `trackThreat` would retain it; the scheduler's sticky scoring then holds the aim and the gun opens fire once the pursuit closes into admitted range. Range, wood, and terrain admission still gate every round.
- Web `selection.ts`: pure `resolveRightClick` (attack vs move) + `hostileMembers` helpers, covered headless.
- Web `TerrainCanvas.tsx`: the right-click-no-drag branch resolves the clicked unit and either attacks (ordered pursuit + gun aims + a rose ping on the target) or moves (existing path + cyan ping). The waypoint overlay already paints live pursuits rose, so attack orders read as rose chases with no overlay change.
- Web `movePing.ts`: `ATTACK_PING_COLOR` (pursuit rose) via an optional color parameter; default stays selection cyan.
- HUD footer: `RIGHT-CLICK move/attack`.

## Why

The skirmish runs itself, but selection + move orders already let the player intervene in movement — there was no way to point the battle at a target. Attack orders close that gap through the existing retaliation pipeline instead of a second pursuit system: the same stand-off holds, turn caps, drag, slope gating, and spacing drive the chase, so ordered attacks look and feel like the fights the AI already picks.

## Key decisions

- Attack orders ride threat memories, not move orders: a grudge with `attacker >= 0` feeds squad focus, the HQ-fire hold (`isFighting`), and the rose pursuit trail for free.
- No engage gate at issue and a map-wide leash: the player clicked the enemy, so the order is valid at any range like a move order — unlike retaliation (900) or hunts (1100), which must notice first.
- New hits never steal the drive, but the guns stay pragmatic: `orderAim` force-sets the traverse goal once, then normal scheduling applies (a closer threat inside admission can still pull the gun via sticky/distance scoring while the hull keeps closing on its ordered quarry).
- The HQ walk-out survives an attack order (unlike a move order, which repaths): a direct pursuit from inside the hall would grind through the curb wall, so the departure completes first and the pursuit steers the moment it lifts.
- Mixed selections attack through hostile members alone; clicking a selected or friendly unit falls through to a plain move at that point.
- Nanolathe sibling checked for precedent: retail routes orders through left-click with right-click as cancel (already documented as this repo's deliberate deviation in `selection.ts`), so no input behavior was borrowed — the local retaliation pipeline is the vehicle, per the standing "don't force inspiration" rule.
