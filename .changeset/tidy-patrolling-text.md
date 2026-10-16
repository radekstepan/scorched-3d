---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Remove the "Patrolling TA roster" status sentence from the Units panel footer; roster rows, selection, and minimap dots unchanged.

## Task writeup (moved from docs/tasks/57-remove-patrolling-text.md)

# Task 57 — Remove Patrolling TA status text

Drop the "Patrolling TA roster, re-routed on every regen." sentence from
the Units panel footer in `apps/web/src/App.tsx`. The per-kind roster rows
(kind color + name + `unitName ×count`), the scorch/selection/waypoints
 explainer, the selection hint, the selection ring wiring, and the live
minimap dots are untouched.

## What changed

- `apps/web/src/App.tsx`: Units footer paragraph now opens with
  "Dark-brown patches are blast scorch …" — the patrol-status sentence is
  gone, nothing else in the panel moved.
- `apps/web/src/App.layout.test.ts`: new "Units panel roster without
  patrol status text" block — asserts no `Patrolling` /
  `re-routed on every regen` remains in `App.tsx` source, and pins the
  surviving roster wiring (`UNIT_KINDS.map`, `def.unitName`,
  `liveUnits.map`, `selected.includes`, `MINIMAP_SELECTED_OUTLINE`).

## Important decisions

- **Sentence, not paragraph.** The footer also carries the scorch,
  selection-ring, waypoint-legend, and click/shift/right-click hints, so
  deleting the whole `<p>` would lose live help. Only the first sentence
  was removed.
- **Source-level test.** `App.tsx` needs DOM/React to render, and the repo
  convention (tasks 33, 39) pins such layout copy from source in node
  vitest — no new harness needed.
- **Patch bump.** Copy-only HUD trim; both workspaces ride the fixed-group
  patch per `docs/development.md` Versioning.
