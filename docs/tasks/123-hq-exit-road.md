# 123 — HQ exit road: leveled pad, cleared lane, visible dirt road

Task: the "road" out of the HQ was obstructed by trees, and sometimes the HQ
sat "too deep" in the tiles so the road didn't show. Each works now gets a
leveled construction pad, a cleared lane out, and a painted dirt road.

## What changed

- `packages/core/src/units/hq.ts`: new lane geometry + ground works.
  `hqPadCells` (slab + hall corridor: 4 cells rear, 3 each side, hall + 1
  front) and `hqRoadCells` (20 cells past the hall mouth, 2 each side, out
  to the reinforcement staging point), both toward the map center per team
  and clamped to the grid. `levelHqPads` cut-and-fills each pad to its
  anchor height in place; `clearHqLanes` empties pad + road cells of every
  feature word (trees, rocks, metal, fringe). New constants
  `HQ_PAD_REAR/HALF_WIDTH/FRONT_EXTRA`, `HQ_ROAD_EXTRA/HALF_WIDTH`, and the
  `HqGroundField` view (siting field plus live features).
- `packages/core/src/terrain/generate.ts`: after feature stamping, the map
  sites its forts, levels the pads, and clears the lanes (before tile
  classification so pads read flat); after classification it paints every
  tile touched by a pad or road with a deterministic dirt variant, so the
  lane reads as a road on the terrain and the minimap.
- `packages/core/src/terrain/types.ts`: `TNTMap` ships `hqs: HqSite[]` —
  the forts the ground works were built for.
- `apps/web/src/renderer/TerrainCanvas.tsx`: builds forts on `map.hqs`,
  falling back to `placeHqs(map, map.seed)` only for synthetic maps.
- `README.md`, `docs/architecture.md`: one-line HQ wording updates.

## Decisions

- Cut-and-fill instead of raising the works: seating the group at the max
  footprint height would put sloped forts on tall concrete pedestals;
  leveling the pad keeps the anchor (siting guards still hold: the anchor
  cell is untouched, the corridor stays dry) while the hall floor sits on
  flat ground at every exaggeration. The road past the mouth is NOT
  leveled — it follows the terrain, only cleared and painted.
- The map stores its own forts instead of re-siting in the renderer:
  re-siting on leveled ground can drift a few rows (leveled neighbours
  score better), so the renderer would build on different cells than the
  pads were cut for. `map.hqs` keeps one siting; the old call stays as a
  fallback for synthetic-map tests.
- Dirt paint reuses the existing `dirt` ramp with the same per-tile
  variant hash as classification, so roads match the surrounding ground
  style instead of introducing a new tile kind.

## Tests

- Core `hq.test.ts`: pad/road geometry per team (extents, full rectangles,
  east mirroring), grid clamping, pad leveling on a grade (pad flat at the
  anchor, far cells untouched, idempotent), lane clearing of every feature
  word (woods outside stand), and a 6-preset × 3-seed sweep asserting the
  shipped forts sit on level pads with empty lanes, dirt road tiles, and
  intact hall-clear guards. The existing siting sweep now validates
  `map.hqs` (the actual forts) instead of a fresh re-siting.
- Core `generate.test.ts`: determinism now covers `hqs` too.
- Web `App.layout.test.ts`: pins the `map.hqs ?? placeHqs(map, map.seed)`
  wiring; `texture.test.ts` fixture gains the new `hqs` field.
- Full `yarn test` (core 515, web 571), `yarn typecheck`, `yarn build`
  all green. Playwright not run (per task rules).
