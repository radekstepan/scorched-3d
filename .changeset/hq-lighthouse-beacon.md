---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Rebuilt the HQ warning beacon as a lighthouse: twin directional red cones circle inside the lens on the existing rotor instead of the core + halo swelling in and out.

## Task writeup

# Task — HQ beacon reads as a circulating lighthouse beam

The HQ red light pulsed: the hot core swelled, brightened, and bobbed
while an additive halo shell swelled and brightened past the lens — light
radiating in and out. The request was a lighthouse instead: steady light
circling inside the dome, directing a cone of light at a moving angle.

## What changed (web only — no core change)

- `hq.ts` (`buildHq`): the breathing halo shell is gone. In its place,
  twin open additive cones (`hq-beacon-beam-a/b`, apex at the hot core,
  `HQ_BEACON_BEAM_LEN` 7 past the radius-2 lens) ride the existing rotor
  in opposite horizontal directions — MeshBasicMaterial + AdditiveBlending
  + no depth write, per the combat/fire glow convention. The hot core,
  motes, lens, and wash PointLight stay where they were.
- `hq.ts` (drivers): removed `hqBeaconPulseAt` / `setHqBeaconPulse` and
  the `HQ_BEACON_BOB` / `HQ_BEACON_HALO_SCALE` constants. `setHqBeaconLevel`
  keeps its exact level contract (lens + motes + wash light, night peak
  passthrough, wrecks never re-light) and now seats the core + beams
  steady through `applyBeaconCore`: constant burn, constant beam opacity,
  beams hidden at level 0. New `getHqBeaconBeams` getter; `getHqBeaconHalo`
  removed.
- `hqFx.ts`: the tick drops the pulse write — one shared angle write per
  live HQ, so both forts' beams sweep in sync.
- Tests (`hq.test.ts`, `hqFx.test.ts`): replaced the three pulse/breath
  tests with beam-sweep coverage — cone geometry + opposite directions,
  half-turn mirroring and quarter-turn sideways sweep, steady
  core/beam/wash across a full turn, level seating (1 / 0.5 / 0), wreck
  darkness, and an HqFx tick test proving the cone angle circles while
  burn and opacity stay exactly constant on both forts.

## Decisions

- The wash PointLight deliberately stays steady and omnidirectional: it is
  the works + hall + apron illumination, not the visible signal. Making it
  directional (a spotlight tracking the beam) would cost a shadowless
  spotlight per HQ for little readable gain — the directional read comes
  from the cones themselves sweeping through the clear lens.
- Removed the pulse API outright instead of deprecating it: the only
  consumer was the HqFx tick, and a leftover breathing entry point would
  invite reintroducing the exact motion this task removes.
- The sibling `nanolathe` repo has no lighthouse/beacon pattern to borrow
  (only incidental spec mentions), so this follows the codebase's own
  rotor + additive-glow conventions.

## Verification

- Targeted: all 36 tests across `hq.test.ts` + `hqFx.test.ts` pass.
- `yarn test`: 682 web + core pass; the single failure
  (`deployPages.test.ts`, GitHub Pages workflow pin) also fails on clean
  HEAD, so it is pre-existing and unrelated. No browser automation per
  task scope.
- `yarn typecheck`: all 3 tasks pass. `yarn build`: succeeds.
