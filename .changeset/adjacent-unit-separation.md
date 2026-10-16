---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Adjacent units no longer deadlock inside each other's spacing stop: movers now shove apart with lateral separation steering (radial push plus a sidestep so head-on crossings pass instead of backing up into each other), ordered hulls keep a minimum drive fraction through crowds so orders stay alive to arrival, and group move orders snap formation slots onto walkable ground with a separation guarantee. Explosion scorch stays purely visual — it never alters heights or walkability.

## Task writeup (moved from docs/tasks/13-adjacent-unit-separation.md)

# Task 13 — Adjacent-unit deadlock + the brown "hole"

## Investigation: what the brown hole is

The brown hole is the **scorch decal** from task 09 — and it is innocent. Verified by reading every
blast-touching path rather than assuming:

- `packages/core/src/units/destruction.ts` — `addScorchMark()` is a pure append to a bounded
  world-space mark list (oldest-eviction at `MAX_SCORCH_MARKS = 48`, no decay). It takes no
  heightfield and returns a new array; there is no height/walkability parameter to mutate.
- `apps/web/src/renderer/combatFx.ts` — impacts only write an instanced-disc matrix/color
  (`syncScorch`) and call `fellFeatures`, which re-poses tree/rock instances. The terrain position
  buffer is written once at build (`TerrainCanvas.tsx` line ~677) and never touched per impact.
- The only other brown candidates are static: shoreline `dirt`/`wetSand` tiles and the caldera
  crater lake (generated once in `generate.ts`, never by blasts).

So explosions deform nothing — a unit "in a brown hole" sits on ordinary walkable ground under a
dark disc (hammer scars are radius 46 ≈ the spacing stop diameter, which is exactly why the decal
*looks* like a trap). The stuck units are stuck next to **each other**, not in the scorch.

## Root cause: the mutual spacing stop

