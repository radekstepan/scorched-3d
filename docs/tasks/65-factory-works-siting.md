# Task 65 — Factory-like HQs sited off water and off peaks

The HQ forts read as concrete pillboxes and could site badly: the scorer
preferred *higher* ground (marching forts up ridges), accepted shoreline
cells one step above the waterline, and fell back to a mid-map water cell
when its single end column flooded — island-map forts beached in the surf
while plateau-map forts perched on peaks.

## Decisions

- Factory massing from existing materials (`apps/web/src/renderer/hq.ts`,
  still plain Lambert boxes + cylinders, still built once in `buildHq`):
  monitor (clerestory) roof crown with vents and skylight strip, twin
  chimney stacks with dark caps at the back corners (`hq-chimney`), a silo
  tank (`hq-silo`), a side workshop annex (`hq-annex`), and a framed
  sectional door (jambs + lintel, team gate lamps, canopy over the hall
  mouth). The old pillbox contract holds: `hq-door` name/seat/travel, main
  roof at the same height, scaled team ring, open hall + curbs, all
  `noHighlight`. The wreck pose chars everything, slams the door, drops
  the roof, and now also leans the stacks (idempotent via the wreck flag).
- Siting is valley-floor seeking (`packages/core/src/units/hq.ts`): strict
  ground needs height above `sea + HQ_DRY_MARGIN (8)`, height below the
  map-relative cap `hqMaxAboveSea` (`max(50, 0.6 * relief)` — flat maps
  keep their swells, ridge maps reject their peaks), slope within
  `HQ_MAX_SLOPE (12)`, and a hall corridor (`hqHallClear`, ~12 cells
  toward center, relaxed shore margin) that stays dry so reinforcements
  never spawn into the surf. Scoring prefers the outermost column, the
  middle row, gentle slopes, and LOW ground (the old `+h` term that
  climbed ridges is now a low-ground bonus).
- Deterministic fallbacks, no rng: relaxed pass (shore margin, slope 15,
  cap + 20 headroom) over the 16-column end band, then a half-map sweep
  toward a valley-floor target (`sea + 20`), then a last resort taking
  the lowest gentle hall-clear ground in the half with no cap — so wide
  island shores step the fort inward off the surf and all-high halves
  (Ashen Pass east is all plateau) still get their valley floor instead
  of their peak. Never a wet cell while dry ground exists in the half.
- Nanolathe inspiration: retail TA-style factories keep the front exit
  lane clear of buildings over its full width (`L5` siting: exit lane
  ground must be drivable, no deep water) — mirrored by the hall-clear
  corridor check plus the dry anchor margin.

## Files

- `packages/core/src/units/hq.ts` — guards (`HQ_DRY_MARGIN`,
  `HQ_MAX_SLOPE`, `HQ_FALLBACK_*`, `HQ_HIGH_BASELINE/FRACTION`,
  `HQ_HALL_CELLS`, `HQ_END_BAND`), `hqMaxAboveSea`, `isHqGround`,
  `hqHallClear`, `hqCellSlope`, band + half-sweep + low-ground `placeHqs`.
- `packages/core/src/units/hq.test.ts` — high-ground cap, water/slope/
  corridor rejection, flooded-column steps inward (old test asserted the
  beaching bug), all-presets validity sweep (dry, under cap or near the
  half minimum, gentle, hall-clear).
- `apps/web/src/renderer/hq.ts` — factory massing + stack-toppling wreck.
- `apps/web/src/renderer/hq.test.ts` — factory structure (stacks, silo,
  annex, monitor, Lambert/guard), stack toppling, original door/wreck
  cases intact.
- `docs/architecture.md`, `README.md` — fort → factory-works one-liners.
- `.changeset/factory-works-siting.md` (patch), `docs/tasks/65-factory-works-siting.md` (this writeup).

## Verification

- `yarn test` (core) — 20 files, 378 tests pass.
- `yarn test` (web) — 28 files, 353 tests pass.
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
