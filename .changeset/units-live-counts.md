---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Trim the Units panel to live per-kind hull counts (Commander, Stumpy, Flash, Hammer); team rows, HQ rows, catalog columns, and the long explainer text are removed.

## Task writeup (moved from docs/tasks/66-units-live-counts.md)

# Task 66 — Units panel trimmed to live per-kind counts

The Units HUD panel carried team alive/roster rows, HQ standing/sent rows,
static per-kind roster counts with retail catalog columns (`ARMCOM ×n`),
and a long scorch/selection/waypoint explainer paragraph. The panel now
shows only live per-kind hull counts in roster order — Commander, Stumpy,
Flash, Hammer — driven by the ~4 Hz live broadcast so deaths drop out and
HQ reinforcements count once both arrays cover them.

## Decisions

- Live, not roster: `countLiveUnitsByKind(map.units, liveUnits)` in
  `apps/web/src/utils/liveCounts.ts` — slots with no broadcast yet read
  alive, `alive === false` wrecks are excluded, appended spawn slots count
  once covered. Rendered via `UNIT_KINDS.map` so commander … hammer order
  is pinned by the core roster, not by copy.
- Removed outright: team rows (`TEAM_IDS.map`, `alive/roster`), HQ rows
  (`HQ {def.name}`, `standing/destroyed`, `+sent`), the catalog column
  (`def.unitName`), and the whole explainer `<p>` (team rings, forts,
  scorch, waypoints, selection hints). Each row is now dot + `def.name` +
  `×{liveCounts[k]}` only.
- Stale-comment sweep: tray/minimap comments no longer reference "Units
  box chips"; `onHq` is documented as minimap-only. No README/architecture
  changes (neither names the Units panel).

## Files

- `apps/web/src/App.tsx` — Units panel replaced with live per-kind rows;
  `TEAM_IDS` import dropped, `liveCounts` memo added.
- `apps/web/src/utils/liveCounts.ts` — `countLiveUnitsByKind` +
  `liveCountsOrdered` pure helpers.
- `apps/web/src/utils/liveCounts.test.ts` — pre-broadcast all-alive,
  wreck exclusion, spawn counting, commander-first/hammer-last ordering.
- `apps/web/src/App.layout.test.ts` — "Units panel live per-kind counts":
  pins the live wiring, asserts the explainer/team/HQ/catalog snippets are
  gone, keeps minimap-dot + HQ-marker + tray + static-marker + HQ-wiring
  coverage.
- `apps/web/src/renderer/selectionIcons.ts` + test, `TerrainCanvas.tsx` —
  comment-only updates.
- `.changeset/units-live-counts.md` (patch), `docs/tasks/66-units-live-counts.md` (this writeup).

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — core 20 files / 378 tests pass; web 29 files / 356 tests pass.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
