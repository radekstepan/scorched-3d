# Task 98 — Dead units stay off the minimap

Wrecked hulls kept a dimmed grey dot (`#57534e`, 0.55 opacity) on the
minimap after death. The 3D side already drops every dead-hull signal at
the kill transition — team rings (task 94), health bars, occlusion ghosts
(task 80) — so the lingering grey dot was the odd one out. The spec is
explicit: do not show dead units on the minimap.

## What changed

- `apps/web/src/App.tsx` — the live-unit overlay returns `null` for
  `p.alive === false` slots before rendering any dot (both teams; the
  `alive` flag already broadcasts at ~4 Hz from the canvas tick). Live
  dots keep kind color, team outline, and selection glow at a fixed 5px;
  all `wrecked`-branch styling is gone. HQ fort squares are untouched
  (grey-when-destroyed still marks dead forts).
- `apps/web/src/utils/liveCounts.ts` — new `isLiveMinimapDot` helper
  pinning the policy (`alive === false` hides; missing pre-broadcast
  slots read live so dots show on load).
- `apps/web/src/renderer/TerrainCanvas.tsx`, `combatFx.ts`,
  `combatFx.test.ts` — stale "dim the minimap dot" comments updated to
  "drop the minimap dot" (no behavior change; the broadcast still ships
  `alive: false` so counts and the overlay filter on it).
- `README.md` — minimap outlines now described as live-hulls-only.
- `.changeset/dead-units-off-minimap.md` (patch, web only).

## Files

- `apps/web/src/App.tsx` — filter dead slots from the minimap overlay.
- `apps/web/src/utils/liveCounts.ts` — `isLiveMinimapDot` helper.
- `apps/web/src/App.dead-minimap.test.ts` — overlay block returns null
  for dead slots, carries no wreck-grey styling, keeps live identity.
- `apps/web/src/utils/liveCounts.test.ts` — helper hides wrecks, keeps
  live and pre-broadcast slots.
- `apps/web/src/renderer/TerrainCanvas.tsx`, `combatFx.ts`,
  `combatFx.test.ts` — comment-only.
- `README.md`, `.changeset/dead-units-off-minimap.md` (this writeup:
  `docs/tasks/98-dead-minimap.md`).

## Test evidence

- Targeted: `liveCounts` + `App.dead-minimap` + `App.layout` +
  `App.minimap` — 4 files, 23 tests pass.
- `yarn test` — web 448/449 pass; the single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire",
  `shotCount` 1 vs 0) is pre-existing, verified failing on unmodified
  main via `git stash` and untouched by this change (same failure
  documented in task 94).
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).
