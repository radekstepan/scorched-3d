# Task 14 — Cannon-barrel ballistics

Shots now obey a real firing solution: muzzle exit at the barrel tip along
the barrel direction at per-weapon muzzle velocity, flat direct fire for
bolts, gravity-driven ballistic arcs for shells, barrel pitch aimed at the
solution, and range admission so guns hold fire when too close or
ballistically unreachable.

## What was wrong

Six implausibilities in the old model (`combat.ts` lerp +
`sin(pi·t)·arc`, flat `muzzlePoint` math in `combatFx.ts`):

1. **Fake arc.** Every projectile flew a straight lerp plus a fixed
   per-kind lift (`flash 18, stump 24, hammer 170, commander 30`) peaking
   exactly mid-flight. Arc height was independent of distance: a 200-unit
   lob and a 1500-unit lob peaked at the same 170 units.
2. **Bolts arced.** Energy weapons (Flash/Stumpy/Commander tracers) visibly
   curved through the sky like mortar shells instead of flying flat and fast.
3. **Barrel vs trajectory mismatch.** The Hammer's mesh barrel sits at a
   fixed 40° elevation, yet its shell left the muzzle horizontally and then
   floated upward on the sine lift. Muzzle math also ignored barrel pitch
   and hull grade pitch/roll entirely (yaw-only, flat offsets).
4. **Approximate muzzle.** Exit point was body position + height/forward
   offsets — near the gun, but not the barrel tip, and blind to aim pose.
5. **No range limits.** Any random pair fired at any distance: point-blank
   shots popped vertically on the sine lift, cross-map artillery floated in
   on the same fixed arc as a neighbor duel.
6. **Close-range slow-mo.** `flightDuration` clamped flights to ≥0.18s, so a
   fast bolt at 60 units flew at ~333 u/s instead of its 1300 u/s muzzle
   velocity.

(Already consistent, kept as-is: impact scatter ±11 sits inside the
44–80 blast radii, and recoil opposes the gun — now the *pitched* barrel
rather than the flat yaw.)

## Ballistic model chosen

Pure helpers in `packages/core/src/units/combat.ts` (framework-free,
vitest-covered); thin three.js driver in `combatFx.ts`. Caps preserved
(6 shots, 8 explosions, 2-light pool); still ambient skirmish only, no
health/damage model.

- **Bolts (direct fire):** constant-velocity flight at muzzle velocity,
  aimed straight at the scattered impact — `T = D / V`, the same relation
  retail uses for direct fire (spec 06 §3.2). Gravity = 0.
