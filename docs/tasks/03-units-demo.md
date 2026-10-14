# Task 3 — Static demo units

## What changed

Every map regen (preset switch or REGEN seed button) now places **6 static units**
on the terrain, rendered as low-poly Three.js meshes with a HUD legend and
minimap markers.

- `packages/core/src/units/types.ts` (new) — `UnitKind`, `UNIT_DEFS`, `PlacedUnit`.
- `packages/core/src/units/place.ts` (new) — seeded `placeUnits()` + `unitAnchor()`.
- `packages/core/src/units/place.test.ts` (new) — 9 vitest cases.
- `packages/core/src/terrain/types.ts` — `TNTMap` gains a `units: PlacedUnit[]` field.
- `packages/core/src/terrain/generate.ts` — `generateMap()` fills `units` via
  `placeUnits()`, so regen picks up units with zero App wiring.
- `packages/core/src/index.ts` — barrel-exports the units module.
- `apps/web/src/renderer/units.ts` (new) — `buildUnits()` / `placeUnitsGroup()`.
- `apps/web/src/renderer/TerrainCanvas.tsx` — adds the units group to the scene,
  re-snaps it on exaggeration change, disposes it on unmount.
- `apps/web/src/App.tsx` — Units legend panel (color dot, name, catalog id,
  per-kind count) and unit markers painted onto the minimap.

## Which nanolathe units, and why

Nanolathe is a clean-room Total Annihilation engine; its unit catalog is TA's.
I confirmed the retail ids (`ARMCOM`, `ARMSTUMP`, `ARMFLASH`, `ARMHAM`, …) in
`internal/units` and `internal/content` tests, then chose four ARM units that
cover the recognizable archetypes with distinct silhouettes:

| Demo kind | Catalog id | Archetype | Read |
| --- | --- | --- | --- |
| Commander | `ARMCOM` | construction kbot | tallest mesh: legs, torso, head, antenna; blue + yellow trim |
| Stumpy | `ARMSTUMP` | medium tank | wide olive hull + turret + single barrel |
| Flash | `ARMFLASH` | light scout tank | smallest hull, red trim |
| Hammer | `ARMHAM` | artillery | dark hull, long orange barrel elevated ~40° |

All-ARM keeps the palette coherent; each `UnitDef` keeps its `unitName` so the
choice stays traceable to nanolathe's `content.UnitDef` records. Units are
static by design (task scope): no movement, selection, or combat.

## Placement algorithm

`placeUnits(field, seed, count)` uses the existing `mulberry32` RNG (stream
`seed ^ 0x9e37`, separate from terrain/feature streams so unit placement never
perturbs the heightfield). The roster shuffles the four kinds into the first
four slots and fills the rest at random, so all four silhouettes always appear.
Each drop tries, in order:

1. **Strict** (220 attempts): 8-cell edge margin, height > sea + 4, slope ≤ 12,
   empty feature cell, ≥ 18 cells from other units.
2. **Relaxed** (220 attempts): slope ≤ 24, separation ≥ 10.
3. **Fallback**: best of 300 samples by `height − 2 × slope (+1000 if empty)`,
   so the roster is never short.

`unitAnchor(field, unit, exaggeration)` maps a cell to world space with the
same convention as the terrain mesh (Y-up, +Z south, 16 world units per cell)
and snaps Y to `height × exaggeration`, keeping units glued to the surface
when the height-scale slider moves.

## Rendering approach

`apps/web/src/renderer/units.ts` builds one `THREE.Group` per unit from
`BoxGeometry`/`CylinderGeometry` parts with `MeshLambertMaterial` (the scene
already lights Lambert via hemisphere + directional). Hull lengths (~18–26
world units) read as roughly a 2-cell footprint against the 16-unit grid.
`TerrainCanvas` treats units like the tree/rock layers: rebuilt per map,
repositioned via `placeUnitsGroup()` on exaggeration change, disposed on
unmount. Units stay visible when the Features toggle is off (they are gameplay
pieces, not terrain dressing).

## Verification

- `yarn build` — turborepo build succeeds (core `tsc -b`, web single-file bundle).
- `yarn typecheck` — 3 tasks successful.
- `yarn test` — 28/28 pass (19 pre-existing + 9 new unit tests covering
  determinism, full-kind roster, custom counts, dry/gentle/unoccupied/in-bounds
  placement across all 4 presets × 4 seeds, pairwise separation, per-seed
  variation, terrain-snapping above the waterline, and regen re-placement).
- Bundle grep confirms the units code ships in `apps/web/dist/index.html`.
- Playwright not run (per task rules). No interactive dev smoke; geometry is
  primitive-based and positions are unit-tested via `unitAnchor`.
