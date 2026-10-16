---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Opening view now matches the minimap orientation: the start camera always sits due south of its target looking north, so minimap-right pans the main view right.

## Task writeup (task 139)

# Task 139 — Start view matches the minimap

The minimap maps u left→right to world −X→+X and v top→bottom to world
−Z→+Z (north-up). But the start camera sat on the ray from the map center
through the commander, so its yaw depended on which side the commander
spawned on: a northern commander opened with a north-looking camera whose
screen-right was world −X (minimap-left), and an eastern commander opened
with screen-right on world −Z (minimap-up). Moving right on the minimap
therefore panned the main view in an unpredictable direction on most maps.

## What changed

- Renderer (`apps/web/src/renderer/cameraStart.ts`):
  `commanderCameraPose()` now places the camera due south of the start
  anchor — same X as the commander, Z past the south map edge — instead of
  on the center-through-unit ray. The orbit target is unchanged (commander
  ground anchor, else map center), so the opening frame still looks through
  the commander toward the interior, but with a fixed due-north yaw:
  screen-right is world +X and away-from-viewer is world −Z, matching the
  minimap. The dead-center special case and ray/exit math are gone (the
  south placement covers them uniformly); header and function docs updated.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): opening-frame comment
  updated to the fixed south-behind yaw (no logic change — it already
  consumes `commanderCameraPose`).
- Tests (`apps/web/src/renderer/cameraStart.test.ts`): new "start view
  matches the minimap" block — 10 vitest cases pinning, for commanders
  spawned north/south/east/west/corner, that the camera sits due south of
  the anchor past the south edge and that screen-right
  (normalize(forward × up)) is exactly world +X. The two tests encoding the
  old center-ray geometry (collinearity, commander-between-camera-and-center)
  were rewritten to the new contract: due-south placement outside the south
  edge, due-north view direction.
- `.changeset/minimap-aligned-start-view.md` (new) — **patch** for core +
  web (view-only behavior fix).

## Important decisions

- **Fixed the camera side, not the minimap.** The minimap is standard
  north-up and its click/dot mapping is pinned by many tests; the
  inconsistent side was the spawn-dependent start yaw, so the start yaw is
  what changed.
- **Kept the commander as the orbit target.** The alternative — a fixed
  south overview of the map center — would have discarded the commander
  framing from task 2. Targeting the anchor with a due-south camera keeps
  both: the commander stays centered and the yaw always matches the minimap.
- **No README change.** Small view-framing fix like the commander-camera
  follow-ups before it; the minimap/start behavior needs no new docs.

## Verification

- New tests observed failing before the fix (10 failed), passing after.
- `yarn test` — all pass (574 core + 649 web, 10 new).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — 2 tasks successful.
- Playwright not run (per task rules).
