# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed in docs/tasks. Record any important decisions in that writeup.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).
9. Each subagent must add a changeset (`yarn changeset`) describing its change and include it in the same commit, so versions keep moving. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.

Use sibling `nanolathe` repo for inspiration.

## List

Tanks are driving sideaways...

It should be harder driving through rough terrain, trees etc.

Show damage to models, like charring, smoke here and there etc.

Improve the trees on fire, the fire looks like little cones...

The brown blotches on the ground are weird. Is that from projectiles exploding? Make them more "believable. And you can "flatten the terrain a tiny bit. Right now it looks like mud.

Some of the units are scaling too high of a terrain, make the physics look more believable. And start with a smaller height scale.

## Writeups

### Task 1 — Tanks driving sideways (fixed)

Root cause was not the steering code: core `driveToward` already turns the
hull toward the target at the kind's turn rate and then displaces the mover
along the hull forward vector `(sin(hull), cos(hull))` — travel always equals
hull yaw (locked by `movement.test.ts` "never snaps the hull"). The sideways
read came from the meshes and their seating footprints:

- Tank hull boxes in `apps/web/src/renderer/units.ts` were wider (X) than
  deep (Z, the travel axis): flash 18×13, stump 26×18, hammer 24×16. A hull
  wider than long reads as strafing even with a correct yaw.
- `HULL_FOOTPRINT` in `packages/core/src/units/terrain.ts` matched the
  sideways boxes (`halfWid > halfLen` for all three tanks), so grade
  pitch/roll leaned across the hull instead of nose/tail along it.

Fix: swapped tank hull/trim/turret boxes lengthwise (flash 13×18, stump
18×26 + 19×27 trim + 12×14 turret, hammer 16×24; turret Z offsets and barrel
pivots unchanged — they still sit inside the longer hulls with the muzzle
overhanging the nose) and swapped the footprints to `halfLen > halfWid`
(flash 10/8, stump 14/10, hammer 13/9). Commander untouched — a biped is
correctly shoulder-wide. Muzzle forward throws already cleared the new noses,
so no weapon math changed.

Tests: `terrain.test.ts` asserts tank footprints run long along travel;
`units.test.ts` asserts tank hull bounding boxes are deeper (Z) than wide
(commander asserted opposite) and that every muzzle tip throws ahead of its
hull nose in the model frame. `yarn typecheck` and `yarn test` pass
(152 core + 109 web tests).

### Task 2 — Harder driving through rough terrain, trees etc. (done)

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

### Task 3 — Visible battle damage on units (done)

Units used to shrug off everything: impacts exploded beside hulls that kept
their showroom paint forever. Blasts now splash nearby hulls with
accumulating damage, shown three ways — progressive charring (body colors
lerp toward burnt umber with damage, saturating at 0.8), grey smoke puffs
above scorched hulls (damage ≥ 0.2), and flickering orange embers plus
near-black smoke on gutted hulls (damage ≥ 0.55). Damage never heals and
units never die from it — the roster drives on, visibly battered.

- Core `units/unitDamage.ts` (new): per-unit 0..1 damage fractions plus
  `applyBlastToUnits` (point-blank hit per firing kind — hammer 0.16 down to
  flash 0.06 — with linear falloff to the kind's `BLAST_RADIUS` edge,
  clamped at 1). Pure apart from the in-place accumulation, no rng, so
  replays stay deterministic; smoke/heavy/char thresholds and `charMix`
  live here for tests.
- Renderer `unitDamageFx.ts` (new): `charredColor` pure color math plus
  `applyUnitDamageTint` (stashes each mesh's base color once in
  `userData.baseColor`, so re-tints are stable and never double-lerp; skips
  `noHighlight` selection markers whose Basic materials it never touches)
  and a `UnitDamageFx` view with two single instanced draws (smoke +
  embers, one instance per damaged hull, phase-hashed rise/flicker by unit
  index — no per-frame rng, rebuilt every tick from state).
- `combatFx.ts` owns the damage array (sized to the roster like aim pose,
  persistent like scorch — `clearTransients` and exaggeration re-snaps
  never reset it) and splashes hulls on every explosion; smoke/embers tick
  inside `update` from the internal elapsed clock.

Important decisions: damage is visual-only by design (hulls are never moved
or killed — matching how scorch never traps and blasts never shove, so
patrol/movement code is untouched and `TerrainCanvas` needed no changes);
charring rewrites existing Lambert colors in place on impact only, never
per frame; the two extra instanced draws hold the scene budget (existing
scene-size assertions still pass). No HP bars, no wrecks — out of scope
for "show damage".

