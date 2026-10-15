# Task — Pan and zoom speed sliders in the View menu

Camera speed was fixed: keyboard panning ran at `PAN_SPEED_FACTOR`
(1.2 × distance/s) and OrbitControls panning/zooming at stock speed,
with no way to slow down for precise inspection or speed up for
cross-map travel. The View panel gains `Pan speed` and `Zoom speed`
sliders (0.2×–3×, default 1×) that scale all three inputs.

## What changed

- Core (`packages/core/src/terrain/types.ts`): `ViewOptions` gains
  `panSpeed: number` and `zoomSpeed: number` (view-only multipliers,
  1 = default feel, no sim logic).
- App (`apps/web/src/App.tsx`): defaults `panSpeed: 1, zoomSpeed: 1`
  plus `Pan speed` / `Zoom speed` sliders in the View panel next to
  `Height scale` (same `Slider`, 0.2 min / 3 max / 0.1 step).
- Renderer (`apps/web/src/renderer/cameraPan.ts`): new
  `DEFAULT_PAN_SPEED` / `DEFAULT_ZOOM_SPEED` (1),
  `PAN_SPEED_MIN/MAX` / `ZOOM_SPEED_MIN/MAX` (0.2/3),
  `clampPanSpeed` / `clampZoomSpeed` (clamp + 1× fallback on
  non-finite input), and `panStepDistance(distance, dt, speed)`
  (`distance × PAN_SPEED_FACTOR × clamped speed × dt`).
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): seeds
  `controls.panSpeed` / `controls.zoomSpeed` from the options at
  setup (right-drag pan and wheel zoom), re-syncs both every tick
  from the options ref (options arrive via ref, not effect re-runs),
  and routes the keyboard pan step through `panStepDistance`.
- Tests (`apps/web/src/renderer/cameraPan.test.ts` extended,
  `apps/web/src/App.controls.test.ts` new): 7 vitest cases for the
  range constants, clamp behavior incl. NaN/Infinity fallback,
  linear speed scaling, pre-step clamping, and zero distance/dt;
  3 source-level cases pinning the 1× defaults, the slider wiring in
  `App.tsx`, and the OrbitControls/keyboard feed in
  `TerrainCanvas.tsx`.
- `.changeset/camera-speed-sliders.md` (new) — **patch** for core +
  web (view-only addition).

## Important decisions

- **One multiplier drives both pan paths.** `panSpeed` scales
  keyboard panning (`panStepDistance`) and right-drag panning
  (`controls.panSpeed`) together — splitting them would double the
  UI for no clear use case, and both are "move the view" inputs.
- **Clamp at the boundary, not in the UI.** The sliders already
  bound input to 0.2–3, but the canvas clamps anyway so a stale or
  hand-edited state can never freeze (0×) or fling the camera.
- **Per-tick re-sync of OrbitControls speeds.** The canvas effect
  runs once per map; option sliders update a ref, so the tick
  re-applies `panSpeed`/`zoomSpeed` instead of requiring a canvas
  remount (which would drop camera pose and combat state).
- **No README change.** Small view-panel addition like the
  Waypoints/Health toggles, which likewise left the README alone;
  the View panel is self-documenting.

## Verification

- `yarn build` — 2 tasks successful.
- `yarn typecheck` — 3 tasks successful.
- `yarn test` — all pass (242 core + 198 web, 10 new).
- Playwright not run (per task rules).
