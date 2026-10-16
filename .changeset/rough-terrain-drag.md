---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Rough terrain now resists movement: cost-weighted A* prefers open ground over slopes, woods, and rocks, string-pulled smoothing refuses shortcuts back through trees and rocks, and hulls drive slower on grades and near vegetation while scorch stays a visual decal that never traps units.

## Task writeup (moved from docs/tasks/18-rough-terrain-drag.md)

# Task 18 — Harder driving through rough terrain, trees etc.

Rough ground used to cost nothing: A* priced every walkable cell equally
and hulls drove at full per-kind speed anywhere the steep-slope clamp let
them stand. Three complementary changes make terrain resist, all
deterministic and all keyed off the static attribute grid:

- Cost-weighted A* (`pathfinding.ts` `cellTraverseCost`): entering a cell
  pays 1 plus slope tiers (+0.5/1.5/3 past raw slopes 8/14/20) plus +1.25
  for trees and +2 for rocks/metal. The octile heuristic is untouched
  (minimum cell cost is still 1, so it stays admissible) and the (f, h,
  z, x) tie-break is unchanged — open ground now wins ties and the rough
  is crossed only when it must. Water/steep blocking is untouched.
- Smoothing that keeps the detour (`legCrossesObstruction`): string-pulling
  refuses any shortcut whose interior samples a tree/rock cell, so it can
  no longer pull a cost-paid wood detour straight back through the trees.
  Open-ground zigzags still collapse to endpoints as before.
- Drive drag (`terrain.ts` `terrainSpeedScale`, applied in `movement.ts`
  `driveToward`): each step scales by a slope term (linear from 1 on the
  flat to `ROUGH_SLOPE_FLOOR` 0.45 at the steepest still-walkable grade,
  uphill and downhill alike) times a feature term (`TREE_DRAG` 0.6,
  `ROCK_DRAG` 0.5) probed over the destination cell plus its 8 neighbours,
  so threading between trunks still labours under the canopy. Flat open
  ground scales by exactly 1, keeping terrain-less stepping bit-identical.

Important decisions: explosion scorch stays visual-only for pathing
(README guarantee preserved — a unit parked inside a scorch decal still
drives out, covered by the pre-existing test). Likewise, blast-felled
trees / chipped rocks do NOT re-cost the grid: damage state lives in the
renderer-owned `DamageField`, and piping it into core pathing would force
live repathing and break determinism — static words impede, dynamic
damage is visual. Separation steering and formation fan-out are untouched
(drag slows forward drive only, never the separation shove, so crowds
still un-stack; formation slots were already walkable-separated).

Tests: `pathfinding.test.ts` prices open < slope < woods < rocks, routes
around a tree block instead of through it, refuses tree-crossing
shortcuts while still collapsing open ones, and replays deterministically;
`terrain.test.ts` pins the exact-1 flat case, grade-proportional drag with
uphill/downhill symmetry, and tree/rock/neighbour drag; `movement.test.ts`
asserts flat-open parity with terrain-less stepping, slower climbs, slower
tree-belt pushes that still arrive (rough slows, never traps). `yarn
typecheck` and `yarn test` pass (162 core + 109 web tests).
