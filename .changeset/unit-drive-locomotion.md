---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Heavier unit physics: slower weightier turret traverses, spinning road wheels on tracked hulls driven by travelled distance, and an alternating commander walk gait with step lift that settles back to neutral at rest

## Task writeup (moved from docs/tasks/27-unit-drive-locomotion.md)

# Task 27 — Unit drive physics: wheels, walking legs, slower turrets

Three complaints, one shared root cause: locomotion had no visible
connection to the ground. Tracked hulls glided on flat box bottoms, the
commander ice-skated on two static boxes, and turrets snapped onto targets
fast enough to read as turret-spinning rather than aiming. All three now
key off travelled distance and heavier traverse rates.

## What changed

- Slower turrets (core `facing.ts` `TURRET_SLEW_RATE`): flash 3.0 → 2.4,
  stump 2.4 → 1.9, hammer 1.8 → 1.4, commander 2.2 → 1.9 (~20% slower,
  heavier wind-up before the first aimed shot). Every turret still slews
  faster than its hull turns (fine vs gross motion, per the task-08
  invariant), and the pending-pair scheduler's ~0.15 s fast retry is
  untouched, so engagements still fire as soon as they aim — just after a
  visible traverse.
- Distance-driven locomotion math (core `units/locomotion.ts`, new,
  framework-free): `WHEEL_RADIUS` per kind (flash 3, stump/hammer 4,
  commander 0), `wheelSpinFor` (`distance / radius`), `LEG_STRIDE`
  (commander 16 world units per full gait cycle, tanks 0), `advanceGait`
  (phase ∝ distance, wrapped), antiphase `legSwing` / plant-aware
  `legLift` (the lifting leg is the forward-swinging one), and
  `settleToward` for the stride amplitude. A hull pinned on a slope or
  held in a crowd travels no distance, so wheels never spin and legs never
  march in place.
- Meshes (`renderer/units.ts`): three axle stations per side on every
  tracked hull (geometry pre-rotated so `rotation.x` spins the axle while
  the meshes stay direct hull children), commander legs rebuilt as
  hip-pivot meshes (geometry translated so the origin sits at the hip,
  rest footprint byte-identical). New `getWheels()` / `getLegs()` /
  `advanceLocomotion()` (spin + stride + settle-to-neutral at rest);
  re-snaps move origins/tilt only, so spin and gait survive exaggeration
  changes.
- Driver (`renderer/movement.ts`): each tick poses locomotion from the
  tick's travelled `hypot(dx, dz)` — turret subgroups still untouched,
  travel still equals yaw, tilt seating unchanged.

## Important decisions

- **Distance, not time, drives the wheels and legs.** A time-based gait
  would march held/steep-pinned hulls in place; distance keys everything
  to the drive clamp for free.
- **Amplitude settles, phase persists.** When the hull stops, the stride
  amplitude eases to 0 (legs return to neutral instead of freezing
  mid-step) while the phase holds, so drive-off resumes without a pop.
- **Wheels stay in the damage-tint pass.** First cut skipped them as
  "rubber", but the task-24 sweep asserts every Lambert mesh stays above
  the luminance floor — near-black rubber fails that even untinted. Fix:
  wheels are dark grey (`0x3a3a40`, base lum ~0.043, charred ~0.045) so
  they soot up with the hull and the never-near-black guarantee holds for
  every mesh with no exemption.
- **Nanolathe has nothing to borrow here.** Its COB/battle-pose code
  drives scripted aim pieces and projectile sprites, not procedural wheel
  spin or gait (checked `internal/units/cob_*`, `battle_pose.go`); the
  retail parallel is traverse/pitch pieces turning toward aim with
  `restore` to rest — mirrored by the settle-to-neutral stride.

## Verification

- `yarn build` — turborepo build succeeds (web single-file bundle).
- `yarn typecheck` — 3 tasks successful.
- `yarn test` — 211 core + 151 web, all pass: new `locomotion.test.ts`
  (wheel spin ∝ distance, gait phase ∝ distance + wrap, antiphase
  swing/plant lift, amplitude settle), `facing.test.ts` pins the slower
  rates + still-faster-than-hull + a 90° correction taking longer than
  the old tune, `units.test.ts` (wheel/leg fit, spin ∝ road, antiphase
  stride + rest neutral, re-snap survival, plain-group no-op),
  `movement.test.ts` (driving spins wheels + strides at full amplitude,
  holding freezes wheels and settles legs), and the carried
  traverse/astern suites still converge inside their generous step
  budgets.
- Playwright not run (per task rules).