- **Shells (ballistic):** low-angle root under gravity,
  `tanθ = (V² − √disc) / (g·R)` with
  `disc = V⁴ − g·(g·R² + 2·dy·V²)` — the flat trajectory retail's §3.3
  solver prefers (plus root first). Negative discriminant returns null
  (retail's 0x8000 no-solution sentinel): the gun holds fire instead of
  faking a trajectory.
- **Flight:** analytic `p(t) = muzzle + v·t − ½·g·t²·ŷ`, so the round lands
  on the impact at `t = duration` exactly, deterministically and
  frame-rate independently for any clamped-`dt` sequence. Bolt mesh
  orientation uses the exact derivative `v(t)`.
- **Barrels:** each tank barrel was rebuilt as an elevating pivot (trunnion
  group) with the tube straight along +Z and a `tip` marker at the muzzle;
  the Commander (no gun tube) got a chest-height tip. Fire order: seed
  elevation from the flat muzzle math → `setBarrelElevation` (clamped to
  [−0.15, 1.1] rad) → read the exact tip world position/direction (turret
  yaw + barrel pitch + hull grade pose) → final solve from the live muzzle.
- **Range admission** (cf. retail §3.3): `MIN_RANGE = 50` (cannot depress
  onto a target under the muzzle) and `maxRangeFor` (shells `V²/g`, bolts
  `V·3s`). Out-of-range pairs return false into the existing ~0.15s
  traverse-retry path, so a new pair is picked instead of going silent.

## Numbers

- `GRAVITY = 140` u/s². Hammer `V = 520` → level-ground max range
  `V²/g ≈ 1931` units ≈ one map width (128 cells × 16), so artillery
  reaches most of the field but not corner-to-corner pairs.
- Muzzle velocities (unchanged values, now physically interpreted):
  flash 1300, stump 1050, commander 900, hammer 520 u/s.
- Arc policy falls out of physics, not constants: a 200-unit shell leaves
  at ~3° with ~2.6 units of rise; a 1500-unit shell leaves at ~25.5° with
  ~179 units of rise.
- Longest legal shell flight ≈ 5.3s (max-range lob); safety reject above
  6s. Bolt flights keep `T = D/V` with no minimum clamp (a 60-unit bolt is
  a 0.046s snap, as it should be).
- Recoil unchanged in magnitude (5 units over 0.28s) but now opposes the
  pitched barrel (horizontal projection, so high lobs still kick straight
  back).

## Nanolathe inspiration

- `research/retail-executable-spec/06-weapons-projectiles-damage-and-effects.md`
  §3.3: muzzle `weaponvelocity` + gravity global `g` ballistic solver
  (low root preferred), `T = D/V` direct-fire timing (§3.2 lead), and the
  admission range test. Deviations are deliberate simplifications, not
  ports: double math instead of fixed-point (no π/4 gate, NaN-sentinel, or
  0x8000 encoding — null + mount clamp instead), one gravity global for
  the single shell weapon, and the ambient interval scheduler still stands
  in for per-slot reload timers.
- `internal/meshscene/battle_sprites_projectiles.go`: cannon shells as
  ballistic bodies vs plasma bolts as head→tail oriented strokes — mirrored
  by shell spheres on gravity arcs and velocity-oriented bolt boxes
  (rendering split predates this task; the flights behind them are new).

## Files

- `packages/core/src/units/combat.ts` — dropped `arc` from
  `WEAPON_PROFILES`; added `GRAVITY`, `MIN_RANGE`, `FLIGHT_MAX_TIME`,
  `ELEVATION_MIN/MAX`, `maxRangeFor`/`inRange`/`clampElevation`,
  `solveDirect`/`solveBallistic`/`solveShot`, `ballisticPosition`/
  `ballisticVelocity`; `flightDuration` lost its 0.18s minimum.
  Removed `projectilePosition` (the fake arc).
- `apps/web/src/renderer/units.ts` — barrel pivots + muzzle tips,
  `restBarrelElevation`, `getBarrel`/`getMuzzleTip`,
  `setBarrelElevation`/`barrelElevation`/`muzzleWorld` (null for plain
  test groups → math fallback).
- `apps/web/src/renderer/combatFx.ts` — shots store muzzle velocity +
  gravity + age and integrate analytically; `tryFire` range-gates, aims
  the barrel, solves from the live muzzle; recoil opposes the barrel.
- Tests: `combat.test.ts` (16 new solver/range cases, arc cases removed),
  `combatFx.test.ts` (+2: out-of-range hold-fire, barrel posed on built
  units), `units.test.ts` (+3: pivots/tips, elevation moves the tip,
  plain-group fallbacks).
- `.changeset/cannon-ballistics.md` (minor), `README.md` + `docs/architecture.md`
  one-liners.

## Verification

- `yarn test` — 145 core + 86 web, all pass (16 new solver/range cases
  in core, +2 combatFx and +3 units cases in web; the 4 fake-arc cases were
  removed with `projectilePosition`).
- `yarn typecheck` — 3 tasks successful. (Web resolves core via `dist/`,
  so `yarn build` runs before web tests pick up core changes.)
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).

## Decisions

- Low-angle root only (no high mortar lob): every reachable target gets
  the flat, fast, readable trajectory; unreachable targets hold fire like
  retail rather than switching to a high arc that would read as a
  different weapon.
- Exact live muzzle via the tip world matrix costs one `updateMatrixWorld`
  per shot — negligible at ≤6 concurrent shots — and buys hull-grade and
  recoil correctness the flat math could never have.
- Kept scatter impacts (ambient character unchanged): the solver aims at
  the scattered point, so physics serves the existing "always hits near
  the hull" design instead of replacing it with a hit/miss model (damage
  is the next task's job, out of scope here).
