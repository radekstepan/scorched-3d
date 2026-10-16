# Task 112 — Minimap click centers the clicked item (DOM box fix)

## Symptom

Clicking an area of the minimap (crosshair cursor) did not take the main
view to that area: the item under the cursor failed to land in the center
of the view. Prior tasks (83, 97, 102) verified the math pipeline —
`minimapPointToWorld` → sequenced jump → offset-preserving, terrain-seated
`jumpCameraTo` — and pinned it with headless-camera NDC tests, yet the bug
persisted in the browser. So the fault had to be outside the tested
pipeline: in the DOM boxes the math is measured against.

## Root cause (two DOM box bugs in `App.tsx`)

1. **Baseline strut gap (dominant, asymmetric).** The minimap `<img>` was
   an inline element (`aspect-square w-full` with no `block`). An inline
   replaced element sits on the text baseline, so the relatively-positioned
   wrapper stood several px taller (16px font × 1.5 line-height strut ≈
   ~5px on a ~234px minimap) than the terrain image. Both the click
   fractions (`getBoundingClientRect` of the taller wrapper) and the
   overlay dot/marker percentages stretched over wrapper = image + gap:
   clicks in the southern half landed progressively short (up to ~2% of
   the map ≈ 85 world units at the south edge), and southern dots rendered
   below the image. North-edge clicks were exact — the asymmetry that made
   this so confusing.
2. **1px border inset.** The img carried `border border-white/10`, insetting
   the image content 1px from the wrapper box that clicks/dots are measured
   against — up to ~22 units of miss at the corners (≈28 units diagonally).

Combined worst case (south corners): ~100 world units ≈ 4 tank lengths —
a visibly wrong area at any zoom past the far overview, and an off-center
item even when the area was roughly right.

## What changed

- `apps/web/src/App.tsx`
  - Minimap `<img>` is now `block` (wrapper box == image box, no strut gap)
    with `ring-1 ring-white/10` instead of `border border-white/10`
    (box-shadow framing adds no layout box, so the image content box stays
    exactly the click/dot box; same hairline look).
  - Hover chip plots in world coords (`hover.worldX/worldZ`, same mapping
    as dots and the click handler) instead of cell-index math, which sat up
    to half a cell off the point a click there addresses.
- Tests: `App.minimap.test.ts` pins the img box (`block`, no `border`,
  `ring-1`) and the world-coord hover chip (source-level — the bug is CSS
  layout, untestable headless); `renderer/minimap.test.ts` gains an edge +
  corner chain (`minimapPointToWorld` → `jumpCameraTo` → NDC ≈ 0 at all four
  corners and mid-edges) plus an inside-margin case proving the jump clamp
  never fights the tick's `clampPanTargetWithCamera`.
- No production change in `renderer/minimap.ts` or `TerrainCanvas.tsx`.

## Investigated and rejected

- **App extents (`width*CELL_PIXELS` = 5120) vs canvas extents
  (`worldSize` = 5104):** headless sim over all 252² baked-image pixels
  showed both conventions leave ±20-unit bake-quantization noise (a 252px
  bake of 320 cells: each pixel spans 1.27 cells, and left-edge sampling can
  sit a full cell from the pixel center). Worst miss vs shown-cell world:
  23.9 (old) vs 31.9 (new) — i.e. below/around quantization either way, and
  dots-vs-clicks (the invariant that matters for "click the dot, center the
  unit") share one convention today. Churn rejected: zero user-visible gain.
- **Task-4 corner clamp conflict:** none. `jumpCameraTo` carries the camera
  by the clamped delta (equivalent to `clampPanTargetWithCamera` for an
  in-bounds target, which the tick guarantees), and the post-`update()`
  clamp uses identical bounds — a no-op after a jump. Pinned by the new
  inside-margin test.
- **OrbitControls `zoomToCursor`/`enableDamping` undoing the teleport:**
  `update()` re-derives its offset from the live camera/target each call,
  so teleports survive; `_performCursorZoom` only acts on wheel frames.

## Test evidence

- Targeted: `minimap.test.ts` + `App.minimap.test.ts` — 36/36 pass.
- Full `yarn test` (web) + `yarn typecheck` — see commit message.
- Playwright not run (per task rules); the CSS mechanism (inline-img strut,
  border-box vs content-box) follows directly from the box model.
