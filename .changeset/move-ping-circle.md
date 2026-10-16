---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Share the unit selection circle rendering with move-order pings so destination circles never clip into hilly terrain.

## Task writeup (moved from docs/tasks/70-move-ping-circle.md)

# Task 70 — Move-destination circle shares the unit ring logic

Right-click move orders dropped a plain depth-tested ring at
`groundY + 1.5`. On hilly terrain the far side dipped under the mesh and
the destination circle read as "cut off", while the ring around the unit
itself always drew whole (selection halo + core composite with
`depthTest: false` above the terrain/scorch layers).

## Decisions

- New single code path `apps/web/src/renderer/movePing.ts`: ping geometry
  (`RingGeometry(10, 13, 40)`, flat on XZ), material (cyan
  `SELECTION_CORE`, transparent, `depthTest: false`, `depthWrite: false`),
  and mesh (`renderOrder = SELECTION_RENDER_ORDER`, `userData.noHighlight`)
  share the selection compositing policy by importing
  `SELECTION_CORE` / `SELECTION_RENDER_ORDER` from `selectionFx.ts`.
  Pure helpers `movePingScale(k)` / `movePingOpacity(k)` pin the 0.8 s
  expand-and-fade envelope (`MOVE_PING_DURATION`, `MOVE_PING_MAX`).
- `TerrainCanvas.tsx` now builds pings via `buildMovePingGeometry()` /
  `buildMovePing()` and drives decay via the pure helpers; the inline
  `RingGeometry` + depth-tested `pingBase` material is gone. No change to
  waypoint overlay markers (a separate diamond system, not the reported
  circle).
- No README change: renderer-internal layering fix, no architecture or
  user-facing control change.

## Files

- `apps/web/src/renderer/movePing.ts` — new shared ping builder + policy.
- `apps/web/src/renderer/movePing.test.ts` — color/render-order band,
  depth-ignored compositing parity with selection, flat ground-hugging
  mesh, expand/fade envelope.
- `apps/web/src/renderer/TerrainCanvas.tsx` — pings via `movePing.ts`.
- `.changeset/move-ping-circle.md` (patch), `docs/tasks/70-*.md` (this writeup).

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — core pass; web 30 files / 368 tests pass (364 before + 4 new).
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