Tests: `unitDamage.test.ts` pins zero-init, point-blank hits, linear
falloff to the radius edge, nearest-first ordering, accumulation, the
clamp at 1, and rng-free determinism; `unitDamageFx.test.ts` pins the
char endpoints, monotonic darkening with saturation pin, stable re-tints,
marker immunity, and smoke/ember gating with deterministic rebuild;
`combatFx.test.ts` asserts splashes accumulate into visible smoke on bare
groups and char real `buildUnits` hulls while surviving
`clearTransients`. `yarn typecheck` and `yarn test` pass (170 core +
118 web tests).

### Task 4 — Layered tree fires (done)

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

### Task 5 — Believable blast scorch + tiny terrain dents (done)

Confirmed first: yes, the brown blotches are projectile explosions. Every
shell/bolt impact ends in `CombatFx.explode` → `scarGround`, which appends
one `addScorchMark` decal (core `destruction.ts`, capped at 48,
oldest-eviction, session-persistent) rendered as a single instanced
`CircleGeometry` disc. The old disc was one solid tone
(`tone = 0.17 − intensity·0.12`, flat brown) with a hard 18-gon circular
silhouette — that is exactly the "mud" read: uniform color, perfect circle,
no char, no edge. Nothing else paints brown on the ground (tree fires are
cones/embers/smoke, unit damage tints hulls only), so the suspect list was
one item long.

Fix, all deterministic and visual-only for pathing (README guarantee kept —
core A*/seating still read the static heightfield; dents live only in the
terrain mesh + `groundY` seating, so a unit parked in a bowl still drives
out and bowls never trap):

- Two-tone baked texture (`craters.ts`, new): one shared 128² byte-baked
  `DataTexture` (no DOM, so node tests cover it) with a near-black charred
  center (`SCORCH_CORE_RGB`) fading to a dark burnt-brown rim
  (`SCORCH_RIM_RGB`, red > green > blue throughout — burnt, not mud) and an
  irregular feathered edge from a baked angular wobble
  (`scorchEdgeRadius`). Still one instanced draw; 28-gon disc for a rounder
  silhouette.
- Per-mark variety (core `destruction.ts`): `ScorchMark.seed` (position-hash
  `scorchSeed` when absent, so old marks stay deterministic),
  `scorchAnisotropy` (±14% area-preserving elliptical squash) and
  golden-angle + seed rotation in `syncScorch`, so overlapping blotches never
  share a silhouette. Instance colors are now near-white warm multipliers
  (`scorchShade`: heavier blasts scar darker) — the texture gradient carries
  the darkness, kinds keep their ordering.
- Tiny terrain flatten (`craterDepthForIntensity` ≤ 1 height unit ≈ 3.6
  world units at default exaggeration, smooth `(1−t²)²` bowl,
  `craterDepthAt` capped at 2 so overlaps never dig pits): `CombatFx`
  reports each impact through the new optional `CombatEnv.dentTerrain` hook,
  and `TerrainCanvas` owns a ≤48 crater list (evicted with the scorch cap),
  recomputing mesh Y from map − dent (`applyCraters`, pure function of
  map + craters + exaggeration, so re-snaps re-run it instead of
  accumulating). `groundY` dips by the same dent so scorch decals, pings,
  and the probe sit inside the bowl; unit hulls keep core seating (they ride
  ≤3 units proud over a direct hit — invisible at demo scale).
- `selectionFx.scorchToneRGB` now delegates to core `scorchDisplayRGB`
  (baked char × shade) so the contrast policy can't drift from the render;
  white/cyan still clear AA easily on the darker scorch.

Important decisions: denting the real mesh instead of faking a bowl in the
decal keeps grazing-angle views honest (a painted bowl goes flat edge-on);
per-blast normals are deliberately not recomputed (sub-degree lighting
change under a dark char decal — the canvas still recomputes on re-snap);
no second instanced char-core layer (the baked gradient holds the draw-call
budget at one).

Tests: core `destruction.test.ts` pins seed determinism/range, seed
fallback, elliptical area preservation, shade ordering with burnt-not-mud
channels, crater depth cap + bowl profile + overlap cap; `craters.test.ts`
(new) pins edge irregularity bounds, texel char→rim→transparent ramp,
byte-bake center/corner, texture sharing/disposal, and mesh dents (no-op
when empty, center dent vs spared rim, exaggeration scaling, re-run
reproducibility); `combatFx.test.ts` asserts one ≤1-unit dent per scar,
near-white warm instance tints, and elliptical instance scales.
`yarn typecheck` and `yarn test` pass (177 core + 132 web tests).
