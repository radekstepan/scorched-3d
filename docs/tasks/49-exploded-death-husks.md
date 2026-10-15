# Task — Exploded death husks (turret pop, breached hulls, deep char)

Killed hulls used to die as intact twins of themselves: the epic burst fired,
then the full model — turret, barrel, paint barely darker than a battered
live hull — sat and sank for a minute. Death now breaks the silhouette. A
tank kill pops its actual turret subgroup off the hull on a ballistic arc
(it tumbles, lands, and rests nearby as charred litter until the husk is
gone), leaves a breached turret-ring collar on the headless hull, and settles
the hull boxes with a deterministic slump; the commander keeps its torso but
slumped forward, dropped, and yawed askew with splayed legs. Every wreck
chars past the readable live cap toward near-black, then smoulders, sinks,
and vanishes on the existing husk clock.

## What changed

- `unitDamageFx.ts`: `WRECK_CHAR_TARGET` (`0x14100b`) + `WRECK_CHAR_MIX`
  (0.9) with pure `wreckCharredColor(base)` (fully-charred live color pushed
  90% to near-black — every kind lands under 0.03 luminance, vs 0.06+ live)
  and idempotent `applyWreckChar(body)` (base-derived, so post-death
  barrages that re-tint through the capped live char get the deep husk char
  re-applied on top; `noHighlight` dressing/markers skipped).
- `combatFx.ts`:
  - Pure `wreckPopVelocity(index)` (golden-angle bearing + index-stepped
    throw, up ~150–185 u/s, out ~95–145 u/s) integrated analytically under
    core `GRAVITY` through `ballisticPosition` — frame-rate independent and
    replay-deterministic, no rng consumed.
  - `poseWreck(index, body)` (once per wreck, children-only): tanks detach
    the real turret group into scene-level `TurretDebris` (charred
    pre-detach, barrel and all), add a shared-geometry breach collar at the
    per-kind ring seat, and slump unnamed hull boxes; the commander pitches/
    drops/skews its torso and splays legs via `rotation.z` only (locomotion
    owns `rotation.x`/`position.y` even for wrecks). Fires on the kill
    transition after the nudge settles (burst and husk share the seat), and
    lazily from `poseHusks` for white-box kills that bypass the splash.
  - `advanceDebris(dt)`: tumbling flight, landing on the live surface
    (`env.groundY`, headless fallback off the death seat), frozen tilted
    rest; litter hides with its husk at full decay and never sinks.
  - Persistent like scorch: `clearTransients` never touches dressing or
    debris; `dispose` strips collars and drops debris from the scene (shared
    collar geo/mat dispose; body geometries stay canvas-owned).
  - Getters `isWreckPosedAt` / `debrisCount` / `debrisAt` for tests/HUD.
- `README.md`: wreck phrase updated. No architecture change (renderer-side
  only, same roster/slot rules).

## Per-kind wreck silhouettes

| Kind | Turret | Hull | Extra |
| ---- | ------ | ---- | ----- |
| Flash / Stump / Hammer | pops off ballistically, lands as litter | breach collar + slumped boxes | deep char |
| Commander | stays, pitched +0.5, dropped −4, yawed +0.6 | legs splay ±(0.22–0.34) | deep char |

## Important decisions

- **Detach the real turret, don't spawn a fake.** The flying chunk is the
  actual subgroup (no new geometries/materials, char included), so there is
  nothing to keep in sync and nothing extra to dispose. Picking is safe (the
  canvas raycasts `units.children` only); the occlusion ghost rebuilds off
  the changed hierarchy, so a headless husk ghosts headless while smouldering
  and hides once gone — the task 44/45 policy holds with no occlusion change.
- **Children-only surgery.** Movement re-poses body origin/yaw/grade tilt
  every tick and `poseHusks` offsets Y absolutely, so the wreck transform lives
  entirely in child transforms the seat never touches. Wrecks still never
  rock/stun/tremble/drive; selection, health bars, and waypoints already
  exclude destroyed indices, so no changes there.
- **Epic burst untouched.** The 1.6× footprint / 80-spark / 5200-peak stack
  already reads as the obvious death explosion; the turret pop + breach +
  deep char carry the new read instead of re-tuning pinned layers.
- **Commander keeps its torso.** A whole upper body flying reads as comic,
  not exploded — it slumps where it stands (retail kbot-death read), with
  leg splay on the locomotion-free axis so the settle-to-neutral gait can't
  fight it.
- **Caught while testing: second-kill windows.** Ambient fire keeps killing
  during multi-second stillness windows, so debris assertions are
  index-scoped (`debrisAt(0)`) rather than global counts.

## Verification

- `yarn test` — core 315 + web 260 pass: new `applyWreckChar` suite (darker
  than live for every kind, luminance floor, stable/idempotent incl. after
  re-tint, `noHighlight` skip) and `CombatFx exploded husks` suite (turret
  pop + breach collar + scene debris, analytic-arc flight then landed rest,
  bearing spread + run-to-run determinism, commander slump with no debris,
  built-wreck char pinned through 2000 ticks of barrage, X/Z stillness with
  zero kick + joint hide at full decay, dressing/debris through
  `clearTransients`).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
