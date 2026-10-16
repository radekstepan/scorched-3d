---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Guns whose rounds keep sticking in live wood now reposition out of the forest instead of firing into the canopy forever: three consecutive tree-stuck rounds report an obstructed shot and the hull closes toward its target through the pursuit drive.

## Task writeup (task 143)

# Task 143 — Leave the forest when the lane is blocked

Terrain-blocked guns already held fire and repositioned (`onObstructedShot`
→ `seekEngage`), but forest-blocked guns kept firing: flat bolts accept the
stick risk and shells fire flat into the branches when the mount refuses the
lob, so every swallowed round vanished silently and a hull parked in (or
behind) a wood fed the canopy forever with no feedback.

## What changed

- Core (`packages/core/src/units/combat.ts`): `FOREST_STICK_REPOSITION_HITS`
  (3) — consecutive tree-stuck rounds after which a gun asks for a
  reposition, sized like the `HQ_DEFENSE_HITS` consistent-fire precedent
  (one stray ember is canopy noise, three in a row is a blocked lane).
- Renderer (`apps/web/src/renderer/combatFx.ts`): per-attacker consecutive
  stick counting in `advanceShots` — a stuck round increments its gunner's
  streak, a round that reaches its impact clears it. On the third
  consecutive stick the gun fires `onObstructedShot` with its stored aimed
  impact (new `tx`/`tz` on the `Shot` record, so hull duels and HQ
  structure shots both name the position to close on) and the streak
  re-arms, so persistent futility keeps the pursuit fresh without spamming
  the hook. Mid-flight terrain kills leave the streak alone (the fire-time
  terrain gate owns terrain); kills drop the gunner's entry and
  `clearTransients` drops the map with the shots. New
  `forestStickCount(attacker)` getter (tests/HUD, `stuckCount` convention).
- No canvas/movement logic changes: the existing `onObstructedShot` →
  `movement.seekEngage` wiring already drives the hull toward its target
  (comment-only touch-ups in `TerrainCanvas.tsx` + `movement.ts` to name
  the forest trigger alongside terrain).

## Important decisions

- **Reposition toward the target, not a bespoke sidestep.** Closing always
  reduces crossed wood — out of the forest when the enemy stands outside
  it, fewer crowns when both stand inside — and the pursuit pipeline brings
  stand-off hold, leash, expiry, and the ordered/holding/wreck gates for
  free. A lateral "nearest clear ground" move would need new search logic
  and could oscillate against the gun's aim.
- **Consecutive only.** Any arrival resets the streak, so a gun landing
  half its volleys through thin wood holds its ground; only unbroken
  futility moves the hull.
- **No README change.** Small behavior addition reusing the existing
  obstructed-shot pipeline — no architecture change, no complex feature.

## Verification

`yarn test` (574 core + 653 web pass, including 2 new `combatFx.test.ts`
cases: third consecutive ember reports `{attacker 0, target 1, x 400, z 0}`
and re-arms with exactly one hook per further 3 sticks; an arrival after 2
sticks clears the streak with no report — both use a zero rng so every
crossing sticks deterministically, and both fail without the fix),
`yarn typecheck` clean. Playwright not run (per task rules).
