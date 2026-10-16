---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Select units by click, shift-click, or shift-drag box, and order them across the battlefield with right-click: deterministic grid A* with water/steep avoidance, string-pulled smoothing, and formation fan-out, while the minimap tracks every unit live.

## Task writeup (moved from docs/tasks/11-selection-pathfinding.md)

# Task 11 — Selection + pathfinding move orders

## What changed

Units take player orders now: click to select one, shift-click to toggle,
shift-drag to box-select, right-click the terrain to send the selection
there along A* paths that fan out into formation instead of stacking. The
minimap finally tracks live positions (closing task 10's known limitation).

- `packages/core/src/units/pathfinding.ts` (new) — framework-free grid A*,
  exported from `packages/core/src/index.ts`: `isWalkable()` (dry +
  gentle, the same gate patrol routes use — steep/water blocked),
  `findCellPath()` (8-directional, corner-cut prevention, cardinal-1 /
  diagonal-√2 costs, octile heuristic, deterministic `(f, h, z, x)` heap
  tie-break), `hasLineOfSight()` (half-cell sampling) + `smoothCellPath()`
  (greedy string-pulling that keeps the detours A* paid for),
  `nearestWalkable()` (ring snap for order endpoints), `findWorldPath()`
  (snap → search → smooth → world waypoints, straight-drive fallback when
  unreachable), and `formationOffsets()` / `formationTargets()`
  (deterministic hex-ring fan, slot 0 on the click).
- `packages/core/src/units/movement.ts` — `Mover` gains an optional
  `order` (`MoveOrder`: waypoint list + cursor) and `hold` flag, with
  `orderMover()` / `holdMover()` / `hasOrder()`. `advanceMover()` drives a
  live order first (arrival advances the cursor, final arrival → hold),
  holds when `hold` is set, and patrols otherwise — the shared
  turn-then-drive core (`driveToward`) keeps hull-faces-travel, turn-rate
  caps, alignment grip, and spacing for both modes. Order-less movers step
  byte-identically to before, so existing patrol tests hold.
- `packages/core/src/units/pathfinding.test.ts` (new) — 17 vitest cases:
  walkability incl. shore-steep parity with placement, straight/diagonal
  runs, water detour, corner-cut isolation, blocked-map null, determinism,
  octile values, smoothing collapse vs detour-keeping, snap ties,
  real-map end-to-end walkability, fallback goal, formation spacing and
  determinism; plus 4 order cases in `movement.test.ts` (leave-patrol,
  cursor advance, arrival-hold, empty-order hold).
- `apps/web/src/renderer/selection.ts` (new) — framework-free picking:
  `pickNearest()` (nearest projection within 28 px, lowest-index ties),
  `normalizeRect()` / `boxPick()`, `clickSelect()` / `boxSelect()` (shift =
  toggle/union, else replace/clear), `CLICK_DRAG_PX = 6`.
  `selection.test.ts` (new) — 9 cases over synthetic points.
- `apps/web/src/renderer/movement.ts` — `UnitMovement` takes an optional
  heightfield (existing 3-arg constructions keep working): `orderUnit()`
  (A* from the live position, straight drive without a field),
  `orderGroup()` (one formation slot + independent path per unit),
  `hasOrder()`, `positions()` (live X/Z for picking + minimap). Turret
  handling untouched — combat still aims externally while hulls drive.
  `movement.test.ts` — 2 new cases (order-to-hold over 25 s, group fan-out
  with distinct destinations).
- `apps/web/src/renderer/TerrainCanvas.tsx` — amber rings under selected
  bodies (children of the body groups, so they ride motion for free);
  left-click select (raycast, falling back to nearest projection so small
  or occluded hulls still pick), shift-click toggle, shift-drag box with
  an overlay div (orbit disabled for the gesture only, always restored),
  right-click-no-drag orders the selection with an expiring ping marker
  (right-drag still pans), Esc clears. Click/drag disambiguates at 6 px;
  hover probe, pan, orbit, exaggeration re-snaps, and all combat caps are
  unchanged. Live positions broadcast at ~4 Hz.
- `apps/web/src/App.tsx` — minimap bakes terrain only; unit markers are a
  live overlay (kind-colored, amber outline when selected) fed by the
  broadcast; Units panel shows the selection count + order hint; footer
  documents the full control scheme.
- `.changeset/selection-pathfinding.md` (new) — **minor** changeset for
  core + web (new visible feature).
- `README.md` — demo description extended with selection/orders.

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted — retail runs fixed-point
yard-map stamping under a per-player budgeted scheduler; this is a
synchronous float search over the attribute grid):