`spacingScale()` in `packages/core/src/units/movement.ts` returns **0 inside `STOP_RADIUS = 30** —
for *both* hulls of a pair. `advanceMovers` evaluates scales from one snapshot, so two units
within 30 units both read 0, both step 0, and neither ever opens the gap the other needs: a
permanent, symmetric deadlock. Orders die the same way (the order cursor only advances on motion),
and the `stuck` timer never fires because it only accumulates on *terrain*-blocked steps. Two
contributors make it common:

1. No lateral separation anywhere — hold-inside-30 / crawl-inside-72 only.
2. `formationTargets()` seats slots geometrically; each `orderUnit()` then snaps independently via
   `nearestWalkable`, so adjacent slots near water/steep ground can collapse onto one cell and park
   the pair inside the stop from the moment they arrive.

(Terminal case found while testing the fix: even with separation, a constant-magnitude shove with
linear falloff approaches the stop radius *asymptotically* and stalls the pair exactly on it —
the replacement runs at constant magnitude for finite-time exit.)

## What changed

- `packages/core/src/units/movement.ts`
  - `separationVector()` (new, exported): radial shove at unit weight plus a perpendicular
    sidestep (`SEPARATION_SIDESTEP = 0.6`) so head-on crossings counter-step past each other
    instead of mirroring into a backup loop. Coincident hulls split along deterministic
    golden-angle headings. Snapshot-symmetric, pure.
  - `advanceMovers()` applies the push after every drive step (`SEPARATION_SPEED = 22 u/s`,
    slower than any hull's drive), terrain-gated through `stepBlocked` with axis-slide
    degradation so separation never shoves a hull into water/steep ground. Non-positive `dt`
    stays an exact no-op (same refs, no shove).
  - `ORDER_SPACING_FLOOR = 0.3` (new, exported): ordered hulls keep ≥30% drive inside another
    mover's stop radius — retail caps blocked movers at half `MaxVelocity` rather than parking
    them, and the same idea keeps an explicit order alive through a crowd to arrival. Patrol
    keeps the hard 0 (ambient wandering rests outside the hold; separation opens those gaps).
    Separation (22 u/s) still out-pushes the floor drive (≤17 u/s), so head-on ordered pairs
    open rather than pass through each other.
- `packages/core/src/units/pathfinding.ts`
  - `FORMATION_MIN_SEPARATION = 40` (new, exported — wider than `STOP_RADIUS` on purpose, kept
    as a literal because `pathfinding.ts` sits below `movement.ts` in the import graph).
  - `snappedFormationTargets()` (new, exported): geometric slots → `nearestWalkable` snap →
    expanding-ring rescue for any slot that lands unwalkable or within min-separation of an
    accepted earlier goal. Deterministic (fixed ring order, first match); documented fallback
    to the plain snap when ground is too constrained (dense islets), where separation steering
    still un-stacks arrivals.
- `apps/web/src/renderer/movement.ts` — `orderGroup()` uses `snappedFormationTargets` when a
  heightfield is present (falls back to geometric `formationTargets` without one). Per-unit
  `findWorldPath` re-snapping is a no-op on already-walkable goals, so assigned slots survive.
- Tests: 7 core `movement` cases (push math incl. pair-mirror + coincident determinism, single-tick
  separation, degenerate-dt no-op, adjacent ordered pair arrives, coincident patrols open past the
  stop, scorch-parked pair exits the decal disc with heights/walkability proven untouched), 3 core
  `pathfinding` cases (real-map walkable + separated + deterministic fan, synthetic shoreline
  water-click, tiny-island documented fallback), 1 web driver case (shore-click group goals
  walkable + separated, both hulls arrive).
- `.changeset/adjacent-unit-separation.md` (new) — **patch** for core + web (bug fix, no new
  visible feature).
- `README.md` — demo clause extended with separation/orders liveness.
- `docs/architecture.md` — movement row extended with separation + snapped formation.

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted — retail runs fixed-point yard-map stamping under a
budgeted scheduler; this is synchronous float steering over the attribute grid):

- `research/retail-executable-spec/04-units-orders-scripts-and-movement.md` §8 / `[R-MOV-01 §7]`:
  a blocked mover "keeps turning, speed capped at half `MaxVelocity`" and re-requests a path every
  60 ticks — it never parks at zero. Mirrored by `ORDER_SPACING_FLOOR` (orders stay alive through
  crowds) and by separation-as-replan (a spacing-pinned pair actively resolves instead of waiting).
- Same spec `[R-COLL-01 §1]`: a foreign occupant sets the blocked flag and the mover clamps inside
  its own footprint — occupancy blocks *drive*, but the order keeps waiting. Mirrored by keeping
  the `spacingScale` 0-stop for forward drive while resolving positions laterally underneath it.
- Deliberate deviation: retail has no push ("no push, no stacking, no force-placement" §3236) and
  resolves crowding through repath + half-speed caps. A synchronous demo has no path-request
  scheduler, so the repath role collapses into the per-tick separation push — same observable
  outcome (pairs open, orders complete), one tick instead of 60.

## Decisions

**Constant-magnitude radial shove, not a falloff.** The first version scaled push by
`(R−d)/R` and stalled test pairs at exactly 30.00 units — Zeno's deadlock. Constant magnitude
crosses the boundary in finite time and rests stably (push is zero beyond the radius).

**Sidestep always on, not just head-on.** Detecting "head-on" needs headings/goals the push
doesn't take; a constant perpendicular term is harmless for side-by-side pairs (reads as jostle)
and is what lets crossings pass. Sign comes from the away-axis perpendicular flipping with the
viewpoint — no index ordering, still exactly pair-mirrored.

**Orders floor, patrol doesn't.** Player intent outranks ambient spacing: an order to a crowded
goal must close to arrival radius. Patrol keeps the full stop so the ambient column still rests
in an open line rather than grinding on neighbours.

**Separation pushes holders too.** An arrived hull inside another unit's stop gets nudged — same
as retail jostle — which is what lets a trailer close on a goal next to a parked leader.

**Scorch untouched (proven, not assumed).** The tempting fix — "make scorch non-blocking" —
would have changed nothing, because scorch was never blocking. The writeup records the evidence
so the next brown-hole report starts from the decal, not the heightfield.

**Caught while testing: `dist/` staleness.** Web tests import core through the compiled `dist`
symlink, so new core exports read as "not a function" until `core build` reruns — same lesson as
prior tasks: build core before testing web.

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — all pass (core 133: 123 + 7 movement + 3 pathfinding; web 81: 80 + 1 movement-driver).
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
