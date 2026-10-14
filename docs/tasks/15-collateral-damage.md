# Task 15 — Graduated collateral damage (burning forests, chipped rocks)

## Prior behavior

Every impact did two binary things: stamped a dark scorch disc and felled
nearby trees/rocks straight to stumps/rubble (task 09). Anything inside the
blast radius popped to its end state in one frame, so fresh battlefields
read as oddly pockmarked — a "brown hole" where a forest stood, with no
fire, no smoke, no half-destroyed or knocked-over trees in between.

## New damage model

Trees now burn through timed states; rocks chip through levels:

- **Trees:** `intact → burning → smouldering → toppled | stump | snag`.
  A blast flattens its core (inside 45% of the radius) instantly to a rolled
  terminal — toppled (trunk on its side, crown sprawled past it), stump, or
  snag (charred standing trunk, crown burnt away) — and ignites the fringe.
  Burning trees (6 s, flame cone + smoke + ember canopy + pooled-light glow)
  age into smouldering (8 s, shrunken charred crown, smoke only), then
  resolve to a rolled terminal that persists for the session like scorch.
- **Spread:** burning trees older than 2 s ignite intact neighbours within
  70 units at 0.15/s per pair, so fringe fires creep a little before they
  burn out. Spread is cap-aware and never exceeds the flame budget.
- **Rocks:** `intact → chipped → cracked/displaced → buried`. Blast cores
  (inner half-radius) deal two levels, the fringe one; buried rubble matches
  the old felled pose so old battlefields still read.
- **Scorch:** same 48 persistent decals, re-toned warmer (red > green >
  blue char instead of neutral gray) so burnt ground reads as scorch, not
  mud. No geometry change — deliberately out of scope next to item 5
  (selection outline), which is untouched.

## Timings, visuals, caps

- `BURN_DURATION = 6`, `SMOULDER_DURATION = 8` (≈14 s impact → wreck).
- `MAX_FIRES = 24` flame cones, `MAX_SMOKE = 48` puffs: one instanced draw
  each, compact in-place fill, no per-frame allocations (shared dummy,
  index phase-hash flicker instead of rng). Burning past the cap
  fast-forwards the oldest fire to smoulder (eviction of state, never loss).
- Lights: no new lights — ignitions kick the existing 2-light pool via
  `CombatFx.glowAt()` (shared with muzzle/explosion pops, dimmest wins).
- Scorch 48 / shots 6 / explosions 8 caps unchanged.

## Decisions

**Persistent field, transient views.** Damage lives in a caller-owned core
`DamageField` indexed by feature id; flame/smoke meshes, poses, and tints
are views rebuilt from it. `clearTransients()` blanks flames (rebuilt next
tick at the new heights) but never touches the field — only regen drops it.
Exaggeration re-snaps re-seat from the field, so burns survive the slider.

**Core stays framework-free.** The state machine, timers, severity splits,
spread, and caps are pure core (`destruction.ts`) covered by vitest;
`features.ts` (posing) and `fireFx.ts` (instanced views) are thin three.js
over it, headless-tested like `combatFx.ts`.

**Flatten, don't remove (extended).** Task 09's rule generalizes: every
terminal keeps an instance in the buffers (lying trunk, stump, snag, sunk
rubble) — no index invalidation, no holes. Per-instance char colors ride
the existing instanced meshes (white base tints at build).

**Determinism where it matters.** Transition rolls and spread consume a
caller-passed rng (seeded `mulberry32` in tests); terrain determinism is
untouched — damage uses runtime entropy, never the map streams. One
deliberate nondeterminism: live blasts roll terminals with `Math.random`,
same as the existing impact scatter.

## Files

- `packages/core/src/units/destruction.ts` — `TreeDamage`/`RockDamage`,
  `DamageField` + `createDamageField`, `BURN/SMOULDER_DURATION`,
  `MAX_FIRES/MAX_SMOKE`, `SPREAD_RATE/RADIUS/MIN_AGE`,
  `TOPPLE_FRACTION`, `igniteTree` (cap + oldest-eviction),
  `applyBlastToTrees`/`applyBlastToRocks` (core-vs-fringe severity),
  `tickDamage` (burn → smoulder → terminal + spread events).
- `packages/core/src/units/destruction.test.ts` — +6 cases: full pipeline,
  core-flatten vs fringe-ignite, fire cap + eviction + terminal rolls,
  spread reach, rock proximity levels, re-snap preservation/idle-terminal.
- `apps/web/src/renderer/features.ts` (new, extracted from
  `TerrainCanvas.tsx`) — `buildTrees`/`buildRocks` (+ white base tints),
  `placeFeatures` (now takes the field), `writeTreePose` (6 states:
  ember canopy, shrunken char crown, lying trunk, stump, snag),
  `writeRockPose` (4 levels), `treePositions`/`rockPositions`.
- `apps/web/src/renderer/fireFx.ts` (new) — `FireFx`: instanced flames
  (burning) + smoke (burning/smouldering), flicker/rise from index-hashed
  elapsed, `update`/`clearTransients`/`dispose`, no lights of its own.
- `apps/web/src/renderer/combatFx.ts` — env `fellFeatures` →
  `blastFeatures`; new `glowAt()` pool kick for ignitions; scorch tint
  warmed toward ember brown; header comments updated.
- `apps/web/src/renderer/TerrainCanvas.tsx` — owns the `DamageField` +
  `FireFx`; `blastFeatures` applies core severity, re-poses only changed
  indices, glows ignitions; tick advances `tickDamage`, poses transitions,
  refreshes fire; exaggeration/dispose paths preserve/drop correctly.
- Tests (web): `features.test.ts` (4: topple lie, char/stump crowns,
  re-seat preservation, rock levels), `fireFx.test.ts` (3: flame/smoke
  split, view caps, clear-then-rebuild), `combatFx.test.ts` (env rename +
  glow pool test).
- `.changeset/collateral-damage.md` (minor), `README.md` + 
...[truncated 911 chars]
