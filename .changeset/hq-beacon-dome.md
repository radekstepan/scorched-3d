---
"@scorched-3d/web": patch
---

HQ warning beacon is a bare hemisphere with a light rotating inside it, no mast or platform

## Task writeup (moved from docs/tasks/106-hq-beacon-dome.md)

# Task 106 — HQ beacon dome (no mast, rotating light inside)

Each standing HQ factory now carries a bare red hemisphere seated directly
on the canopy top over the door — no mast, no collar, no platform — with a
small rotor inside it spinning one cheap red `PointLight` + bulb around, so
the "working building" signal reads as a sweeping rotating beacon. Wrecked
forts go dark with the rest of the husk and never re-light.

## What changed

- `apps/web/src/renderer/hq.ts` — `buildHq` drops the mast + collar boxes
  and seats a translucent red hemisphere (`hq-beacon`, `SphereGeometry`
  with `thetaLength = PI/2`, `MeshLambertMaterial`, `opacity 0.55`,
  `DoubleSide` so the rotor reads through the lens) directly on the canopy
  top (local `HQ_BEACON_X = 58`, `HQ_BEACON_Y = 33`, z = 0). New
  `hq-beacon-rotor` group at the dome seat carries `hq-beacon-bulb` (small
  hot sphere) and `hq-beacon-light` (peak 900 / distance 170 / decay 1.8,
  unchanged wash), both offset `HQ_BEACON_ORBIT = 1.1` from the axis so a
  `rotation.y` write sweeps them inside the lens. New pure helpers:
  `hqBeaconAngleAt(t)` (one full turn per `HQ_BEACON_PERIOD = 1.4 s`;
  degenerate time parks at 0), `getHqBeaconRotor` / `hqBeaconAngleOf` /
  `setHqBeaconAngle`; `hqWarningBlinkAt` is gone (no more square blink).
  `setHqBeaconLevel` keeps its drive/clamp contract and now also kills the
  bulb emissive on wrecks.
- `apps/web/src/renderer/hqFx.ts` — `HqFx.update` drives a shared sweep
  phase: every live HQ gets `setHqBeaconLevel(group, 1)` (constant wash)
  plus one `setHqBeaconAngle` write per tick, so both forts sweep in sync;
  destroyed HQs are skipped (rotor frozen, light already dead).
- `README.md` — "flashing red warning beacon" becomes "rotating red
  warning beacon".
- `.changeset/hq-beacon-dome.md` (patch, web only).

## Decisions

- Hemisphere via `thetaLength`, not a clipped full sphere: one geometry,
  base ring sits flush on the canopy, nothing to bury or align.
- Translucent lens (`opacity 0.55`) over an opaque one: the spec wants the
  light *visible rotating inside it*, so the bulb sweep must show through
  the dome, not just wash the neighbors.
- Constant wash + rotating source instead of the old square blink: the
  sweep itself is the flash — no dark half where the works reads dead.
  The 1.4 s period is kept, now meaning one revolution.
- Wreck-dark stays two-deep (`poseHqWreck` kills lens + bulb + light, and
  `setHqBeaconLevel` no-ops to dark when `hqWrecked` is set), and the tick
  skips wrecks so a husk rotor never turns again.

## Test evidence

- Targeted: `hq.test.ts` + `hqFx.test.ts` — 25 tests pass (new/rewritten
  beacon cases: bare hemisphere geometry + canopy-top seat, no
  mast/platform boxes in the beacon column, rotor/light/bulb parenting +
  orbit radius, sweep phase/wrap, angle drive mirrors the light orbit,
  level drive + clamping, wreck kills lens + bulb + light and never
  re-lights; `hqFx`: both forts sweep in sync with the wash on, wreck
  freezes dark while the survivor keeps sweeping).
- Full `yarn test` (web): 502/503 pass; the single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire")
  is pre-existing — verified failing on the clean tree via `git stash`,
  same failure documented in task 99.
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — clean.
- Playwright not run (per task rules).