- `internal/path/search.go` — cardinal 16 / diagonal 22 step costs with a
  weighted octile heuristic and a heading-dependent turn-penalty table.
  Mirrored by the cardinal-1 / diagonal-√2 costs plus the octile heuristic;
  turn penalties are skipped because hull steering already smooths corners
  through the alignment grip in `advanceMover`.
- `internal/path/smooth.go` (`SmoothKernel`) — pulls the searched route
  taut by replacing runs of turns with one straight leg when the mover
  footprint can stand along it (retail searches turn in eighths, so raw
  routes run ~10% long). Mirrored by `smoothCellPath()`, with the
  footprint test collapsed to a walkability probe along the leg.
- `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`
  positioned-broadcast formation branch — selected actors keep their
  offsets from the selection centroid for ground-position orders (e.g. two
  actors at X 100/140 ordered to X 1000 land at 980/1020), with a
  squared-distance cutoff for outliers. Mirrored by `formationTargets()`
  as a hex-ring fan; no centroid math and no cutoff (roster is 6, the
  cutoff never triggers), so every unit gets its own nearby destination.
- Same spec, MOVEINFO profiles + §3.7 "drag selection and overlap
  picking" / "toggle and commit modifiers" — cells gated by slope/depth
  thresholds per mover; single-click path, drag-rectangle path, and a
  commit/toggle truth table with Shift as the toggle source. Mirrored by
  the shared `isWalkable` gate and the click/box/toggle helpers.
- Deliberate deviation: retail issues every world command with LEFT-click
  and reserves right-click for cancel/deselect. Here left-drag orbits the
  camera, so moves go on RIGHT-click (no drag; right-drag still pans).
  Left-drag stays orbit; box-select takes Shift+drag. Documented in the
  HUD footer — the one UX call players will feel.

## Decisions

**Arrival → hold, patrol never auto-resumes.** An ordered unit stays where
it was sent (`hold: true`, order cleared) instead of wandering back onto
its patrol loop — predictable for players, and repathing is just a new
order. A patrol-resume toggle is future work.

**Orders suspend patrol, they don't fork it.** `mover.leg` is untouched
while an order drives, but since completion holds rather than resumes, the
stale leg never fires. Spacing (`spacingScale`) still applies to ordered
units, so a group arriving together slows/stops instead of stacking —
combined with the formation fan, arrivals read as a line, not a pile.

**Unreachable goals degrade to a straight drive, never a strand.**
`findWorldPath()` falls back to the (snapped) goal alone when A* returns
null, and `orderMover([])` holds in place. Snapping radius is 12 cells;
mid-ocean clicks land on the nearest shore and drive at it.

**Click resolution is raycast-first, projection-second.** Raycast wins
when it hits a hull (exact mesh); otherwise the nearest projected body
within 28 px counts — small/occluded hulls at glancing angles stay
clickable, matching what the player sees.

**Minimap markers are DOM, not canvas.** The baked minimap is now
terrain-only; live dots are absolutely-positioned spans updated at ~4 Hz
through React state. No per-frame canvas upload, no stale spawn dots, and
the kind colors + selection outlines come for free.

**Caught while testing: `cellSlope` x/z swap.** The first version read
`idx(grid, x, x+1)` — row/column transposed — which made gap cells read as
steep and nulled every detour. Real-map waypoint tests caught it: always
assert `isWalkable` on generated-map content, not just synthetic flats.
(Sibling lesson reinforced: shoreline cells read as steep because the
slope probe touches the water neighbour — same as `place.ts` — so tests
must expect that rather than "adjacent to water is walkable".)

## Verification

- `yarn test` — all pass (21 new core pathfinding/order cases + 7 new
  selection cases + 2 new movement-driver cases; totals 104 core + 75 web).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
