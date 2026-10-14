# Task 8 — Facing hulls, traverse-limited turrets

## What changed

Units now fight like vehicles instead of spinning gun platforms: hulls turn
to face their target at a limited rate, turret/barrel subgroups slew the
remainder inside a clamped traverse, and a shot only leaves down the turret
line once aimed — never from a random hull side.

- `packages/core/src/units/facing.ts` (new) — framework-free facing logic,
  exported from `packages/core/src/index.ts`: `yawToTarget()` (bearing,
  yaw 0 = +Z growing toward +X, matching the mesh/muzzle convention),
  `wrapAngle()` / `stepAngle()` (shortest-arc stepping), `TURRET_LIMIT`
  (Flash ±60°, Stumpy ±75°, Hammer ±50°, Commander torso ±90°),
  `HULL_TURN_RATE` (1.1–2.0 rad/s) / `TURRET_SLEW_RATE` (1.8–3.0 rad/s,
  always faster than the hull), `FIRE_TOLERANCE` (0.06 rad), `muzzleYaw()`
  (hull + turret-relative), `aimError()` / `canFire()`, and `aimStep()`
  (hull does the gross turn, turret slews the clamped remainder; a dead-astern
  target is acquired by turning around, never by spinning the turret).
- `packages/core/src/units/facing.test.ts` (new) — 15 vitest cases: angle
  wrapping, cardinal bearings + sin/cos forward agreement, shortest-arc
  steps, per-kind clamps, fire gating, turret-never-exceeds-limit over a
  full turnaround for every kind, and convergence from every octant.
- `apps/web/src/renderer/units.ts` — every unit body now carries a named
  `turret` subgroup (`userData.turret`): tanks move the turret box + barrel
  into it, the Commander moves its whole upper torso (chest/trim/head/
  antenna) into it while the legs stay on the hull. New `getTurret()` /
  `setUnitAim()` (yaw hull + turret-relative) keep all three.js posing in
  one place; exaggeration re-snaps still only move origins, so aim survives.
- `apps/web/src/renderer/combatFx.ts` — per-unit aim poses plus an
  attacker→target pending map slewed every frame via core `aimStep()` and
  applied with `setUnitAim()`. `tryFire()` registers the pair, then fires
  only when `canFire()`; otherwise the pair keeps traversing and the
  scheduler retries in ~0.12–0.22s instead of a full ambient interval.
  Muzzle + recoil kick use the absolute turret line (`muzzleYaw`), not the
  hull. New `totalFired` counter and `aimState()` readout (tests/HUD).
  Caps unchanged: 6 shots, 8 explosions, 2 pooled lights.
- `apps/web/src/renderer/combatFx.test.ts` — updated helpers mirror the
  turret subgroups; 3 new cases: no fire during the first second with an
  attacker facing dead away (then fire after traverse), turret clamp held on
  mesh + state across 600 steps with hulls tracking, muzzle follows the
  turret line. `apps/web/src/renderer/units.test.ts` (new, 4 cases) covers
  turret presence, hull/turret part split, `setUnitAim`, and re-snap
  survival.
- `.changeset/facing-turret.md` (new) — **minor** changeset for core + web
  (visible behavior change).
- `README.md` — one-line facing/traverse mention in the demo description.

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted, no retail assets):

- `research/retail-executable-spec/06-weapons-projectiles-damage-and-effects.md`
  §3.3 — the turret executor solves aim yaw **relative to the unit heading**
  (`yaw = atan2(AimFrom − target) − heading`) and fires through an aim latch
  + angular-drift gate. Mirrored as `aimStep()` (relative turret yaw,
  `canFire()` gate) with per-frame traverse instead of per-slot reload
  timers, which have no analog in a rAF demo.
- `research/formats/cob.md` — traverse/pitch pieces turn toward the aim
  with `restore` to rest; the engine never slews a turret at an invented
  "aim rate". Our rates are gameplay clamps in the same spirit (turret
  always faster than hull = fine vs gross motion).
- `internal/combat/service.go` (`aimYawForScript` = bearing minus heading)
  and `internal/meshscene/battle_pose.go` (`Heading` on `UnitView`,
  `FoldRootAngles`) — confirmed the heading-relative convention and that
  heading stays a first-class per-unit state, which is why aim poses live
  per unit in `CombatFx` rather than per shot.

## Decisions

**Hulls turn to face the target (not a forward-arc fire gate).** A gate
would stall the ambient skirmish: most random pairs start outside any
narrow arc, so the demo would go quiet for seconds at a time. Turning
guarantees every scheduled engagement eventually fires while still showing
facing discipline — and matches TA, where mobile units rotate the hull
toward the target and refine with the turret.

**Turret clamp binds because the hull rate-limits.** The hull steps toward
the target at 1.1–2.0 rad/s while the turret only takes the clamped
remainder, so a flanking target visibly swings the hull first and the
barrel never spins freely (±50–90° by kind; artillery narrowest, kbot
torso widest).

**Core stays framework-free.** All angles/rates/limits are pure math in
`facing.ts` with vitest coverage; `combatFx.ts` / `units.ts` only
animate, pose, and dispose. No health/damage model — shots still always
"hit" near the hull; facing only changes where they leave from.

## Verification

- `yarn test` — all pass (15 new core facing tests + 3 new combatFx tests
  + 4 new units tests; totals 59 core + 56 web).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
