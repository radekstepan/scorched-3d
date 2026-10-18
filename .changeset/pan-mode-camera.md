---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Pan-mode camera toggle: lock the viewing angle and drag to pan like the arrow keys

## Task writeup

The View panel gains a "Pan mode" toggle. While it is on, the viewing
angle locks and dragging across the page pans the screen instead of
orbiting — the same rigid ground-plane translation the arrow keys use,
with the same edge clamps. Clicks still select, shift-drag still boxes,
right-click still orders, the wheel still zooms.

## What changed

- `packages/core/src/terrain/types.ts` — new `ViewOptions.panMode`
  flag (default `false`, no behavior change until toggled).
- `apps/web/src/renderer/cameraPan.ts` — new `panModeBinding()`: the
  single source of truth for what pan mode means (three-free, like the
  rest of the module). On: `enableRotate: false` plus left-drag and
  one-finger-drag repointed at pan. Off: the stock orbit mapping.
- `apps/web/src/renderer/TerrainCanvas.tsx` — the tick translates the
  binding onto the live OrbitControls every frame (the same ref path as
  the pan/zoom speed sliders): `enableRotate`, `mouseButtons.LEFT`, and
  `touches.ONE`, all restored on toggle-off. Rotation is disabled
  outright (the lock) *and* the drag mapping is repointed (the pan), so
  no gesture can rotate even mid-toggle. Because pan-mode drags flow
  through OrbitControls' own pan path, the existing rigid-pan detection
  (`isRigidPan`) and the pan-back wall clamps treat them exactly like
  right-drags — no new clamp code.
- `apps/web/src/renderer/followBattle.ts` — `FollowHoldTracker` mirrors
  the toggle (`setPanMode`): in pan mode left-button and single-touch
  contacts hold the follow glide like right-drags do. The canvas
  excludes clicks from the resume-delay stamp, so a selection click in
  pan mode never pauses follow (the existing right-click order
  exclusion is preserved verbatim).
- `apps/web/src/App.tsx` — "Pan mode" toggle in the View panel; the HUD
  footer drag hint flips between "DRAG orbit" and "DRAG pan" with the
  toggle.

## Decisions

- Pan-mode drags reuse OrbitControls' pan path rather than a custom
  screen-to-ground projection: the pan math, damping glide, and edge
  clamps (including the pan-back wall) come for free and cannot drift
  from the right-drag behavior.
- `enableRotate = false` in addition to remapping LEFT: the mapping is
  read per gesture, so a bare remap would leave a mid-toggle orbit
  gesture rotating; the flag locks the angle unconditionally.
- No keyboard shortcut: the follow-battle toggle (the closest analog)
  is toggle-only too, and M is already mute. The footer hint keeps the
  mode discoverable.
- Nanolathe inspiration: the retail TA spec (`07-interface-input-camera-
  and-front-end.md`) runs camera motion through one host-frame writer
  with held-key queries for arrows and drag-to-pan on the minimap —
  panning is a translation of the existing view, never a re-aim. Pan
  mode follows that shape: drags translate the locked rig through the
  same path as the arrow keys.
- No README/architecture update: a View toggle, not architecture; the
  HUD footer documents the control.

## Verification

- `cameraPan.test.ts` — 86 passed (8 new): `panModeBinding` units plus
  synthetic mouse/touch drags through real OrbitControls (stub element
  with a listener registry) proving left-drag pans rigidly with the
  position→target offset preserved in pan mode, orbits with the target
  fixed when off, right-drag pans in both modes, one-finger drag pans
  in pan mode, and orbiting restores on toggle-off.
- `followBattle.test.ts` — 28 passed (5 new): left-button and
  single-touch holds in pan mode, middle-button still ignored,
  stock behavior restored on toggle-off.
- `App.panmode.test.ts` (new) — 6 passed: default off, toggle wiring,
  footer hint, tick wiring, hold mirroring, click exclusion.
- `App.followBattle.test.ts` — 11 passed, untouched (right-click
  exclusion preserved).
- Full web suite — 1095 passed, 1 failed in `deployPages.test.ts`
  (expects branch `main`, workflow uses `master`); confirmed
  pre-existing by re-running on the stashed clean base.
- `yarn typecheck` and `yarn build` — clean.
- Playwright not run (per task rules).
