---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Engaged hulls now strafe: a holder with no seat improvement worth taking circles its target with short lateral orbit steps instead of planting at stand-off, so even duels read as slow circling brawls and armies never freeze into facing lines of statues.

## Task writeup

# Task — Greenreach/Dust Plains army stall: lines of statues

At some point on Greenreach each army formed a line and nobody moved; on
Dust Plains the battle started that way. Root cause: `pursueStep` holds
hulls statue-still inside weapons-range stand-off, and the only holder
motion — the firing-position sidestep — deliberately answered null for
open unshared lanes ("no improvement, no fidget", task 146). On open
ground nearly every lane is open, so two even lines faced each other and
stood forever, turrets doing all the work.

## What changed

- Core (`packages/core/src/units/combat.ts`): new pure `orbitStrafe`
  judgment — the next lateral orbit point circling the target at roughly
  stand-off distance. Direction is index-hashed per hull (each hull
  circles a consistent way, no rng), the lane never worsens (a candidate
  crossing more crowns than the seat loses to the mirror side, both-worse
  holds), and an optional `blocked` probe folds terrain into the same
  preferred-then-mirror fallback so a wall mirrors the step instead of
  pinning the hull. `firingSidestep` itself is untouched (its nulls now
  mean "no seat here", answered by the orbit).
- Renderer (`apps/web/src/renderer/movement.ts`): the hunt sweep's
  `maybeSidestep` falls back to an orbit step when the seat evaluator
  returns null, on its own faster `ORBIT_STRAFE_COOLDOWN` (2.5 s,
  staggered per hull off-phase from the 7 s seat clock so the two never
  lockstep and neither gates the other), with the drive-terrain probe
  (`stepBlocked`) wired through. Same refusals as before: ordered/holding
  hulls, wrecks, advances and HQ assaults, closing hulls — and
  outnumbered hulls still wait statue-still for backup.
- Tests: 7 new core `combat.test.ts` orbit cases (open-lane strafe +
  determinism, direction override, mirror-on-worse-wood, both-worse
  hold, crowded-seat indifference, terrain-probe mirror/hold,
  degenerates); 2 new + 2 rewritten web `retaliation.test.ts` sweep
  integrations (open 1v1 strafes at brawl distance, orbiting-duel
  bit-identical replay, 1v3 loser holds while winners orbit, stacked
  pair orbits early then flanks open past the stack gate).

## Important decisions

- **Retail TA strafes; we strafe too.** Nanolathe's executable spec
  (`Attack_Chase` phase 2, [R-ORD-01 §3]) never holds: its reachable
  cycle is close-to-range, then *repeated strafes* around the target.
  This ports the repeated-strafe arm only, deterministically (fixed
  per-hull orbit direction instead of retail's random bearings). The
  charge/re-establish arms stay out — a substate machine on the threat
  memory is a bigger change than the stall needs.
- **Task 146's restraint is narrowed, not removed.** "Open 1v1s hold
  forever" was deliberate then; it is exactly what froze open maps, so
  the orbit now answers open lanes. Everything else from that task
  survives: 48u steps, seat/flank priority on the rare clock, never step
  into worse wood, turrets track independently mid-step, outnumbered
  holders wait for backup.
- **Orbit steps reuse the sidestep pipeline.** Same `ThreatMemory.sidestep`
  field, same pursuit-drive walk, same arrival clear — no new hook, no
  canvas/combatFx change, no drive change. Emergent bonus, verified in
  probes: strafing widens range until the hull exits stand-off, then it
  closes back in — orbit out, advance back, orbit again.
- **No README change.** Behavior fix reusing the existing pursuit
  pipeline — no architecture change, no complex feature.

## Verification

Core `yarn test` 595/595 green (588 before + 7 new), web 684/685 with
the single failure pre-existing and unrelated (`deployPages.test.ts`
expects branch `main`, workflow says `master` — fails identically on
the clean base); `yarn typecheck` clean in both workspaces; `yarn build`
clean. Playwright not run (per task rules).
