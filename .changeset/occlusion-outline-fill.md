---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Occlusion x-ray renders the true unit silhouette (outline + slight transparent fill) instead of a box ghost

## Task writeup (moved from docs/tasks/45-occlusion-outline-fill.md)

# Task 45 — Occlusion silhouette: true outline + transparent fill replaces the box ghost

## What changed and why

Task 44's occlusion x-ray worked but drew a footprint-sized box outline —
the brief explicitly rejected the rectangle: an occluded unit should show
*its own* outline plus a slight transparent fill of the hidden part.
This task replaces the `LineSegments` box ghost with a silhouette mirror:
each ghost shares its body's geometries (hull, turret, barrel, wheels,
legs, antenna) under x-ray materials, tracks the live pose every tick,
and draws through everything (`depthTest: false`) in selection cyan above
the health-bar layer.

Design:

- Sampling math untouched (`OCCLUSION_TAPS` 6/18/30 vs live `groundY` +
  core `treesOnSegment` standing wood, any-blocked-tap ghosts so partial
  cover still reads; wrecks ghost, only fully-decayed husks hide).
- `OcclusionFx` builds one ghost `Group` per roster unit by cloning the
  body hierarchy once: each source `Mesh` becomes a fill `Mesh` (shared
  geometry, shared `MeshBasicMaterial`, opacity 0.28) plus an edge outline
  (`EdgesGeometry` per mesh, shared `LineBasicMaterial`, opacity 0.9).
  Groups/pivots (turret, barrel) recurse so turret yaw, barrel pitch,
  and wheel/leg motion mirror exactly.
- Per-tick work is transform copies only (ghost origin/quaternion + one
  entry per hierarchy node) — no geometry rebuilds, no raycaster, no
  allocations past the caller-owned stands array. Rebuilds happen only
  when the descendant count changes shape (e.g. turret loss in a future
  death task).
- Layering: fill at 14 (above health bars at 13), outline at 15, both
  `depthTest: false` + `depthWrite: false`. Ghosts stay in their own scene
  group with `userData.noHighlight` and neutered `raycast`, so hull paint
  (task 43 no-tint), damage charring, selection rings/beacons, waypoints,
  and picking never see them.
- Mesh-less bodies (plain test groups) keep a footprint-sized fill+outline
  box via the retained `ghostBoxFor` fallback — real hulls never take it.

## Nanolathe inspiration

None — same headless reasoning as task 44; volumes stay local.

## Files

- `apps/web/src/renderer/occlusionFx.ts` — silhouette mirror + pose sync,
  fill/outline materials and layering, fallback box.
- `apps/web/src/renderer/occlusionFx.test.ts` — 14 tests (kept 11, replaced
  the box-ghost assertions with: true-silhouette geometry sharing +
  fill/outline styling, turret-yaw tracking across ticks, mesh-less
  fallback sizing).
- `apps/web/src/renderer/TerrainCanvas.tsx` — x-ray comment updated.
- `docs/architecture.md` — `occlusionFx.ts` key-file row updated.
- `.changeset/occlusion-outline-fill.md` (patch).

## Test evidence

- `yarn test` — all pass (occlusionFx 14 tests, 246 total).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — single-file bundle builds (renderer touched).
- Playwright not run (per task rules).
