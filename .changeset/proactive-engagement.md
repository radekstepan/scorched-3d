---
"@scorched-3d/web": patch
---

Proactive engagement: live guns now traverse onto enemies inside admitted weapon range before taking fire (turrets visibly react instead of sitting on stale aims), and the ambient scheduler draws volleys from engaged guns first so duels answer promptly. Proactive aims ride the shared traverse, never fire by themselves, and never steal scheduler-drawn goals; out-of-range behavior is unchanged.

## Task writeup (moved from docs/tasks/125-proactive-engagement.md)

# 125 — Proactive engagement: guns react to enemies in range

Task: "The units do not react to enemies unless fired upon, it's weird."

## Problem

Two columns could sit facing each other with almost no visible reaction:
only the single ambient scheduler volley (one random gun every ~0.35–1.1s)
moved a turret, plus `trackThreat` for hulls actively being hit. Every other
turret sat on a stale aim, so units read as indifferent until shells landed
on them.

## Change (`apps/web/src/renderer/combatFx.ts`)

- **Proactive traverse (`trackVisibleEnemies`, run each tick before
  `slewPending`):** every live gun without a traverse goal turns onto a live
  enemy inside admitted weapon range (`maxRangeFor(kind) + 50`, the same
  admission the scheduler and the HQ pre-gate use). Target choice reuses
  core `pickStrategicTarget` (wounded/focus pulls, distance first), so
  proactive aims feed squad focus fire like any traverse; legacy unteamed
  headless groups track the nearest other live hull in range.
- **Engaged-first scheduling (`pickLivePair`):** the ambient attacker now
  draws uniformly from live hulls that have an admitted enemy
  (`hasAdmittedFoe`) instead of from the whole roster, so reaction turns
  into return fire promptly instead of far guns wasting volleys. With
  nothing in range anywhere the draw falls back to all live hulls (one rng
  draw either way — replay determinism preserved).
- Shared helpers extracted: `rosterSnapshot()` (positions/teams/live flags,
  wrecks invisible) and `admissionFor(kind)`; the HQ pre-gate now uses the
  latter too (same value, no behavior change).

## Decisions

- **Traverse only, never fire:** the proactive pass only sets pending aims;
  `launchShot` range/terrain admission still gates every round. Guns that
  already carry an aim (scheduler-drawn or threat-tracked) are left alone,
  so the pass can never fight the scheduler's traverse-then-fire pairs.
- **Range-only notice, no line-of-sight:** a gun reacts to anything inside
  admission even behind a ridge (the shot itself still holds for terrain
  and seeks a reposition). Occlusion-aware spotting stays the job of the
  upcoming visibility task ("cannot see through mountains").
- **Strategy layer untouched:** `shouldHold` odds-gating still governs
  hull *movement* (waiting for backup when outnumbered); this task only
  makes guns *look and shoot back*. A holding hull now holds facing the
  enemy with its turret tracking — deliberate.
- **Legacy scheduler branch untouched:** unteamed headless groups keep the
  old uniform attacker draw (test-only path); only their traverse reacts.

## Tests (`combatFx.test.ts`, +6, all passing)

- Aims set on the first tick before any shot can fire; turrets measurably
  traverse onto off-boresight enemies while `totalFired` stays 0.
- No reaction past admission (pending empty, `hasAdmittedFoe` false).
- Legacy groups track nearest-in-range; existing aims never stolen.
- Engaged-first: over 10s of duelling the out-of-range gun never draws a
  volley (no pending aim) while the duel fires.

Full web suite: 36 files / 578 tests pass; `typecheck` clean.
