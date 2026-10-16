---
"@scorched-3d/web": patch
---

Daytime valley fog: low-lying ground hazes over on day maps

## Task writeup

Day maps stayed crystal-clear at close range: the distance fog only bites far out, and the 18 mist banks are scattered individuals, so the low ground between banks showed no fog at all. The terrain shader now layers a height-based valley-fog term onto the distance fog during the day — hollows, shorelines, and lake basins haze toward the fog color even right under the camera, while high ground and the night look are untouched.

## What changed

- `apps/web/src/renderer/shaders.ts`: terrain fragment gains a `valleyFog` strength uniform and a height term after the drifting-haze modulation — full at/below the waterline, smoothstepping to 0 over `VALLEY_FOG_SPAN` (24) height units above it, scaled by the `exaggeration` uniform so the band covers the same terrain at any height scale. Combined as `fog + (1 - fog) * valley * strength`, so far fog stays 1 and strength 0 is the identity. New `valleyFogFactor` / `applyValleyFog` JS mirrors follow the repo's GLSL/JS mirror pattern.
- `apps/web/src/renderer/night.ts`: `DayNightLighting` gains `valleyFog` — day 0.35, night 0. `applyDayNight` writes it to the terrain material on every toggle (guarded like the fog range).
- `apps/web/src/renderer/TerrainCanvas.tsx`: terrain material seeds `valleyFog` from the active day/night preset for the opening frame.
- Tests: `shaders.test.ts` pins the mirror (pooling below the waterline, clearing above the band, monotonic fade, exaggeration scaling, identity at strength 0, far-fog preservation), asserts GLSL literal parity for the span/combine lines, and pins the canvas uniform seeding. `night.test.ts` pins the day/night strengths and checks the write-through in both toggle directions.

## Decisions

- Terrain-only, not water: the water sheet sits at one constant height, so a height term there would be a flat constant rather than pooled fog (and lakes already get mist banks). The test pins `waterFragment` as valley-free so this stays deliberate.
- Day-only via the preset (night 0), same as the mist banks: the moonlit look stays pixel-identical, and strength 0 is mathematically the identity so there is no night risk.
- Band referenced to the waterline (`seaLevel * exaggeration`, already in-shader) rather than an absolute height: "low-lying" means low relative to the map's water, and it reuses existing uniforms with no new per-tick wiring.
- Sibling `nanolathe` repo checked for inspiration: its fog is fog-of-war visibility presentation, not atmospheric rendering, so nothing carried over.
