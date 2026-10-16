---
"@scorched-3d/web": patch
---

Fireflies: gentle pulsating glow instead of harsh flashing, and every mote now reflects against the terrain and the trees — not just the few near a roaming light.

## Task writeup

Task: "The fireflies look 'flashing' at the moment. It should be gentle pulsating glow and all of them should reflect against the terrain and trees, not just those close to the trees."

### Root cause

- Flashing: the pulse curve was a cubed sine (`s³`), so each mote sat dim most of its cycle and flashed briefly, at fast 0.5–1.4 Hz rates with an 0.08 ember floor — a strobe duty cycle, not a glow.
- Partial reflections: only 6 pool slots existed for 90 motes (6 roaming PointLights + 6 mirrored terrain-shader pools), and trees — Lambert materials lit only by scene lights — caught just those 6 hotspots. Most of the swarm was pure decoration with no ground/tree reflection at all.

### What changed (`apps/web` view only — no core change)

- `fireflies.ts`: the pulse is now a pure slow sine (even breath, half the cycle waxing) on a high 0.75–1.0 floor at 0.12–0.32 Hz rates (~3–8 s period), following nanolathe's fire-flicker recipe (bounded sine, high floor, per-source phase). New `FireflyFx.writeField` mirrors every mote's live position + own pulse glow into the shared shader field each tick, gated by night; new `spliceFireflyTreeVertex/Fragment` + `applyFireflyTreeGlow` inject the same pool loop into Lambert tree materials via `onBeforeCompile` (own `vFireflyWorld` varying with instancing support, emissive add, shared uniform aliasing, distinct program-cache key). New constants: rate band, glow floor/amp, pool tint literal, and `FIREFLY_POOL_SHARE = 6/90`.
- `shaders.ts`: the terrain term is now `fireflyPools[90]` / `fireflyGlows[90]` with the same 38-unit falloff and soft tint, scaled by the `(6.0 / 90.0)` budget share so the full-swarm total stays at the previously tuned lamplight level.
- `features.ts`: `buildTrees` takes an optional firefly field and applies the glow injection to trunk/canopy/pine materials (omitted → byte-identical behavior).
- `TerrainCanvas.tsx`: field uniforms sized by `FIREFLY_COUNT`, aliased into the tree materials at build time, filled by one `writeField` per tick (replacing the 6-slot pool mirror; the 6 real PointLights stay for dynamic Lambert objects like units/rocks).
- Tests: even-duty pulse test, slow-rate placement test, high-floor glow band test, one-slot-per-mote + budget-share shader-mirror tests, full-field `writeField` tests (positions track sprites, per-mote glows, night gate, tail zeroing), vertex/fragment splice tests, uniform-aliasing + cache-key tests, `buildTrees` injection test, and updated night canvas-wiring assertions.

### Decisions

- Bounded sine + high floor (nanolathe precedent) instead of retuning the cubed curve: cubing inherently creates a flash duty cycle; only a pure sine breathes evenly.
- Mirror all 90 motes as shader uniforms instead of adding real lights: per the three.js guidance each active light adds shader complexity, and 90 PointLights would blow the WebGL light budget — the uniform-field approach costs one 90-iteration fragment loop on two materials with a single per-tick CPU mirror.
- Preserve the total light budget via the 6/90 per-mote share: the previous task carefully tuned total brightness down, so spreading pools over the swarm must not multiply ground light ~35x (brighter-always glow × 15x slots); clusters of motes now read about as bright as one old pool did.
- Trees via `onBeforeCompile` emissive injection aliasing the terrain's uniform objects: one mirror updates both surfaces, the glow fogs downstream like the rest of the bark, and the custom cache key keeps unmodified Lambert materials (rocks, units) on their own program.
