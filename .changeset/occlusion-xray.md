---
"@scorched-3d/web": patch
---

Units hidden behind terrain or live tree canopies now render a blue box-outline ghost (selection cyan) so occluded hulls stay locatable; works for damaged units and present husks, never tints hull paint.

## Task writeup (moved from docs/tasks/44-occlusion-xray.md)

# Task 44 — Occlusion x-ray: blue outline for units hidden by terrain or trees

## What changed and why

Low camera angles routinely hide hulls behind ridges or inside live
canopies, and the task-43 ring/beacon markers sit at ground level or high
above the hull — neither draws the hidden hull itself. This task adds an
occlusion x-ray: any unit (or part of one) blocked from the current camera
by the terrain heightfield or a standing tree canopy renders a blue box
outline ghost of its hull volume, so the player can locate it at a glance.

Design, per the brief's perf note (no per-pixel raycast storm, no three.js
`Raycaster` per frame):

- Pure sampling math (`apps/web/src/renderer/occlusionFx.ts`): each unit
  tests `OCCLUSION_TAPS` hull taps (6/18/30 above the body origin: low hull,
  turret, mast band) on the camera→tap ray. Terrain: march
  `OCCLUSION_SAMPLES` (16) interior samples against the live `groundY`
  heightfield (+1 grace so a hull never self-occludes on its own grade).
  Trees: core `treesOnSegment` (crown sphere + trunk cylinder, standing wood
  only — the same volumes and the same standing mask projectiles use). Any
  blocked tap ghosts the unit, so partial cover (nose behind a ridge, hull
  under one crown) still reads.
- `OcclusionFx` view: one `LineSegments` box outline per roster unit sharing
  a single `EdgesGeometry`/`LineBasicMaterial`, parked on the body origin
  (yawed, footprint-sized via core `HULL_FOOTPRINT` × per-kind ghost height;
  commander clears its 47-unit antenna), `depthTest: false` at render order
  14 (above health bars at 13), shown exactly while occluded. Per-tick cost
  for a ~6-hull roster is a few thousand cheap rejects — no allocations past
  the caller-owned stands array.
- Blue is `SELECTION_CORE` (0x22d3ee) by alias (`OCCLUSION_BLUE`), so the
  ghost inherits the task-16 contrast policy (≥ 4.5:1 on scorch, hue-opposite
  ember orange) instead of minting a new blue.

## Compatibility (selection, waypoints, damage, husks)

- Selection (task 43 no-tint policy): the ghost lives in its own scene group,
  never a body child, and carries `userData.noHighlight` — hull paint is
  untouched, rings/beacons/minimap dots unchanged, picking
  (`intersectObjects(units.children)`) never sees it.
- Waypoints: separate group/layer (ghost render order 14 > trail 9–11), no
  shared state.
- Damage: charring traverses body children only; the ghost keeps its blue
  under full char.
- Husks: wreck state never gates the signal — destroyed-but-present
  (smouldering/sinking) husks ghost like live hulls; only fully-decayed
  (`isHuskGoneAt`) bodies hide, since there is nothing left to outline.
- Combat shares the stands: `TerrainCanvas` hoisted the inline
  `treeStands` closure into `liveStands()`, reused by `CombatFx`
  interception and the x-ray, so view-blocking wood and round-blocking wood
  can never disagree.

## Nanolathe inspiration

None — headless/replay tooling, no occluded-unit visuals to borrow. The
volumes are local (core canopy model + footprint table).

## Files

- `apps/web/src/renderer/occlusionFx.ts` — sampling math + `OcclusionFx`.
- `apps/web/src/renderer/occlusionFx.test.ts` — 12 tests (terrain block /
  clear / no-self-occlusion, partial-cover ghosting, live-crown vs felled
  wood, off-line trees ignored, footprint sizing, ghost-on-exactly-while-
  occluded, wreck/gone-husk policy, blue/layering/off-hull placement).
- `apps/web/src/renderer/TerrainCanvas.tsx` — `liveStands()` hoist,
  `OcclusionFx` construct/update/dispose.
- `docs/architecture.md` — `occlusionFx.ts` key-file row.
- `.changeset/occlusion-xray.md` (patch).

## Test evidence

- `yarn test` — all pass (occlusionFx 12 tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — single-file bundle builds (renderer touched).
- Playwright not run (per task rules).
