---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Show exactly one ground circle per unit: selection thickens and brightens the unit's own team ring instead of stacking a second selection ring on top of it.

## Task writeup (moved from docs/tasks/71-single-selection-circle.md)

# Task 71 — Single selection circle (thicker on select, never double)

Selecting a unit stacked its always-on team ring (radius ~26) under the
selection marker's white-halo + cyan-core ground rings (radii ~14–22), so
the eye read two/three concentric circles. Per the task, selection now
thickens the one existing circle instead of adding another.

## Decisions

- The team ring (`apps/web/src/renderer/units.ts`) is the unit's ONE
  ground circle. New `TEAM_RING_INNER_SELECTED = 22` widens the band
  inward on selection (2 → 5 units wide, outer edge fixed at 27) via a new
  `teamRingGeometry(selected)` helper; `setTeamRingSelected` swaps the mesh
  geometry + raises opacity to 0.9, keeping team color. Selection toggles
  are rare, so per-toggle geometry allocation is fine and keeps per-mesh
  `dispose()` safe (no shared-geometry lifetime to manage).
- Removed the old selected-state scale swell (`TEAM_RING_SCALE_SELECTED` /
  `teamRingScale`, 1.1x): enlarging the radius is a different emphasis
  from thickening, and the task asks for thicker only. Scale resets to 1.
- `selectionFx.ts` no longer builds ground rings at all:
  `buildSelectionMarker` returns the chevron beacon only (still shared
  geometry/material, still depth-test-off above the scorch layer, still
  static). `SELECTION_OUTER` / `SELECTION_CORE` stay exported — the pure
  contrast math tests still pin them, and `movePing.ts` + occlusion still
  import `SELECTION_CORE`.
- `TerrainCanvas.tsx` selection flow is unchanged (still
  `updateSelectionMarker` + `setTeamRingSelected` per body); only comments
  updated. Move-ping compositing untouched, comment reworded off the
  retired "halo + core" language.
- No README change: renderer-internal visual fix, no architecture or
  user-facing control change.

## Files

- `apps/web/src/renderer/units.ts` — thickening team-ring geometry +
  selection swap, scale-swell removal.
- `apps/web/src/renderer/selectionFx.ts` — beacon-only marker, trimmed
  shared assets.
- `apps/web/src/renderer/TerrainCanvas.tsx`, `movePing.ts` — comment
  updates only.
- `apps/web/src/renderer/units.test.ts` — thickness/opacity/single-circle
  assertions, incl. a new integration test: selected body shows exactly
  one `team-ring` and a beacon-only marker.
- `apps/web/src/renderer/selectionFx.test.ts`, `movePing.test.ts` —
  beacon-only marker expectations (chevron compositing parity for pings).
- `.changeset/single-selection-circle.md` (patch), `docs/tasks/71-*` (this writeup).

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — core 21 files / 406 tests pass; web 30 files / 369 tests pass.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
