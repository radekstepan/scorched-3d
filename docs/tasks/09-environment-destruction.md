# Task 9 — Environment destruction from fire/explosions

## What changed

Impacts now leave lasting marks: every explosion scars the ground with a
persistent scorch decal and fells nearby trees/rocks into stumps and rubble,
while units themselves are untouched (no health model — that is a later
task, and a tree felled under a unit never moves the unit).

- `packages/core/src/units/destruction.ts` (new) — framework-free
  destruction state, exported from `packages/core/src/index.ts`:
  `ScorchMark` (`x/z/radius/intensity`), `MAX_SCORCH_MARKS = 48`
  (separate cap from the 6-shot / 8-explosion / 2-light caps, which are
  unchanged), `MAX_FELLED_PER_BLAST = 12`, `BLAST_RADIUS` per kind
  (hammer 80 > commander 60 > stump 52 > flash 44), `scorchForKind()`
  (shells scar big and black, bolts small and ashen), `addScorchMark()`
  (pure append with oldest-eviction, no decay — marks persist for the
  session), and `indicesInBlast()` (nearest-first capped radius query over
  `{x, z}` points, used to pick which instances a blast fells).
- `packages/core/src/units/destruction.test.ts` (new) — 8 vitest cases:
  per-kind scorch/radius ordering and bounds, pure append + oldest-eviction
  at cap, blast radius/cap/degenerate inputs, nearest-first capping.
- `apps/web/src/renderer/combatFx.ts` — new optional `CombatEnv` hooks
  (`groundY` for seating decals, `fellFeatures` for felling; both no-ops
  when absent so existing headless tests keep constructing `CombatFx`
  unchanged). Each impact records a core scorch mark into one shared
  `InstancedMesh` disc (`MAX_SCORCH_MARKS` instances, one geometry + one
  material, per-instance matrix/color only) and calls `fellFeatures`
  with the kind's blast radius. Shots carry their `kind` so scar size
  matches the weapon. New `scorchCount` readout, new `reseatScorch()`
  (re-seats decal heights, e.g. after exaggeration change);
  `clearTransients()` deliberately keeps scorch; `dispose()` removes the
  scorch mesh and disposes its geometry/material. No per-frame allocations:
  decals sync only on impact via a reused scratch object.
- `apps/web/src/renderer/TerrainCanvas.tsx` — wires the hooks: `groundY`
  reads the live exaggeration from `optsRef` so decals track the slider,
  `fellFeatures` fells tree/rock instances via core `indicesInBlast`
  (trees collapse to stump trunks with hidden crowns, rocks sink to 0.35×
  rubble). Tree/rock groups now carry `userData.felled` sets plus a
  combined `userData.all` position list; `placeFeatures()` was refactored
  into shared `writeTreePose()` / `writeRockPose()` helpers so
  exaggeration re-snaps preserve felled state instead of resurrecting
  features. The exaggeration branch calls `combat.reseatScorch()` after
  `clearTransients()`.
- `apps/web/src/renderer/combatFx.test.ts` — 3 new cases: scorch appears
  and `fellFeatures` fires on impacts, scorch saturates exactly at
  `MAX_SCORCH_MARKS` over a long skirmish yet survives `clearTransients`,
  re-seat tracks a height change (101.2 → 201.2) and dispose removes the
  scorch mesh.
- `.changeset/environment-destruction.md` (new) — **minor** changeset for
  core + web (new visible feature).
- `README.md` — one-line destruction mention in the demo description.

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted, no retail assets):

- `internal/platform/gpurender/scorch_test.go` + `internal/meshscene/retained_effect_types.go` (`EffectGround`, cross kind 1 = scorch) — nanolathe keeps scorch marks as a bounded ground-effect layer over the surface pass ("Blast scars that fade over time", `nlscreen_pages.go`). Mirrored as a bounded world-space mark list with oldest-eviction, but persistent instead of fading (session-lifetime scars read better in a quiet ambient demo) and instanced discs instead of GPU quads (no sprite pipeline here).
- `research/retail-executable-spec/05-economy-construction-players-and-features.md` §feature definition — live features carry damage and resolve to burnt/dead successors. Mirrored as one-shot blast felling (inside the radius = stump/rubble successor, outside = spared) with no per-feature HP, which would need a damage model this task explicitly excludes.
- `research/retail-executable-spec/06-weapons-projectiles-damage-and-effects.md` was grepped for crater/terrain-damage conventions but holds weapon-catalog detail, not ground scarring — so blast/scorch sizing follows the local `WEAPON_PROFILES` families instead (shells scar widest).

## Decisions

**Decals over vertex deformation.** True cratering (depressing the
heightfield mesh) would fight the baked-geometry + shader pipeline and the
exaggeration re-snap path; dark instanced discs slightly above the surface
(+1.2, polygon-offset) read as scorch at demo scale with one draw call and
trivial re-seating. Crater lips/depressions remain future work.

**Persistent, not fading.** Nanolathe fades its scorch quads; here marks
never decay — the battlefield visibly accumulates history over the session,
which is the point of the task ("persistent for session"). The 48-mark cap
with oldest-eviction bounds memory regardless of skirmish length.

**Felling, not removal.** Felled trees keep a squashed stump trunk and
felled rocks a sunk rubble instance rather than vanishing — no holes in
the instanced buffers, no index invalidation, and the stump/rubble reads
as destruction instead of pop-out. Feature ids index round trees then
pines, matching trunk buffer order, so re-snaps and blasts share one
posing helper and can never disagree.

**Units are never moved by blasts.** `fellFeatures` only touches tree/rock
instance matrices; unit groups are not even passed to the hook. Recoil
still nudges hulls and `clearTransients` still restores them, unchanged.

**Core stays framework-free.** All caps, radii, scar shapes, and blast
queries are pure math in `destruction.ts` with vitest coverage;
`combatFx.ts` / `TerrainCanvas.tsx` only pose instances and seat decals.

## Verification

- `yarn test` — all pass (8 new core destruction tests + 3 new combatFx
  tests; totals 67 core + 59 web).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
