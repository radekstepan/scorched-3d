---
"@scorched-3d/web": patch
---

Day-map ground fog: a sparse scatter of soft white mist banks now drifts over day maps, pooled in the hollows. Each bank is a slow-wandering translucent billboard that breathes gently, adding depth to valleys and lake shores without ever blanketing the battlefield. The mist hides at night, when the firefly swarm takes over the atmosphere.

## Task writeup

Task: "Add subtle fog here and there, white fog on a day map."

### What changed (`apps/web` view only — no core change)

- `renderer/dayFog.ts` (new): the fog system, mirroring the `fireflies.ts` architecture (seeded pure placement + an Fx class owned by the canvas).
  - `placeDayFog(rng, worldW, worldD, count, surfaceY)` scatters 12 banks inside the map rectangle. Each bank keeps the lowest of 6 uniform candidates, so fog settles in hollows like real mist, and holds a 700-unit separation from other banks so they read as scattered individuals. Banks hover 6–20 units up, span 220–420 units wide at a 0.32 height ratio (low banks, not puffs), and peak at 0.10–0.20 opacity — subtle by contract.
  - The bank texture is a procedural radial puff with a wobbled rim (`dayFogAlpha`), baked into a `THREE.DataTexture` — no DOM canvas, so it works headless and stays unit-testable in the node test env.
  - `DayFogFx` owns one `THREE.Sprite` per bank (shared texture, per-bank material for independent breathing): unlit white, depth-write off so banks never clip each other or carve holes in the terrain. `update` drifts each bank on a ~90 s lissajous wander and breathes opacity between 65% and 100% of peak. `setNight` shows the mist by day only; `resnap` re-seats banks after exaggeration changes.
- `renderer/TerrainCanvas.tsx`: creates the fog after the fireflies (seeded `map.seed ^ 0xd9f0`, its own stream), ticks `setNight`/`update` alongside them, resnaps on exaggeration change, and disposes on teardown. The rest surface folds the water sheet in (`max(ground, waterY)`, only while the sheet renders — same condition as the water mesh), so banks over lakes read as lake mist instead of sinking under the sheet.

### Decisions

- Sprites over shader fog: the existing distance fog is a global blend, but the task wants discrete patches "here and there" — billboards give localized, art-directable banks without touching the terrain/water shaders.
- Day-only, no View-menu toggle: the task asks for white fog specifically on day maps, and night already has its own atmosphere (dark palette + fireflies); an always-on-by-day effect keeps the change minimal with no new UI surface.
- Hollow-seeking placement over uniform scatter: mist pooling in low ground reads natural and keeps banks off ridgelines where they would fight the skyline.
- Sibling `nanolathe` repo checked for inspiration, but its fog work is fog-of-war/LOS presentation (gray remap + dithered visibility cells), not atmospheric mist — no reusable pattern there, so this follows the local fireflies pattern instead.

### Tests

- `renderer/dayFog.test.ts` (14 tests): placement determinism, bounds/lift/size/peak ranges, pairwise separation, hollow-seeking (banks hug an off-center test bowl far tighter than uniform scatter), tiny-world fallback, drift bounds + slowness, opacity breathing range/period, puff-curve shape, texture bytes (white RGB, alpha tracks the curve), Fx day/night visibility, low translucent depth-write-off materials, drift/breath over time, resnap bounds, and dispose (group removed, materials + texture disposed).
