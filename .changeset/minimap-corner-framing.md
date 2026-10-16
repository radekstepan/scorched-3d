---
"@scorched-3d/web": patch
---

Fix minimap clicks landing the clicked item in the bottom-right corner instead of the screen center: the WebGL canvas kept its pixel-ratio backing store as its CSS box (2x the viewport on retina), overflowed its wrapper, and the app root clipped it to the top-left quadrant — so the correctly centered orbit target rendered at the visible corner. The renderer now styles the canvas to the viewport size, so the full frame is visible and clicked items land in the middle of the screen on every display.

## Task writeup (moved from docs/tasks/121-minimap-corner-framing.md)

# Task 121 — Minimap clicks center: the canvas was 2x its viewport (HiDPI style fix)

## Symptom

Clicking the minimap transported the view to the right area, but the
clicked item rendered in the bottom-right corner of the screen instead of
the center. Five prior tasks (83/97/102/112/120) had verified the jump
pipeline — `minimapPointToWorld` → sequenced jump → offset-preserving,
terrain-seated `jumpCameraTo` → jump exemption from the camera clamp —
with headless NDC tests through real `OrbitControls`, yet the bug
persisted in the browser.

## Root cause

`renderer.setSize(w, h, false)` in `TerrainCanvas.tsx` (`updateStyle =
false`, dating to the monorepo migration). With styling disabled, three.js
sizes only the backing store (`w·pixelRatio × h·pixelRatio`) and leaves
the canvas `style` untouched — and nothing in CSS constrains the canvas
(Tailwind preflight sets `display: block` only; its `max-width: 100%`
rule covers `img`/`video`, not `canvas`). So on a `devicePixelRatio = 2`
display the canvas CSS box is 2x its `absolute inset-0` wrap, overflows
it, and the App root (`h-screen w-screen overflow-hidden`) clips it to
the top-left quadrant. The orbit target sits exactly at NDC (0,0) — the
jump math was always right — which is the canvas center, i.e. the
bottom-right corner of the visible quadrant. Visible fraction is `1/pr`
per axis, so any HiDPI display mis-centers and dpr=2 lands exactly on the
corner; dpr=1 is unaffected, which is why the failure reads as
"centering is broken" rather than "the frame is cropped".

Verified end to end before fixing: a scratch simulation (since removed)
drove the REAL map, start pose, `groundY`, canvas settings, and tick
order (`jump → controls.update() → target clamp → conditional camera
clamp`) and projected a far unit to NDC ≈ 0 — the pipeline centers
exactly, so only the DOM box could break it. Also read the installed
`OrbitControls` (r186) to rule out `zoomToCursor`/damping re-aiming the
jumped camera on idle ticks (it always ends aimed at the target; cursor
zoom only acts on wheel frames).

## What changed

- `renderer/TerrainCanvas.tsx`: `resize()` now calls `renderer.setSize(w,
  h)` (the `updateStyle` default), so the canvas CSS box tracks the wrap
  while the backing store stays HiDPI — the full frame is visible and NDC
  center is the viewport center. Comment at the call site records the
  mechanism so `false` is never re-added for "perf".
- Tests (`App.minimap.test.ts`, task-121 block): source-level pins — no
  `setSize(w, h, false)` on the main canvas + `renderer.setSize(w, h)`
  present, and the wrap/root clipping pair (`absolute inset-0`,
  `overflow-hidden`) that makes the canvas box load-bearing. Like the
  task-112 img-box pin: a DOM-box failure is untestable headless, so it
  is pinned at source level.
- Changeset: `.changeset/minimap-corner-framing.md` (patch).

## Important decisions

- **One-line production fix, no math touched.** The jump math,
  exemption flag, and both clamp sites are proven correct and unchanged;
  this task fixes only the frame the math renders into.
- **`selectionIcons.ts` keeps `updateStyle = false`.** That renderer is
  offscreen (never appended to the DOM; pixels leave via data URL), so
  styling its canvas would be dead work — checked, deliberately untouched.
- **No README change.** View-framing fix, no architectural change.
- **Pick/hover/zoom-to-cursor need no changes.** They already measure
  against the canvas rect, which now equals the displayed box (previously
  consistent with the buffer while the display was cropped); they stay
  correct over the full frame.

## Verification

- Touched: `App.minimap.test.ts` + `renderer/minimap.test.ts` — 45/45 pass.
- Full web `yarn test`: 571 pass, 0 failures.
- `yarn typecheck` — clean.
- Playwright not run (per task rules); the mechanism (canvas intrinsic
  size = attribute size without style, root `overflow-hidden` quadrant
  crop) follows directly from the box model, and the math half is
  integration-proven to NDC ≈ 0 with real map data.
