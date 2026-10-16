---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

HQ exit lanes stay natural: the cleared corridor outside each factory works is no longer painted as a brown dirt swath — it keeps its natural ground tiles and is simply cleared of trees, rocks, and other features. The construction pad under the works itself is still leveled and dirt-seated, so the fort reads grounded while the road out reads as open ground.

## Task writeup

# Task 142 — Exit road: cleared, not brown

Reported: the "road" outside the HQ doesn't need to be all brown — it
should just be devoid of trees. Task 123 had painted every tile touched
by the pad *or* the 20-cell exit road with a dirt variant, so each works
trailed a brown swath toward the map center.

## What changed

- `packages/core/src/terrain/generate.ts`: `paintHqRoads` becomes
  `paintHqPads` — only construction-pad tiles get the deterministic dirt
  variant now; exit-lane tiles keep their base classification on the
  terrain and the minimap. `clearHqLanes` is untouched, so lanes are
  still emptied of every feature word. `classifyTile` is exported for
  tests (same precedent as `hqCellSlope`).
- `packages/core/src/units/hq.ts`: `HQ_ROAD_EXTRA` / `hqRoadCells` docs
  updated — the lane is cleared-only, never painted.
- `apps/web/src/renderer/TerrainCanvas.tsx`: two comments updated
  (leveled + dirt-seated pads, cleared exit lanes).
- `README.md`, `docs/architecture.md`: one-word accuracy fixes
  ("cleared (unpainted) exit lane").

## Decisions

- Pad stays dirt, road goes natural: the dirt under the fort is what
  seats the structure (cut-and-fill grounding); only the *corridor
  outside* the HQ was reported as wrongly brown, so only its repaint
  was removed. Lane geometry, clearing, staging, and movement are
  unchanged — units still walk the same open lane.
- No new tile kind or blend: the lane simply keeps `classifyTile`
  output, so it matches surrounding ground of the same height/slope.

## Tests

- Core `hq.test.ts`: the 6-preset x 3-seed sweep is rewritten to pin
  the split — pad tiles assert `dirt`, every road-only tile asserts its
  exact natural `classifyTile` kind (tiles shared with the pad expect
  dirt, since pad paint wins the overlap). Failed before the fix
  (authentic red: lane tile `dirt` vs natural `grass`), passes after.
  Lane-clearing, pad-leveling, and hall-clear assertions unchanged.

## Verification

- Focused `hq.test.ts`: 28/28 pass.
- `yarn test` — 574 core + 651 web, all pass.
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — 2 tasks successful.
- Playwright not run (per task rules; unit/integration only).
