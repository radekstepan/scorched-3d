# Task 111 — Hover FPS dip while moving the cursor

Sweeping the cursor over the world still dipped fps 120 → ~80; stopping
recovered to 120. The parked-cursor cost was already gated away (task 101:
one raycast per motion, emit on cell change), so the remaining cost was all
on the motion path: every motion frame paid a full-mesh three.js raycast
against the 320×256 terrain (~163k triangles, no BVH), plus one
`getBoundingClientRect` forced reflow per probe, plus a React re-render per
cell change.

## What changed

- `apps/web/src/renderer/hoverProbe.ts` — new `pickTerrainPoint`: an
  analytic ray-vs-heightfield march over the same surface the mesh is built
  from (corner heights × `worldHeight` at the live exaggeration — the exact
  surface `hitToInfo` samples, minus crater dents, which the readout ignores
  anyway). The ray is slab-clipped to the map box first, so a miss pointing
  away costs zero height taps; inside the box a fixed 384-tap coarse march
  finds the first above→below crossing and 24 bisection taps refine it.
  Worst case ≈ 410 bilinear taps per probe vs ~163k triangle tests (~400×
  less work), zero allocations, three-free so it stays unit-testable in
  node. An optional `PickStats` counter exposes the tap count for tests.
  A ray starting below the surface returns null, matching the old front-face
  mesh raycast (the camera can never be underground).
- `apps/web/src/renderer/TerrainCanvas.tsx` — the hover tick unprojects the
  probe NDC into a world ray through a reused scratch vector and picks via
  `pickTerrainPoint` (no `raycaster.intersectObject`, no hits array, no
  per-probe allocation). NDC comes from a `cachedCanvasRect` refreshed in
  `resize()` (ResizeObserver covers every layout change) instead of a
  `getBoundingClientRect` per probe — zero forced reflows while sweeping.
  Click/pointer-up picking (`pickBody`/`pickGround`) keeps its own fresh
  rect reads and mesh raycasts: one-shot gestures, where a stale frame after
  a window resize could misplace the pick.
- `apps/web/src/renderer/hoverProbe.test.ts` — 9 new tests (27 total):
  flat/ramp hits, up/sideways/below-surface/away misses, zero-tap box miss,
  glancing-hit budget, cell agreement with an independent dense (4000-tap)
  reference march on steep + angled rays, the ≤512-tap bound pin, and
  source-wiring pins (tick uses `pickTerrainPoint`, hover block has no
  `intersectObject` / `getBoundingClientRect`, rect cached in `resize`).
- `.changeset/hover-math-probe.md` — patch changeset for web.

## Decisions

- **Math march, not throttle or BVH.** Throttling would trade readout
  latency for frames (stale probe chip while sweeping); a BVH would add a
  dependency + build step for one query. The heightfield march is exact
  (same cell as the mesh in practice), allocation-free, and dependency-free.
- **No behavior change.** Same gate (one probe per motion, cell-deduped
  emit), same `hitToInfo` readout, same click picking. Crater dents are
  mesh-only and were never in the readout — the march agrees with the
  readout better than the mesh did.
- **No wall-clock FPS test** (headless can't measure frames); tests pin the
  deterministic proxies instead — bounded tap counts, zero-tap misses,
  reference agreement, and the no-raycast/no-layout-read wiring.

## Test evidence

- `hoverProbe.test.ts` — 27/27 pass.
- Full web suite + `yarn typecheck` + `yarn build` (renderer changed) — see
  verification below.

README untouched: no workflow or visual change, purely fewer wasted frames
(same precedent as task 101).
