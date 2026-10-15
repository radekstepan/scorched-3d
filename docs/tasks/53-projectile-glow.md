# Task 53 — Projectile glow (in-flight rounds illuminate what they pass)

Flying shells and tracer bolts now light up whatever they pass near —
tree canopies, trunks, rocks, hulls, and the dirt itself — so night and
low-light flight reads as a moving glow, not just a bright dot.

## Decision: hybrid, not real lights alone

`shaders.ts` settled it: terrain, water, and sky are custom
`ShaderMaterial`s with no light uniforms, so `THREE.PointLight`s can never
brighten the dirt. Trees, rocks, and hulls are `MeshLambertMaterial` and
respond to lights normally (the scene already carries hemisphere + sun
lights for them). The implementation splits on that line:

- **Riding `PointLight`s** (one per glowing round) light Lambert
  neighbors — canopies, trunks, rocks, hulls — with physical
  distance/decay falloff, no shadows, exactly like the existing
  muzzle/explosion kick pool.
- **Additive ground blobs** fake the same light on the unlit terrain
  shader: a soft disc seated on `env.groundY + 1.4` under each glowing
  round, fading with height above the dirt.

## What changed (`combatFx.ts` view only — no core change)

- Fixed pool: `SHOT_GLOW_LIGHTS = 4` riding lights (distance 600, decay
  1.8) + 4 ground-blob discs (shared `CircleGeometry`, per-slot tinted
  materials). Slot `i` rides `shots[i]` every tick; rounds past the pool
  fly dark. No per-shot alloc, no per-frame leak.
- Height falloff: pure `projectileGlowFalloff(height)` — 1 at the surface,
  linear to 0 at `SHOT_GLOW_RANGE = 380`. Drives both the riding-light dim
  (`SHOT_GLOW_PEAK = 1800`, the muzzle-kick order) and the blob opacity
  (peak 0.4, radius ~70 at full strength). Low skimmers light the
  undergrowth; high lobbed arcs go quiet.
- Headless (no env): lights still ride the rounds, blobs hide — there is
  no dirt to seat them on.
- Untouched by design: the 2-light muzzle/explosion kick pool, muzzle
  core-plus-halo layers, the layered explosion stack (flash, fireball,
  smoke, ring, lingering glow, sparks), scorch/dent/blast paths,
  wreck/husk posing, and all sim state (glow is view-only — firing,
  interception, damage, and kill flow never see it). `clearTransients`
  darkens/hides the pool; `dispose` removes and disposes it.
- Getters for tests/HUD: `shotGlowCount`, `shotGlowIntensityAt(i)`,
  `shotGlowOpacityAt(i)`.

## Nanolathe inspiration

- `internal/meshscene/battle_sprites_projectiles.go`: a dynamic light
  riding each bolt/explosion — mirrored here twice over (kick pool for
  muzzle/impact pops, glow pool for the flight between them). Deviation is
  deliberate: nanolathe's renderer lights everything, while this terrain
  shader ignores lights, so the ground path is a faked additive blob
  (the same trick the lingering blast glow already uses) rather than a
  second light.

## Files

- `apps/web/src/renderer/combatFx.ts` — glow pool, falloff, seating,
  getters, clear/dispose.
- `apps/web/src/renderer/combatFx.test.ts` — 4 new projectile-glow cases
  (+ adjusted light-count and clear/leak bounds for the new pool).
- `.changeset/projectile-glow.md` (patch), `README.md` one-liner.
- `docs/tasks/53-projectile-glow.md` (this writeup).

## Verification

- `yarn test` — core + web, all pass (4 new cases; 49 combatFx tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
