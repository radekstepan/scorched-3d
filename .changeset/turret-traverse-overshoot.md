---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Turret traverse overshoot: turret swings wider than 45 degrees now run about 6 degrees past their goal and correct back before settling, the heavy-traverse overcorrect — small corrections still stop dead on the aim, and volleys only ever leave with the muzzle on target.

## Task writeup (moved from docs/tasks/127-turret-traverse-overshoot.md)

# 127 — Turret traverse overshoot on far swings

Task: the cannon/turret must point where the vehicle fires, and far turret
swings must overcorrect a little (run too far, then come back).

## What already existed

The first half was already fully implemented by earlier tasks (08 facing
turret, 54 turret recoil, 114 elevation realism, 125 proactive engagement):
hulls turn grossly while turrets slew the clamped remainder, `canFire` gates
every volley on the muzzle line, and `launchShot` re-solves from the live
barrel-tip world matrix. This task verified that and pinned it with a test
(the firing gun is aimed at its target; hull + turret meshes sit exactly on
the firing pose) rather than rebuilding it.

## What changed

Far turret swings now overshoot. New core helper `slewTurret` (`facing.ts`):
when the remaining travel exceeds `TURRET_OVERSHOOT_SWING` (45°), the gun
runs `TURRET_OVERSHOOT` (0.1 rad, ~5.7°) past its goal, releases the latch on
arrival, and steps back onto the aim. Small corrections still stop dead.

Wiring (`combatFx.ts`): per-unit aim poses thread the latch through both
slew paths — `aimStep` (headless hull-turn mode) and the turret-only branch
(external-hull patrol mode) — plus structure-fire goals. New
`aimPending`/`aimPendingHq` helpers release the latch when the goal is
re-picked; dropped goals (`slewPending` deletes, engaged-drop,
`clearTransients`) release it too. `aimState()` keeps its `{hull, turret}`
shape (a `toEqual` in `retaliation.test.ts` pins it).

## Decisions

- Latch model, not a spring damper: deterministic, one float of caller
  state, trivially pinnable in tests. Overshoot only manifests when the
  caller threads the latch — unthreaded `aimStep` converges dead-on exactly
  like before, so all pre-existing aim tests pass untouched.
- `TURRET_OVERSHOOT` (0.1) deliberately exceeds `FIRE_TOLERANCE` (0.06) so
  the settle-back is a visible correction outside the fire gate. Aim stays
  purely geometric: a volley scheduled exactly as the muzzle crosses the aim
  still (correctly) fires on target.
- The exaggerated goal stays clamped to the traverse stop: the turret never
  exceeds its limit (existing invariant test untouched). Swings onto the
  stop simply don't overshoot outward.
- No README change: small dynamics tweak, no architecture or complex
  feature.

## Tests

- Core `facing.test.ts` (+8): small swings stop dead; far swings peak at
  goal + 0.1 then settle exactly (both directions); stop never exceeded;
  mid-swing goal jumps re-latch; dt<=0 safe; tune pinned; `aimStep`
  threading converges settled-aimed.
- Web `combatFx.test.ts` (+3): far swing overshoots then settles with
  meshes on the firing line; the firing gun is aimed at its target;
  turret-only overshoot in external-hull mode with the hull unmoved.
- Full suites green: core 534, web 581; both typechecks pass.
