# Task 86 — Forest pathfinding: go around when the flank is faster, crush through when it must

Task: a unit closing in meets forest that slows it down and makes projectiles
harder to get through; pathfinding should try to go around if overall that is
the better path.

## What already existed (no duplication)

All three mechanisms were in place from earlier work, verified before touching
anything:

- Forest slows hulls (task 18): A* `cellTraverseCost` prices tree cells at
  +1.25 over open, and the drive pays `TREE_DRAG` 0.6 canopy proximity drag
  (`packages/core/src/units/terrain.ts`).
- Crushing through when necessary (task 30): wood never pins — driven steps
  fell standing trees on contact and pay `CRUSH_DRAG` 0.25 on crushing steps.
- Projectiles struggle through wood (task 42): per-tree stick rolls
  (bolts 0.55, shells 0.35), canopy-aware lobbing for shells, trunk collision
  for gun tubes (task 56).
- Detour preference (tasks 18/30): cost-weighted A* plus smoothing that
  refuses tree-crossing shortcuts (`legCrossesObstruction`) and trunk-grazing
  legs (`legClipsTrunk`), with trunk-free endpoint snaps.

## Audit: is the wood price right? (the interesting part)

The naive read says +1.25 (2.25× open time) underprices forest: a crush step
crawls at `TREE_DRAG × CRUSH_DRAG` = 0.15×, i.e. ~6.67× open time, so the
search should price tree cells near 6.5×. I implemented exactly that — and
measurement proved it wrong, so it was reverted before commit:

- Felling is instant on first contact, so the 0.25 crawl applies to ~1 tick
  per tree, not to the whole cell. A 2-tree lane costs ~+49 ticks over open
  (~1.5 cell-times per tree cell, ≈ 2.5× total), and a contiguous 30-column
  belt costs ~1.67× (uniform 0.6 canopy drag dominates; ~30 fell ticks on top).
  The existing 2.25× sits between the isolated-tree and deep-belt truths —
  a sound single-number compromise either side of which one geometry or the
  other mis-routes (6.5× demonstrably detoured around a thicket whose crush
  lane was faster in wall-clock ticks, 706 vs 614).
- Related: on the 8-deep belt the pathfound detour (1048 ticks, 7 trees
  felled) is ~8% slower than crushing straight through (970 ticks, 30 felled).
  Kept as-is on purpose: "better" here is time *plus* damage — the detour is
  the doctrine choice ("detour when possible, crush when necessary", task 30)
  at comparable overall cost.

## What changed

- Core (`packages/core/src/units/combat.ts`): new pure `flightStickChance`
  aggregating the per-tree stick rolls into one quotable number —
  `1 − (1−p)ⁿ` over the per-kind chance (a bolt crossing 3 crowns sticks with
  ~0.91 probability). The rolls in `rollTreeStick` are what guns actually pay;
  this closed form is the "harder for projectiles to get through" figure for
  firing-lane and advance decisions. Zero/negative cover reads as open ground.
- Tests:
  - `pathfinding.test.ts` — "forest through-vs-around choice": a narrow
    2-wide × 10-deep thicket crushes straight through (both flanks are
    longer — guards against over-avoidance retunes), and a lane-spanning
    forest ploughs through (no flank — guards arrival when crushing is the
    only option). Both pin determinism.
  - `movement.test.ts` — a pathfound order through a spanning 30×24 forest
    arrives via crush with its lane felled (end-to-end proof that
    through-when-necessary works, not just at cell level).
  - `combat.test.ts` — `flightStickChance` cases: open ground 0, single-tree
    parity with `treeStickChance`, closed forms for 3-tree bolt/shell flights,
    bolt > shell, monotonic saturation toward 1, purity.
- No pathfinding retune (audit above), no renderer changes, no README change
  (tuning audit + helper, not architecture).

## Important decisions

- **Fell-on-contact makes crush nearly free per tree.** `CRUSH_DRAG` reads as
  a 4× slowdown on paper but measures ~1–2 ticks per tree, because the tree it
  would slow the hull against falls on the first touching tick. Future tuners:
  do not price wood from the drag constants alone — drive it and count ticks.
- **One linear cell cost cannot match both isolated and contiguous wood**
  (2.5× vs 1.67× measured); 2.25× stays as the compromise that errs toward
  detours, which fell less wood for comparable time.

## Verification

`yarn test`: 451 core + 410 web pass (new: 2 pathfinding + 1 movement + 1
combat cases). `yarn typecheck`: clean. Playwright not run (per task rules).
