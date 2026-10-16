---
"@scorched-3d/web": patch
---

Firefly glow: motes no longer spawn inside tree crowns, and each firefly now pools a gentle, small, distance-fading halo instead of two muzzle-blast-order floodlights.

## Task writeup

Task: "Some fireflies look 'stuck' in a tree and illuminate an area too much. I want gentle illumination of a small area fading away from all the fireflies."

### Root cause

- Stuck motes: `placeFireflies` scattered each mote uniformly in a 42-unit disk around its anchor tree, so ~11% of anchors landed inside the trunk/canopy (round crowns reach ~18 units out at trunk/canopy heights). Those motes then orbited the wood forever, reading as "stuck".
- Over-illumination: the two ground pools ran at muzzle-kick order (peak 2600, range 420, shader half-glow radius 110) with a hot (0.66, 0.88, 0.32) terrain tint — one stuck firefly could floodlight half a forest.

### What changed (`apps/web` view only — no core change)

- `fireflies.ts`: placement now rejection-samples each mote (up to `FIREFLY_PLACE_TRIES = 8`) until it clears every trunk by `FIREFLY_TREE_CLEAR = 20`; in dense stands with no clear gap it pushes out to the clearance ring instead of inside the wood. Still a pure function of (rng, trees, groundY), so seeded determinism holds. Pools went 2 → 6 strided across the swarm, retuned to lamplight order (peak 320, distance 150, physical decay 2, shader half-glow radius 38), and each pool now breathes with its own mote's blink via the shared `fireflyGlow` helper (new `poolGlows()` accessor) instead of the swarm mean.
- `shaders.ts`: the terrain mirror is now `fireflyPools[6]` / `fireflyGlows[6]` with the 38-unit falloff and a soft (0.30, 0.40, 0.14) tint.
- `TerrainCanvas.tsx`: uniform arrays sized by `FIREFLY_POOL_COUNT`, mirrored each tick and gated by night mode as before.
- Tests: clearance assertions over several seeds, a dense-stand graceful-degradation test, per-pool blink-tracking test, gentle/small regression guards (peak/distance/decay/radius/tint), and updated shader-mirror + night-wiring assertions.

### Decisions

- Clear all trees, not just the anchor tree: forest cells sit 16 units apart with overlapping crowns, so clearing only the anchor would still strand motes in neighboring wood. Checked the sibling `nanolathe` repo for inspiration, but its only "firefly" hit is fire-flicker lighting with no placement concept — the clearance ring is bespoke.
- 6 pools instead of 2: with small-radius halos, two pools would leave most of the 90-mote swarm glowless; six strided pools spread lamplight across the whole swarm while total output still drops ~8x. Per-pool (not mean) breathing makes each halo visibly belong to its own flashing firefly.
- Drift untouched: anchors hold 20 units out while max drift is ~12, so motes can only graze a canopy edge mid-orbit — a natural flyby, not a stuck mote.
