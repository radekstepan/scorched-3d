---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

HQ reinforcements now emerge at the works door and walk the hall out of the mouth instead of popping in at the mouth, and the HQ factory stands taller than the commander.

## Task writeup

# Task 138 — Walk-out HQ releases + taller works

Releases used to appear at the hall mouth (`HQ_EXIT_OFFSET`), so the hall read as a bridge units teleported onto. The release now appears at a door-side hall start (`HQ_SPAWN_OFFSET = 64`: front face + longest spawnable half-hull + door-slab clearance) and drives the hall's length out of the mouth on its door-to-staging leg; staging still anchors past the mouth at the dirt road's far end, so the leg walks the hall plus the road. The works also grew (walls 26 → 34, door 24 → 32 with full-clear travel, beacon/chimneys/silo re-crowned) so the roofline beats the commander's torso and the stacks beat its antenna — the proportion fix lands on the HQ, not the unit.

## Decisions

- Door-side spawn, not interior spawn: spawning inside the bunker would bury wheels 4 units in the slab and graze the hammer's elevated tube on the lifted door; spawning just outside the door (rear overhang measured clear of the front wall for every roster kind) reads as emerging with no clipping and no pop-in inside the walls.
- `onSpawn` keeps its positional shape and gains the hall-mouth exit as a 5th parameter, so the canvas keeps staging at mouth + 320 (road end) without recomputing anchors; existing 4-arg callbacks stay assignable.
- Door travel now equals door height (full clear; previously 22 < 24 left the opening's top 2 units blocked), and the opening head (4 + 32) clears the tallest roster tube (hammer ≈ 35) — pinned by a bbox test over the real spawnable bodies.

## What changed

- `apps/web/src/renderer/hq.ts`: `HQ_SPAWN_OFFSET` + `hqSpawnWorld`; taller walls/door/travel/beacon/chimneys/silo.
- `apps/web/src/renderer/hqFx.ts`: `spawnAt`, release at the door-side start with the mouth passed as `exit`.
- `apps/web/src/renderer/TerrainCanvas.tsx`: release spawns at the door, staging past the mouth.
- `apps/web/src/renderer/movement.ts`, `packages/core/src/units/hq.ts`: comment touch-ups (spawn-at-door wording).

## Tests

- `hq.test.ts` (+3): door-side spawn placement/mirroring with the mouth ahead; every roster body fits the door head/width with its rear clear of the front wall; the works beats the commander overall and at the roofline-vs-torso.
- `hqFx.test.ts` (+1): release fires at the door-side start and reports the mouth as the exit.

## Verification

`yarn test` green (core 574, web full suite), `yarn typecheck` green, `yarn build` green. The 4 new tests failed before the change (spawn at mouth, HQ shorter than commander) and pass after.
