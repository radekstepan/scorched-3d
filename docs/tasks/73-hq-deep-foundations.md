# 73 — HQ deep foundations

Task: the HQ "floated" on hilly terrain — the slab sat at the anchor-cell
height, so the downhill side showed an air gap under the works. The
foundations now go deep enough to read as set into the ground.

## What changed

- `packages/core/src/units/hq.ts`: new `HQ_FOUNDATION_MARGIN` (6 world
  units) and pure `hqFoundationDrop(field, site, exaggeration)` — samples the
  slab footprint (±3 cells) plus the hall corridor (`HQ_HALL_CELLS` toward
  the map center, ±2 wide), takes the lowest ground, and returns the
  world-space drop from the anchor plus the margin. Siting logic untouched.
- `apps/web/src/renderer/hq.ts`: `buildHq` hangs two concrete footings —
  `hq-foundation` (inset under the slab) and `hq-hall-foundation` (inset
  under the hall floor) — straight down from the slab underside (local y=0).
  New `setHqFoundation` / `foundationDepthOf` size them per site via Y scale
  + re-seat (tops stay pinned at y=0), and `hqFoundationDropWorld` measures
  the drop from live `groundY` samples (slab grid + hall strip toward the
  map center) plus the shared margin. Both footings are Lambert + tagged
  `noHighlight`, so the wreck pass chars them with everything else.
- `apps/web/src/renderer/hqFx.ts`: the constructor sizes each fort's
  footings from the live surface; `resnap()` re-measures (the height-scale
  slider steepens every slope, which would otherwise re-open the gap).

## Decisions

- Group stays seated at the anchor; only the footings extend down. The
  uphill side buries concrete into the hill, the downhill side shows
  concrete — no floating, no re-siting, no hall-mouth / spawn changes.
- Two sources of the same measurement on purpose: the pure core helper pins
  the footprint math deterministically (no three.js), while the renderer
  samples bilinear `groundY` so the skirt matches the drawn terrain under
  every exaggeration. Both share one margin constant from core.
- Flat ground just buries the footings invisibly — no visual change there.

## Tests

- Core `hq.test.ts`: flat field returns margin only; a downhill dip in the
  hall corridor returns fall × exaggeration + margin (checked at 2× and 6×);
  far-away peaks outside the footprint don't deepen the skirt.
- Renderer `hq.test.ts`: footings exist, inset, flush under the slab;
  `setHqFoundation` pins tops at y=0 while bottoms reach the drop;
  drop-world covers the hall-mouth fall + margin on a grade and margin-only
  on flat/uphill; wreck chars both footings and keeps their depth.
- Renderer `hqFx.test.ts`: both forts bridge a center-falling grade plus
  margin at build, and follow a steepened hill across `resnap()`.
- Full `yarn test`, `yarn typecheck`, `yarn build` all green.

## Learnings

- `apps/web` resolves `@scorched-3d/core` to the built `dist` — after adding
  a core export, rebuild core before running web tests or the new symbol is
  `undefined` at runtime (showed up as `NaN` drops here).
- When asserting box tops after Y scaling, remember top =
  `position.y + height * scale.y / 2`, not `position.y + height * scale.y`.
