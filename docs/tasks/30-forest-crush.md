# Task 30 — Units crush through forest, felling trees that sink and decay

Units used to stop at the first trunk line: standing trunks collided like
narrow walls (drive-clamp refusal + deflection slides + spawn push-out), so a
straight order into a forest held forever and only pathfound detours arrived.
Hulls now walk through forest — ploughing a lane at a crawl, knocking the
trees they touch flat, while the fallen wood sinks and decays away like husks.

## What changed

- Crush model (`packages/core/src/units/destruction.ts`):
  - `crushTree(field, index)`: intact/burning trees fall to `toppled` (a
    burning tree's fire goes out when bulldozed), fell clock restarted.
    Terminal trees are never re-touched.
  - Fallen-tree decay, mirroring the husk pacing in `unitDamage.ts`:
    `FALLEN_DECAY_DURATION` 45 s, `FALLEN_SINK_DEPTH` 6, `fallenDecay` /
    `fallenSink` / `isFallenGone`. A new `gone` tree state (hidden instance)
    joins `isTerminalTree`, and `tickDamage` ages every fallen tree
    (toppled/stump/snag, however felled) to `gone` with a `decayed` event.
- Drive (`packages/core/src/units/terrain.ts`, `movement.ts`):
  - `stepBlocked` is terrain-only again — wood never pins. Trunk keepout
    helpers (`trunkBlockedAt`, `segmentClipsTrunk`, `pushOutOfTrunks`) stay
    exported for pathing/leaning, but the driver no longer consults them.
  - `treesCrushedByStep`: standing-tree fids whose keepout a step's segment
    enters (per-kind keepout, ascending fids, deterministic). Shared by the
    drag and the fell pass so both agree on what a step touches.
  - `CRUSH_DRAG` 0.25 multiplies the slope/canopy drag on crushing steps, so
    a fresh lane crawls at ~0.15× while a second pass over its fallen trunks
    rides the lighter 0.6 canopy proximity drag.
  - `advanceMover`/`advanceMovers` take an optional `CrushContext`
    (`DamageField` + fid-ordered tree points + `onCrush`): driven steps fell
    what they reach and report fresh falls. Absent, drives never fell, so
    terrain-less history is byte-identical. Deflection slides and the
    spawn push-out pass are deleted (dead once wood stops blocking).
- Renderer (`apps/web`):
  - `features.ts`: `writeTreePose` takes a `sink` (fallen wood rides below
    its fell seat; standing/burning wood never sinks) and a `gone` branch
    hiding trunk + crown; new `decaySink` helper shares the core pacing
    between re-snaps and the tick; `placeFeatures` re-seats decay from the
    field so exaggeration changes never resurrect or un-sink falls.
  - `movement.ts`: `UnitMovement` takes the crush context through to core.
  - `TerrainCanvas.tsx`: wires crush (`onCrush` re-poses falls into a
    `fallen` set), tracks blast/burn falls into the same set, handles
    `decayed` (re-pose + drop from the set), and re-poses the set every tick
    so the sink reads as continuous settling.

## Important decisions

- **Uniform decay for all fallen trees.** Blast-flattened, burnt-out, and
  hull-crushed trees share one fell clock and one `gone` end state, instead
  of a crush-only marker. Simpler field shape (no new clock array — `treeAge`
  restarts at every fell) and one hush-pattern story: everything the battle
  knocks down sinks and vanishes, scars remain.
- **Detour when possible, crush when necessary.** Pathfinding is untouched
  (cost tiers, keepout smoothing refusals, trunk-free snaps), so orders still
  route around woods — the hull only fells what the smoothed legs cannot
  avoid (belt interiors, corner arcs). The old belt-hold test became a
  crush-arrival test; the detour test now asserts arrival with grazes only.
- **Felled lanes stay felled.** Felled/gone trees are excluded from contact,
  so the first pass pays the crawl and later passes ride free — verified by
  a fixed-tick first-pass/second-pass/open-ground distance ordering test.
- **Separation shoves don't fell.** Only driven steps crush; the tiny lateral
  un-stacking nudges never touch the damage field.

## Verification

`yarn build`, `yarn typecheck`, `yarn test`: 226 core + 164 web tests pass,
including new crush suites in `destruction.test.ts` (fell rules, decay
pacing/sink/clamps, terminal→gone events, crush-vs-blast clock parity),
`terrain.test.ts` (drive-through gate, contact detection/order/kind-sizing,
felled exclusion, determinism), `movement.test.ts` (belt crush arrival +
fell states, first/second/open speed ordering, spawn crush-out replay,
detour-with-grazes), and web `features.test.ts` (sink offsets, gone hiding
for round + pine, `decaySink` pacing, snap preservation) plus `movement.test.ts`
(patrol crush-through with max-progress + fell asserts, ordered detour
arrival, resnap X/Z stability).
