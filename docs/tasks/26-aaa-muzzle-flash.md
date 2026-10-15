# Task 26 — AAA muzzle flash + layered explosions

Muzzle flashes already popped against hull paint; impacts were a single
expanding flash sphere plus 26 sparks. Shots now leave a layered
core-plus-halo muzzle flash, and every impact — against a hull or against
dirt, trees, and rocks — builds the same layered AAA stack: weapon-tinted
flash shell, rising orange fireball, cool-grey smoke puffs, an expanding
ground shockwave ring, spark debris, a pooled light kick, and a lingering
ground glow seated on the terrain.

## What changed (`combatFx.ts` view only — no core change)

- Layered muzzle (`spawnMuzzle`): each shot leaves two additive flashes —
  a white-hot core (scale 0.8, peak opacity 1) plus a larger faint halo in
  the weapon color (scale 1.9, growth 2.4, peak 0.4, 1.4× life). Additive
  blending reads against hull paint and against foliage/dirt alike, and
  the existing pooled point-light kick illuminates whatever is nearby —
  units or environment — with no per-shot lights.
- Layered explosion (`explode`): the old flash-shell + sparks pairing
  grows into flash shell + fireball (`0xffa03c`, balloons in the first
  quarter then collapses and lifts 14u) + 3 cool-grey smoke puffs
  (`0x8f959e`, shared material, per-puff rng rise/drift velocities,
  climbing and swelling while fading) + ground shockwave ring
  (`0xffe2b8`, from 0.4× to 2.4× the kind scorch radius) + lingering
  ground glow (`0xff9a3c`, 1.1× the scorch radius, slowest fade) +
  36 gravity-driven sparks (26 → 36) + the pooled light kick. Ring and
  glow are seated at `env.groundY + 1.6/1.4` so the blast footprint reads
  on dirt and undergrowth, not just on hulls.
- Caps held: explosions still 8 (oldest evicted), shots 6, lights 2;
  flashes are now an explicitly bounded pool (`MAX_FLASHES = 24`, oldest
  evicted). Explosion life 0.8 → 1.0s so the layers stage instead of
  popping. Geometries stay shared (fire/smoke/ring/glow); one extra
  material per layer is owned per explosion and disposed with it.
  New `flashCount` / `explosionCount` getters for tests/HUD.
- Untouched by design: gentler-scorch palette (task 25) — smoke is cool
  grey `0x8f959e`, never brown; scorch sizes/shades/dents/radii and the
  `0.62` layer opacity are byte-identical. Subtle damage smoke (task 24) —
  `UnitDamageFx` thresholds/sizes/cadence unchanged. No sound.

## Nanolathe inspiration

- `internal/meshscene/battle_sprites_projectiles.go`: cannon shells as
  ballistic bodies vs plasma bolts as head→tail strokes, with a dynamic
  light riding each bolt/explosion — mirrored by velocity-oriented bolt
  boxes, shell spheres, and the 2-light pool kicked at muzzle + impact
  (rendering split predates this task; the layers behind the lights are
  new).
- `internal/effects` (flash timing + smoke/fire debris views) and the
  flash-shell + smoke-column + sparks pairing noted in the task-20
  learnings: every explosion here now pairs an additive flash shell with
  a rising smoke column and spark debris instead of a single opaque blob,
  adapted from sprites to three.js meshes. Deviations are deliberate:
  pooled instanced/quadded sprites become per-explosion meshes (≤8 live,
  disposed on removal) because the demo has no sprite batcher, and fire
  colors stay fixed orange regardless of the weapon tint (combustion, not
  tracer light).

## Files

- `apps/web/src/renderer/combatFx.ts` — layered muzzle + explosion,
  `MAX_FLASHES`, shared fire/smoke/ring/glow geos, getters, disposal.
- `apps/web/src/renderer/combatFx.test.ts` — 5 new AAA cases (+ adjusted
  transient-budget bound for the halo layer and `UnitDamageFx` draws).
- `.changeset/aaa-muzzle-flash.md` (minor), `README.md` one-liner.
- `docs/tasks/26-aaa-muzzle-flash.md` (this writeup).

## Verification

- `yarn test` — 201 core + 144 web, all pass (5 new AAA cases; existing
  scorch-tint/dent/opacity suites still pin the task-25 palette).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
