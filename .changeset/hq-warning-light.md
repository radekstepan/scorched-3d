---
"@scorched-3d/web": patch
---

HQ factories flash a red warning beacon while standing

## Task writeup (moved from docs/tasks/99-hq-warning-light.md)

# Task 99 — HQ warning beacon

Each standing HQ factory now flashes a small red warning light on the top
front of the building, over the entrance — a "working building" signal that
also washes the canopy and door apron in pulsing red light. Wrecked forts
go dark with the rest of the husk and never re-light.

## What changed

- `apps/web/src/renderer/hq.ts` — `buildHq` mounts the beacon on the
  canopy front edge, centered over the door (local `HQ_BEACON_X = 58`,
  `HQ_BEACON_Y = 41.8`, z = 0): a short dark mast + collar, a red
  emissive dome (`hq-beacon`, `MeshLambertMaterial` so the factory
  material/no-highlight conventions still hold), and one cheap no-shadow
  red `PointLight` (`hq-beacon-light`, peak 900 / distance 170 / decay
  1.8 — combat-pool order, so it only kisses the canopy and door apron).
  New pure helpers: `hqWarningBlinkAt(t)` (square blink, 1.4 s period,
  50% duty; degenerate time reads lit), `getHqBeacon` /
  `getHqBeaconLight`, and `setHqBeaconLevel(group, level)` (clamped;
  drives dome `emissiveIntensity` 0.12–2.32 plus light intensity, forces
  wrecks dark). `poseHqWreck` calls `setHqBeaconLevel(group, 0)` after the
  char pass — the traverse darkens the lens color but would leave the red
  emissive glowing, so the lens emissive is killed explicitly.
- `apps/web/src/renderer/hqFx.ts` — `HqFx` owns a shared flash `clock`
  (advanced in `update`, so both forts blink in sync): every live HQ gets
  one `setHqBeaconLevel` write per tick (2 lights total, no shadows);
  destroyed HQs are skipped (their beacon already died in the wreck pose).
  Beacons start lit in the constructor; the first tick's blink takes over.
- `README.md` — factory-works parenthetical gains "a flashing red
  warning beacon".
- `.changeset/hq-warning-light.md` (patch, web only).

## Decisions

- Square blink (not a smooth pulse): the spec says "flashing", and a
  hard on/off reads as a warning beacon at a glance. 1.4 s / 50% duty is
  calm, not strobing.
- One `PointLight` per HQ parented to the HQ group (moves/resnaps/
  disposes with it, zero per-frame alloc). The terrain/water/sky shaders
  ignore scene lights, so the wash only touches Lambert neighbors (the
  works itself, nearby hulls) — the emissive dome carries the signal at
  distance.
- Wreck-dark is enforced in two places: `poseHqWreck` kills the lens +
  light, and `setHqBeaconLevel` no-ops to dark when `hqWrecked` is set —
  so even a direct drive call can never re-light a husk.

## Test evidence

- Targeted: `hq.test.ts` + `hqFx.test.ts` — 22 tests pass (4 new beacon
  cases in `hq.test.ts`: dome/light presence, front-top-over-door
  placement, red lens + light color, blink phase/wrap, level drive +
  clamping, wreck kills + never re-lights; 2 new in `hqFx.test.ts`:
  both forts blink in sync across ticks, wreck kills the beacon while
  the survivor keeps flashing).
- Full `yarn test` (web): 454/455 pass; the single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire",
  `shotCount` 1 vs 0) is pre-existing — verified failing on the clean
  tree via `git stash`, same failure documented in task 98.
- `yarn typecheck` — 3 tasks successful.
- `yarn build` (web) — clean.
- Playwright not run (per task rules).
