---
"@scorched-3d/web": patch
---

Game opens at the sibling RTS camera elevation: the start view now looks down at ~41.5° (from the redesign-stumpy-tank-model "RTS" study) instead of a map-size-derived height, while keeping the due-south minimap yaw and full orbit/zoom/pan afterwards.

## Task writeup — RTS opening angle

The opening frame used a fixed eye height (`START_HEIGHT_FACTOR = 0.25` of
the larger map dimension), so its pitch varied with the commander's spawn
side (~28° for a center spawn on the standard map, near-top-down for a
south spawn). It now opens at the sibling viewer's RTS elevation on every
spawn, with orbit/zoom/pan unchanged after the first frame.

## Source values (quoted verbatim)

From `src/viewer.ts:66` in `/Users/radekstepan/dev/redesign-stumpy-tank-model`
(the "Battlefield scale / GAMEPLAY READABILITY" study):

```ts
rts: { position: [116, 165, 146], target: [0, 0, 0] },
```

Camera offset off the focus is (116, 165, 146), giving
`RTS_ELEVATION = atan(165 / hypot(116, 146)) ≈ 41.504°`. Pinned by test:
`RTS_VIEW_OFFSET` must equal `{ x: 116, y: 165, z: 146 }` and
`RTS_ELEVATION` must equal `atan2(165, hypot(116, 146))` to 12 digits.

## Decision: elevation transfers, yaw stays due south

The viewer's southeast yaw is a single-model 3/4 framing choice with no
compass meaning — there is no minimap in the viewer. The game's due-south
opening yaw is a deliberate, tested invariant (task 139: screen-right is
world +X so minimap-right pans the main view right). Adopting the yaw
would regress that fix unasked, so the opening frame keeps its yaw and
anchor (commander ground point, camera past the south edge) and gains the
RTS pitch: eye height is now `groundRun * tan(RTS_ELEVATION)`, which keeps
the angle exact on every spawn side while distance varies with the spawn
(the old code did the reverse: fixed height, varying pitch). Fov stays 48
— the viewer's fov 30 belongs to a single-tank showcase, not the game.

## What changed

- `apps/web/src/renderer/cameraStart.ts`: `START_HEIGHT_FACTOR` replaced
  by `RTS_VIEW_OFFSET` + `RTS_ELEVATION`; `commanderCameraPose` derives eye
  height from the south-edge ground run at the RTS elevation (unit and
  no-unit fallback branches alike). Target anchor, camera XZ, and yaw
  rules are untouched.
- `apps/web/src/renderer/TerrainCanvas.tsx`: opening-frame comment updated
  (no logic change — it already consumes `commanderCameraPose`).
- `apps/web/src/renderer/cameraStart.test.ts`: 8 elevation tests (source
  quote, derivation, ~41.5°, five spawn sides + center fallback) and 5
  headless tick-stability tests (real OrbitControls with canvas settings
  through the tick clamp order — 5 quiet frames hold the pose to 1e-6 for
  center/north/south/east/west spawns at the real 320x256 game size).

## Verification

- New elevation tests failed on the old pose (old center-spawn pitch ~34°
  on the test field vs 41.5°), then passed after the change.
- `cameraStart.test.ts`: 37/37 pass (24 pre-existing untouched and green,
  including the task-139 minimap-alignment block).
- Full web suite: 852/853 pass; the one failure (`deployPages.test.ts`
  branch-config assertion) fails identically on the untouched tree
  (verified via `git stash`), so it is pre-existing and unrelated.
- `typecheck` passes. No core change, so no core rebuild was needed.

## Finding (pre-existing, out of scope)

The 350-unit beyond-edge stand-off only fits inside the tick clamp
rectangle (25% margin) on maps with half-depth ≥ 1400 — the fixed 320x256
game map qualifies (margin 510), but smaller fields snap the camera on
frame one. That snap predates this change (the old pose does it too) and
is unreachable in-game since `generateMap` always builds 320x256, so the
stability tests run at game size and the small-map edge was left alone.
