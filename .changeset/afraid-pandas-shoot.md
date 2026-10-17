---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Stuck forest duels unstick: guns hold fire patiently on wood-blocked lanes, then fire probing shots through the canopy instead of staying mute forever

## Task writeup

Task: "Sometimes units just get stuck close to each other, enemies. Nobody
shooting unless I move one unit. I am not sure if it's because one unit is
close to a tree and 'hard to see'."

## Diagnosis: the "hard to see" hypothesis was wrong — the guns were blind, not the eyes

A headless repro (two enemies at 60/120/200/300 units, tree absent / mid-lane /
on-target / on-shooter, fixed seed) measured spotting (`canSpot`) and firing
admission (`flightClearsTrees` + `inRange`) separately:

- Spotting: `true` at every close distance in every tree geometry — the
  `SIGHT_MIN_RANGE = 200` point-blank floor ("a neighbour breathing down your
  barrel is heard, not just seen") already guarantees close acquisition
  through any wood. No spotting change needed; an acquisition delay would have
  made things worse.
- Firing lane: `blocked` whenever a crown touched the muzzle-to-target line,
  at any range including point-blank 60. Confirmed as the deadlock.
- `MIN_RANGE = 50` vs `STOP_RADIUS = 48`: hulls resting at spacing-stop sit
  inside the min-range hold — but separation is team-agnostic and pushes
  enemies apart at 30 u/s, so that hold is transient (<0.2 s), not a deadlock.
- Alternates eliminated by code reading: the gun scheduler (`pickLivePair` /
  `hasAdmittedFoe`) is range-only and never consults leash, threat memory, or
  spotting, so no hold-fire gate or threat-expiry loop can mute it; only the
  pre-launch tree gate can.

The deadlock loop: a hull parked in a crown has no clear firing seat at any
stand-off, so every volley holds at the tree gate; every hold refreshes the
12 s reposition pursuit via `onObstructedShot` → `seekEngage`, which has
nowhere better to stand (no lateral clears a lane ending inside wood) and so
holds at stand-off forever. Both guns mute until the player moves a hull by
hand. Nanolathe checked for an acquisition-delay precedent
(`DESIGN_WORLD_VISIBILITY.md`, `MODERN_AI_RESEARCH.md`): its reaction latency
is an AI command pipeline, not a concealment rule — nothing to borrow, so the
fix follows this game's own futility-counter precedents instead.

## What changed

- Core (`packages/core/src/units/combat.ts`): new
  `FOREST_HOLD_FIRE_THROUGH_HITS = 3`, sized like the existing
  `FOREST_STICK_REPOSITION_HITS` / `HQ_DEFENSE_HITS` precedents — three
  patient holds, then hose the wood.
- Web (`apps/web/src/renderer/combatFx.ts`): `launchShot` counts consecutive
  per-attacker volleys refused by the pre-launch tree gate (`woodHolds`);
  the first two still hold and request a reposition, the third launches
  anyway. The round then pays the canopy honestly: in-flight stick rolls
  swallow most probes and struck crowns take damage and burn down, so the
  lane resolves physically. Any launched round resets the streak; kills and
  `clearTransients` drop the map with the shots. Terrain / range / mount /
  traverse holds never count — dirt is hard cover (reposition or hold), wood
  is soft cover fire destroys.
- Behaviour preserved: hold-first ordering (obstruction reports precede any
  launch), no mortar-arc substitution for peewee lobs or mount-capped
  howitzers (probes fly the flat root), ridge holds still mute indefinitely.

## Files

- `packages/core/src/units/combat.ts` — the new constant.
- `apps/web/src/renderer/combatFx.ts` — `woodHolds` streak + fire-through.
- `apps/web/src/renderer/combatFx.test.ts` — 4 wood-hold cases updated to the
  new contract (holds first, then fire through) + 1 new regression case for
  the reported geometry (crown on-target / on-shooter at 220 units).
- `apps/web/src/renderer/retaliation.test.ts` — forest-escape case updated:
  fire no longer marks the escape's end, so it tracks return-fire stickily
  and runs until the obstruction step is walked off.

## Verification

- Repro before fix: `spotted=true laneBlocked=true` at all close ranges with
  wood on the lane (spotting fine, guns muted); `inRange=false` at 48.
- After fix: `combatFx.test.ts` 126/126 pass (6 failed before the test
  updates, exactly the old infinite-hold contract); full web suite passes
  except pre-existing `deployPages.test.ts` (workflow branch main vs master,
  untouched); core 772/772; `typecheck` clean in both workspaces.
- Playwright not run (per task rules).
