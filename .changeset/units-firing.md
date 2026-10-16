---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Units now trade ambient skirmish fire: a scheduler picks random attacker/target pairs and animates tracer bolts and arcing artillery shells with muzzle flashes, impact explosions, pooled dynamic lights, and recoil kicks.

## Task writeup (moved from docs/tasks/07-units-firing.md)

# Task 4 — Units firing at each other

## What changed

The map is now a live skirmish: units randomly fire at each other with a
tracer/shell projectile, muzzle flash, impact explosion, dynamic light pops,
and a recoil kick — all inside the existing `TerrainCanvas` render loop, with
no new runtime dependencies and no changes to pan/commander-camera/fps code
paths.

- `packages/core/src/units/combat.ts` (new) — framework-free skirmish logic:
  `WEAPON_PROFILES` (per-kind shot style, speed, arc, tracer color, flash
  time), `pickSkirmishPair()` (uniform over ordered distinct index pairs,
  null when fewer than two units), `nextShotDelay()` (uniform in
  `[SHOT_DELAY_MIN, SHOT_DELAY_MAX] = [0.35, 1.1]s`), `flightDuration()`
  (distance/speed clamped to `[0.18, 3.0]s`), `projectilePosition()`
  (lerp + `sin(pi·t)·arc` parabolic lift), `muzzleHeight()` /
  `muzzleForward()` (per-kind offsets matching `units.ts` silhouettes).
  Exported from `packages/core/src/index.ts`.
- `packages/core/src/units/combat.test.ts` (new) — 13 vitest cases.
- `apps/web/src/renderer/combatFx.ts` (new) — three.js `CombatFx` manager
  plus pure `muzzlePoint()` / `impactPoint()` helpers. The scheduler fires
  every 0.35–1.1s (capped at `MAX_SHOTS = 6` concurrent tracers);
  bolts are velocity-oriented boxes, shells are arcing spheres; each shot
  spawns a muzzle flash + pooled point-light pop and kicks the attacker's
  hull back along its facing for 0.28s; impacts spawn an expanding flash
  sphere, 26 gravity-driven additive spark particles, and another light
  pop (capped at `MAX_EXPLOSIONS = 8`, oldest evicted). Two pooled
  `PointLight`s are shared by all effects — never one per shot.
- `apps/web/src/renderer/combatFx.test.ts` (new) — 6 vitest cases driving
  the real class against a headless `THREE.Scene` (no renderer needed).
- `apps/web/src/renderer/TerrainCanvas.tsx` — constructs `CombatFx` after
  `buildUnits`, calls `combat.update(dt)` each tick, `clearTransients()` on
  exaggeration re-snap (in-flight endpoints were sampled at old heights),
  and `dispose()` on unmount/regen alongside the existing disposals.
- `.changeset/units-firing.md` (new) — **minor** changeset for core + web
  (new visible feature, not a fix).
- `README.md` — one-line combat-FX mention in the demo description.

## Nanolathe inspiration

Borrowed conventions from `internal/meshscene/battle_sprites_projectiles.go`
and `research/retail-executable-spec/06-weapons-projectiles-damage-and-effects.md`,
adapted to three.js (no GAF sprites here):

- Projectile families: nanolathe renders cannon shells as ballistic bodies
  but plasma bolts/beams as head→tail oriented strokes
  (`spriteProjectileSequences = cannonshell/plasmasm/...`, `RenderTypeBeam`
  with `BeamStrokes` head/tail geometry). Mirrored as per-kind profiles:
  Flash/Stumpy fire flat fast bolts, the Hammer lobs a slow high-arc shell,
  the Commander fires a heavy blue-white bolt.
- Dynamic lights riding shots: nanolathe attaches art/beam lights to
  projectiles and explosions. Mirrored with a 2-light pool kicked at the
  muzzle and at impact, decaying over ~0.2s — bounded instead of per-shot
  so Lambert shading cost stays flat.
- Weapon catalog fields (velocity/range/reload/burst, spec 06 §2) collapse
  to `WEAPON_PROFILES` speed/arc plus one interval scheduler standing in
  for per-slot reload timers; the 30-tick simulation phase has no analog in
  a `requestAnimationFrame` demo, so timing is wall-clock via the loop's
  clamped `dt`.

## Decisions

Random ambient skirmish only: no selection, health, or damage model — shots
always "hit" near the target hull with scatter, purely for visual variety.
Muzzle points are computed from live body positions + facing each shot, so
recoil offsets (applied on top of group positions, restored after 0.28s)
and exaggeration re-snaps never desync the guns; re-snaps clear transients
rather than re-targeting mid-flight shots.

Perf is capped three ways: max 6 concurrent shots, max 8 explosions (oldest
evicted), and 2 shared point lights. Geometries are shared across shots
(one bolt box, one shell/flash/shock sphere); only small materials and the
26-point spark buffers are per-effect and disposed on removal. No sound —
visuals only, per the task.

Commander has no barrel mesh (biped kbot), so its bolt leaves from chest
height (`muzzleHeight = 30`) — reads as a shoulder/cannon mount at demo
scale.

## Verification

- `yarn test` — all pass (13 new core combat tests + 6 new combatFx tests;
  totals 44 core + 49 web, including untouched pan/start/fps suites).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
