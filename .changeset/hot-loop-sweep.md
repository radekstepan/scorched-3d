---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Hot-loop sweep with no visual or gameplay change: crater dents reject far bowls by squared distance before the sqrt/warp, tree segment tests gain an allocation-free boolean probe, the canvas shares one tree-stands snapshot per tick between occlusion and combat, waypoint live lines rewrite reused buffers instead of rebuilding geometry per tick, combat shots orient via scratch vectors with an early-out when no rounds fly, and hidden health bars skip their per-tick re-seat. Deterministic perf-guard tests pin the equivalence and the simulation bounds.

## Task writeup (moved from docs/tasks/52-hot-loop-sweep.md)

# Task 52 — Hot-loop sweep

Per-tick hot paths (movement, combat nudges, fire, waypoint driven-path
sim, occlusion taps × samples, tracks, health bars, crater-dented groundY)
had accumulated per-frame allocations and redundant sampling from prior
tasks. This sweep profiles by reading code and removes the waste with
behavior-identical fast paths: scratch reuse, invariant hoisting, a shared
per-tick stands snapshot, buffer reuse for live lines, and squared-distance
rim rejects. No visual or gameplay change; zoom, occlusion silhouettes,
waypoint prediction, tracks, stun, tremble, and husk debris all read
exactly as before.

## What changed

- Core `destruction.ts`: `craterDepthAt` now rejects far bowls by squared
  distance before the sqrt/warp — flat bowls skip at `d² ≥ r²`, washed
  bowls past `r·(1+skew)` (the max downhill reach of `effectiveBlastDist`
  at `MAX_BLAST_SKEW = 0.45`). Rim-exact: `craterFalloff` returns 0 at
  `t ≥ 1` anyway, so sampled depths are bit-identical. This is the
  single hottest inner call: every `groundY` probe (occlusion march
  samples, stands seating, waypoint/fire/track seating) pays up to 48
  crater checks per call.
- Core `combat.ts` (new): `treesIntersectSegment(a, b, trees)` — boolean
  twin of `treesOnSegment` with the same broadphase + exact crown/trunk
  tests but an early `true` instead of a collected fid list, so miss
  probes (the common case on open flight lines) never allocate.
  `flightClearsTrees` uses it per sub-segment (up to 256 firing-solution
  samples, previously one array each).
- Renderer `occlusionFx.ts`: `segmentBlockedByTrees` probes via
  `treesIntersectSegment` (no fid list per tap), and `unitOcclusion`
  reuses a module scratch tap instead of allocating one target object
  per tap per unit per tick.
- `TerrainCanvas.tsx`: one `liveStands()` build per tick, shared by the
  occlusion x-ray and combat interception rolls through `getStands()`
  (previously one build per reader per tick — occlusion + `advanceShots`
  + every `tryFire`). Blast flattens, hull crushes, and burn resolutions
  dirty the snapshot so later readers in the same tick still see live
  wood; ignitions never dirty it (burning still stands, heights
  unchanged). Deliberate tradeoff, documented: stands are a per-tick
  snapshot rather than per-call live — a tree felled mid-tick intercepts
  until the next frame at most (16 ms; shots fly for seconds).
- Renderer `waypoints.ts`: `paintLine` rewrites a reused per-line vertex
  buffer in place (growing only, draw-range prefix for shorter paths)
  instead of disposing + rebuilding a `BufferGeometry` per live unit per
  tick — 12 geometry rebuilds/frame steady-state go to zero.
  `orderPoints`/`trailPoints` read the draw-range prefix, so the public
  shape is unchanged.
- Renderer `combatFx.ts`: `advanceShots` returns early with no rounds in
  flight (skips the stands fetch entirely), orients bolts through module
  scratch vectors instead of a per-shot `Vector3` + `position.clone()`,
  and resolves stuck/done impacts into a shared scratch point consumed
  synchronously by `explode`/`spawnFlash` (both copy values, never retain
  the reference). `poseHusks` reuses a resized/zeroed decay scratch
  instead of a fresh array per tick.
- Renderer `healthBars.ts`: `update` hides every bar up front and returns
  while the toggle is off — same hidden result, no per-tick re-seat,
  billboard, or fill churn.

## Before / after (reasoning, no wall-clock)

- `groundY` probes per tick: ~N trees (stands) + 6 units × 3 taps × 16
  march samples + waypoint/fire/track seating, each previously paying up
  to 48 crater sqrt/warps. After: far bowls cost one squared-distance
  compare; near bowls cost what they always did. Typical maps have a
  handful of live craters, so most probes now exit on the first compare.
- Stands builds per tick: 2–3 full rebuilds (occlusion, shots, fire
  attempts) → 1, plus rare dirty rebuilds on blast/crush ticks.
- Allocations per steady-state tick eliminated: 18 tap objects +
  ~18 fid-list arrays (occlusion), 12 line geometries + 12 float arrays
  (waypoints), 1 decay array + per-shot vectors/clones (combat), 1
  target-pose array (HOLD: `positions()` broadcast is ~4 Hz, left alone).
- Deliberately left alone: `advanceMovers` O(n²) spacing/separation
  (roster is ~6 — 36 cheap pairs, no win worth the churn),
  `predictDrivenPath` budget (already capped at `PREDICT_MAX_STEPS`,
  skipped while hidden), `descendantCount` traverses (~20 nodes × 6,
  dwarfed by the march sampling above).

## Important decisions

- **Bit-identical over clever.** The crater rim reject and the tree
  boolean probe return exactly what the naive code returned (pinned by
  equivalence tests); scratch vectors are consumed synchronously and
  never retained.
- **Snapshot, not live, stands.** One build per tick with dirty-on-fell
  keeps every reader in agreement (view-blocking wood and
  round-blocking wood still share one array) at 1 frame of staleness
  worst case.
- **Grow-only line buffers.** Live paths vary in length frame to frame;
  shrinking would reintroduce churn, so buffers only grow and short
  paths draw a prefix. Session-bounded (a few KB for the longest
  driven loop).
- **No timing assertions.** All new perf tests are deterministic:
  value equivalence and operation-count bounds, never wall-clock.

## Verification

- `yarn test` — new `packages/core/src/units/hotloop.test.ts`
  (crater early-out vs naive reference incl. rim boundaries and stacked
  bowls, `treesIntersectSegment` vs `treesOnSegment` agreement,
  `predictDrivenPath` length ≤ `maxSteps + 1`); new waypoint
  geometry-reuse test (same `BufferGeometry` across ticks, fresh
  content), occlusion scratch-safety test, health-bar hidden-path test
  (pose untouched while hidden). Full suite: 18 core files / 319 tests
  pass, web suite passes.
- `yarn typecheck`, `yarn build`.
- Playwright not run (per task rules).
