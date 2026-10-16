---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

HQ assaults yield to consistent attackers: hulls engaging an enemy fort now count consecutive hits from one gun and retarget onto it after three in a row — dealing with the enemy first — while stray splashes no longer pull the push off its target. Engaged guns also hold HQ structure fire until the fight clears, then resume the fort. Assault pushes survive the hunt sweep instead of being clobbered by team advances.

## Task writeup (moved from docs/tasks/95-hq-defense.md)

# Task 95 — HQ assaults yield to consistent attackers (self-defense first)

## What changed and why

A hull shelling the enemy HQ kept shelling it while being shelled itself:
the fort push (an obstructed-shot `-1` seek or an HQ gun aim) had no notion
of self-defense, so a push under honest fire never turned to answer it.
Now a group/unit attacking the HQ deals with a consistent enemy first and
resumes the fort after — on both layers that engage the HQ (the drive and
the guns).

- `packages/core/src/units/retaliation.ts`
  - `ThreatMemory` gains `structure?: boolean` (this `-1` position memory
    is an HQ assault, not a team-advance waypoint) and `challenger?:
    { attacker, hits, x, z }` (consecutive-hit record from one live enemy).
  - New `HQ_DEFENSE_HITS = 3`: consecutive hits from the same gun before an
    assault retargets. One stray splash is chip damage, not a reason to turn;
    three in a row means the push is under honest fire. Distant chips (past
    the engage gate or the anchor leash) record nothing, and a different gun
    restarts the count at 1. The record dies with the memory, so stale chips
    never preempt later assaults.
  - New `seekStructure(...)`: HQ-assault memory (`attacker -1, structure:
    true`), leash-gated, orders/hold refuse as usual. It never overwrites a
    live grudge against a roster enemy — a hull already fighting someone
    finishes that fight instead of turning for the fort mid-brawl — but it
    takes over team-advance waypoints (keeping the carried leash).
  - `notifyThreat`: hits taken while assaulting count toward `challenger`
    instead of stealing immediately; at the threshold the hull retargets
    onto the challenger through a normal retaliation memory (squad-focusable,
    guns pile on). Plain `-1` waypoints still steal on the first close hit,
    exactly as before.
- `packages/core/src/units/movement.ts` — `pursueStep` carries `structure`
  + `challenger` across drive ticks (refreshing the challenger position
  from the live roster), so consistent fire preempts mid-push, not just on
  arrival. No other drive behavior changes.
- `apps/web/src/renderer/movement.ts`
  - `seekEngage` routes structure targets (`target -1`, i.e. obstructed fort
    shots) through `seekStructure`.
  - `sweepHunt` restores an HQ assault untouched when no hunt acquires — the
    sweep no longer clobbers a fort push with a team advance — while live
    enemies in notice still upgrade the assault to a hunt the same tick.
  - New `isFighting(index)`: true only for a live grudge against a roster
    hull (`attacker >= 0`). Assaulting a fort reads false.
- `apps/web/src/renderer/combatFx.ts` — new `CombatEnv.isEngaged` hook:
  `pickHqShot` never draws structure fire for engaged guns, and `tryFire`
  drops their stale `pendingHq` traverse goals so turrets rejoin the hull
  duel. Without the hook everything replays byte-identically (no rng
  consumed differently).
- `apps/web/src/renderer/TerrainCanvas.tsx` — wires `isEngaged` to
  `movement.isFighting`. Once the grudge clears (kill/expiry/disengage),
  the scheduler re-picks the admitted fort and the push resumes.
- `docs/architecture.md` — retaliation + movement rows describe the assault
  / challenger / gun-gate behavior.
- `README.md` — one clause: fort-shelling guns under consistent enemy fire
  answer the enemy first.
- `.changeset/hq-defense-self-defense.md` (patch, core + web).

## Files

- `packages/core/src/units/retaliation.ts` — `ThreatChallenger`,
  `HQ_DEFENSE_HITS`, `seekStructure`, `notifyThreat` assault branch +
  `noteAssaultHit`.
- `packages/core/src/units/movement.ts` — `pursueStep` preserves + refreshes
  assault fields.
- `packages/core/src/units/retaliation.test.ts` — `seekStructure` (6) + HQ
  defense (6) suites.
- `apps/web/src/renderer/movement.ts` — structure routing, sweep restore,
  `isFighting`.
- `apps/web/src/renderer/combatFx.ts` — `isEngaged` hook, HQ-shot filter,
  stale-aim cleanup.
- `apps/web/src/renderer/TerrainCanvas.tsx` — hook wiring.
- `apps/web/src/renderer/retaliation.test.ts` — "UnitMovement HQ assault"
  (5 tests).
- `apps/web/src/renderer/combatFx.test.ts` — engaged gun holds HQ fire +
  stale fort aim dropped (2 tests).
- `docs/architecture.md`, `README.md` — doc touches.
- `.changeset/hq-defense-self-defense.md` (patch), `docs/tasks/95-*.md`
  (this writeup).

## README

Updated — one clause on fort-shelling guns answering consistent fire first;
architecture table rows updated for the new AI state.

## Test evidence

- Core: 486/486 pass (`packages/core`), incl. 12 new assault/defense tests.
- Web targeted: `retaliation.test.ts` 33/33, structure-fire `combatFx`
  subset 5/5 pass.
- `yarn test` (root) — core green; web 430/431. The single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire",
  `shotCount` 1 vs 0) is pre-existing: verified failing on unmodified main
  via `git stash` + clean core rebuild, and already recorded as
  pre-existing in task 94. Untouched by this change (no `isEngaged` hook in
  that fixture, no assault memories anywhere near it).
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).
