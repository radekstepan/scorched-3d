---
"@scorched-3d/web": patch
---

Tree fires are now layered instead of single cones: each burning tree gets a translucent outer flame engulfing the canopy plus a bright core flame, rising ember sparks, a two-puff smoke column, and a ground glow disc, with flames dying down from white-hot to low amber over the burn and smouldering wrecks keeping a dim ember and pale smoke so they still read as hot.

## Task writeup (moved from docs/tasks/20-layered-tree-fire.md)

# Task 20 — Layered tree fires

Tree fires used to be a single opaque orange cone per burning tree
(`fireFx.ts`: one `ConeGeometry(7, 26)` instance, uniform flicker) — it read
as a little traffic cone parked on the canopy. Each burning tree now gets a
layered treatment in the same file, following the nanolathe pairing of an
additive flash shell plus smoke column and spark debris
(`internal/effects`): five pooled instanced draws, still no per-tree objects
and no per-frame allocations or rng (all motion phase-hashed by tree index,
so replays stay deterministic, and fire light still reuses the combat
2-light pool via `glowAt`):

- outer flame: big translucent additive cone (11×34, opacity 0.55)
  engulfing the canopy, swaying and breathing at its own rate;
- core flame: smaller bright cone (6×24, opacity 0.85) for the white-hot
  heart, flickering faster so the silhouette boils instead of pulsing whole;
- embers: one additive spark spiralling up out of each burning tree, plus
  one dim leftover ember dancing low over each smouldering wreck (capped at
  `MAX_FIRE_EMBERS` 48) so burnt-down trees still read as hot;
- smoke: a two-puff dark column per burning tree (fresh charcoal low,
  greyer and wider as it dissipates, rising to 70) instead of one puff, one
  pale puff per smouldering tree as before (still capped at `MAX_SMOKE` 48);
- glow: an additive ground disc under each burning tree so the fire pools
  light on the earth beneath it without costing a real light.
- burn-age curve: the pure `burnProgress` helper (clamped age /
  `BURN_DURATION`) shrinks flames to ~55% height and cools tints from
  white-hot toward deep ember red (`outerFlameTint` / `coreFlameTint`, core
  always hotter than shell), so fires visibly die down before the core-owned
  collapse to smoulder — the view never pops flames early. Charring itself
  stays in `features.ts` (ember canopy → shrunken charred crown → toppled /
  stump / snag), now framed by the richer fire.

Important decisions: field iteration order still wins (older damage first,
so long battles shed the newest smoke, never state); `flameCount` still
counts burning trees shown (outer layer) so existing call sites are
untouched; smouldering trees deliberately get embers but no flames/glow —
the wreck reads hot without re-igniting. The five draws hold the scene
budget (dispose still empties the scene; caps tests prove every layer).

Tests: `fireFx.test.ts` grows from 3 to 7 tests — layered assertions for
burning (outer + core + glow, 2-puff column, spark) and smoulder (smoke +
dim ember), per-layer budget caps including a mixed burning/smoulder smoke
test, no-early-pop on over-age burns, transient clear/rebuild across all
five layers, and pure-curve tests (clamped progress, monotonic cooling,
core hotter than shell). `yarn typecheck` and `yarn test` pass (170 core +
122 web tests).
