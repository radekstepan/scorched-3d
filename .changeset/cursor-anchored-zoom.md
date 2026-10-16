---
"@scorched-3d/web": patch
---

Scroll-wheel (and pinch) zoom now anchors onto the ground point under the cursor instead of the screen center, so zooming leans into the spot being looked at. Min/max distance, zoom speed, and pan clamps unchanged.

## Task writeup (moved from docs/tasks/51-cursor-anchored-zoom.md)

# Task 51 — Cursor-anchored zoom

Scrolling the wheel used to dolly toward the screen center no matter where
the cursor was: the ground point under the cursor slid away every tick, so
zooming onto a specific spot meant pan, zoom, pan again. The wheel now zooms
onto the area under the cursor — the ground point under the pointer stays
pixel-pinned while the view leans into it.

## What changed

- `TerrainCanvas.tsx`: enabled OrbitControls' built-in `zoomToCursor` mode
  (one flag). The camera dollies along the cursor ray and the orbit target
  migrates with it, so the anchor holds by construction — for wheel and
  two-finger pinch alike, since both share the same code path. Min/max
  distance, zoomSpeed, and the polar clamp all still apply untouched.
- `TerrainCanvas.tsx` tick: the orbit target is now re-clamped to the map
  (`clampPanTarget`) *after* `controls.update()`, since cursor-anchored
  zoom migrates the target toward the cursor (keyboard pan still clamps
  before the update, as before).
- `cameraZoom.test.ts` (new): headless behavioral suite driving a real
  OrbitControls instance through its actual `wheel` listener (stub DOM
  element, no WebGL — the control's matrix math is pure JS), plus
  source-level wiring pins in the `App.controls.test.ts` style.

## Important decisions

- **Built-in mode over a custom dolly.** The task background suggested a
  hand-rolled `anchoredZoom` helper; three r186 already ships exactly that
  math (dolly along the cursor ray, re-seat the target), battle-tested
  including pinch-center anchoring and min/max clamps. A custom wheel
  handler would have to suppress OrbitControls' own listener and re-solve
  pinch — more code, more drift risk, for no gain.
- **`screenSpacePanning` left at its default (true).** I prototyped
  ground-plane panning (`false`): it keeps the target's height fixed, but
  at shallow view angles three falls back to a look-at-target branch that
  pins far worse than stock (~300 units/tick of anchor drift vs ~44
  center-zoomed, vs exactly 0 with the default). It also would have changed
  right-drag pan feel — out of scope. So panning is untouched.
- **Exact pin, modest pivot travel.** Measured on an opening-frame-like
  pose: without anchoring, one wheel tick slides the cursor's ground point
  ~44 units (410 over ten ticks); with it, drift is exactly 0.000 across
  ten ticks, in or out. The orbit target migrates toward the cursor each
  tick but converges gradually — the guarantee that matters (the pinned
  pixel) is exact.
- **Known nuance: pivot height.** Like right-drag panning before it, the
  migrated target can gain height over many consecutive zoom-ins (screen
  space re-seating), so the orbit pivot can float above the terrain after
  extreme zoom marathons; zooming back out reverses it. Left as-is: clamping
  target height per tick would fight the zoom with a visible tilt, and the
  effect is negligible in normal use.
- **No simulation impact.** Camera pose only; drive, pathing, combat, and
  damage never see it. Keyboard pan, commander-camera start pose,
  exaggeration re-snapping, and the pan/zoom speed sliders are untouched.

## Verification

- `yarn test` — new `cameraZoom.test.ts` (pin exact on zoom-in/out and
  across ten ticks, target migrates toward the cursor, old center-zoom
  drift documented as contrast, min/max distance clamps hold with finite
  pose at both extremes, sky-pointing cursor stays finite and clamped,
  canvas wiring pins for `zoomToCursor`, distance clamps, zoomSpeed, and
  the post-update `clampPanTarget`).
- `yarn typecheck`, `yarn build`.
- Playwright not run (per task rules).
