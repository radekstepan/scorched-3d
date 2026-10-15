# Double the size of the maps

Attribute grid goes from 160x128 to 320x256 cells (world extent 2544x2032 to
5104x4080 world units — 2x on each axis, 4x the area). New `MAP_WIDTH` /
`MAP_HEIGHT` exports in `packages/core/src/terrain/generate.ts` replace the
inline literals; `generate.test.ts` asserts the new grid plus an explicit
world-extent test (5104 x 4080).

## Decisions

- **Same feature scale per world unit, more terrain — not a stretched map.**
  All noise sampling uses absolute cell coords (`x * 0.018`, …) while masks
  use normalized coords, so leaving frequencies untouched keeps hills,
  slopes, climb gates, and tile classification identical per world unit and
  simply extends coverage. Stretching (halving frequencies) would have halved
  every slope and changed what hulls can climb.
- **Weapon ranges unchanged.** `WEAPON_MAX_RANGE` caps (850–1000) already sat
  under half the old width; on the doubled map they sit well under half, so
  the HQ doctrine (forts only take aimed fire on deep push-ins) holds without
  touching ballistics. Comment in `combat.ts` updated to the new width.
- **Unit count unchanged (6).** Placement, HQ siting, and pathfinding all pass
  on the bigger grid untouched; a larger roster is a separate balance call.
- **Renderer rescaled, not reworked.** Orbit `maxDistance` 4200 → 8400
  (guarded by a new canvas-source test), fog 1800/6200 → 3600/12400, water
  plane tessellation 96x72 → 192x144, start-camera height already scales off
  the larger map dimension (comment updated). Minimap stays 252x252 — it
  samples proportionally. Terrain mesh is one vert per cell (81,920 verts,
  ~163k tris), fine for a single draw call.
- **Test-window fix, not a terrain fix.** The dustplains "small pond" survey
  used fixed 8-cell insets, which on the bigger grid admitted the outer
  edge-sea band (water read 11.5% vs the 8% cap; 97% of it edge ring).
  Verified via a scratch survey: old grid read 1.5% in the same window, and
  the new-map excess is exactly the normalized band the wider window admits.
  Insets are now proportional (5% / 6.25%), restoring the same normalized
  survey window at any grid size.
- **README Maps section** notes the 320x256 grid and the range implication;
  changeset is `minor` (gameplay-scale change, no API break).
