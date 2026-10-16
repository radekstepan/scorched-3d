---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Show a live FPS readout over the map: the render loop feeds a lightweight framework-free sampler that refreshes a small bottom-right overlay twice per second.

## Task writeup (moved from docs/tasks/06-fps-overlay.md)

# Task 3 — FPS overlay

## What changed

The map now shows a live **FPS readout** in a small pill at the bottom-right
of the viewport, fed by the real `requestAnimationFrame` render loop.

- `apps/web/src/renderer/fps.ts` (new) — framework-free sampler:
  `createFpsSampler()` (one timestamp in per frame, rounded FPS out once per
  `FPS_REPORT_INTERVAL_MS = 500`), `fpsFromSamples()` (pure
  frames/elapsed-to-FPS conversion, 0 on degenerate windows),
  `formatFps()` (overlay label).
- `apps/web/src/renderer/fps.test.ts` (new) — 12 vitest cases.
- `apps/web/src/renderer/TerrainCanvas.tsx` — `tick()` feeds the sampler
  with `performance.now()` and writes each report straight into an overlay
  div via `textContent`, so React state never churns at frame rate; the
  overlay is `pointer-events-none` with `-- FPS` as its pre-first-report
  placeholder.
- `.changeset/fps-overlay.md` (new) — patch changeset for core + web.

## Decisions

Direct DOM write, not React state: reporting through `useState` would
re-render the whole canvas subtree twice a second and risk interfering with
the effect-owned three.js scene. The overlay div lives inside the canvas
wrapper (which the effect otherwise leaves alone — cleanup only removes the
renderer element), styled like the existing footer pill
(`bg-black/40`, mono, `tabular-nums` so the digits don't jitter).

Fixed 500ms report window (2×/sec) instead of an EMA: it matches the task's
throttle guidance, smooths one-off hitches without hiding sustained drops,
and keeps the sampler to two numbers of state. `performance.now()` is the
clock (not the three.js `Clock`) so FPS measures actual presented frames
including pan/exaggeration work, independent of the `dt` clamp. Backward
clock jumps restart the window and non-finite timestamps are ignored, so a
glitch can never divide by zero or pin the readout.

Bottom-right placement keeps it clear of the header stats (top-right),
controls/probe/units column (right), world/minimap column (left), and the
centered footer hint. No OrbitControls, pan, or commander start-pose code
was touched.

README untouched: the readout is self-evident and needs no documented
workflow.

## Verification

- `yarn test` — all pass (12 new fps tests + 14 camera-start + 17
  camera-pan + 28 pre-existing core tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
