---
"@scorched-3d/web": patch
---

Drifting distance fog: the terrain/water haze now breathes slowly instead of sitting frozen

## Task writeup

The ground-fog mist banks (`dayFog.ts`) already wander, but the atmospheric distance fog in the terrain and water shaders was a frozen linear blend of camera distance — distant haze never moved. Both fragment shaders now modulate the fog factor with a slow wind-blown value-noise field (`fogWobble`), reusing the existing `wNoise` helper and `time` uniform, so far banks crawl and breathe like slow weather.

## What changed

- `apps/web/src/renderer/shaders.ts`: `terrainFragment` and `waterFragment` multiply the fog factor by `(1.0 + fogWobble * 0.35)` where `fogWobble` is a `wNoise` sample over `vWorld.xz * 0.0009` scrolled diagonally by time (~0.01 cells/s, a full cell in ~2 minutes). Added the `FOG_DRIFT_*` constants plus `fogDriftFactor` / `applyFogDrift` JS mirrors following the existing water-noise mirror pattern.
- `apps/web/src/renderer/shaders.test.ts`: new "drifting distance fog" block covering determinism, bounds (±17.5%), slow pace (a second barely shifts it, a minute visibly does), the fog-free-near-ground guarantee (0 stays 0), clamping, and GLSL/JS literal parity in both shaders.

## Decisions

- Relative (multiplicative) modulation rather than an additive offset, so fog-free foreground pixels stay fog-free and only distant haze moves.
- No new uniforms and no `TerrainCanvas` changes: the drift reuses the `time` uniform already updated every frame.
- Left `scene.fog` (THREE.Fog for standard materials like units) static — the terrain/water haze dominates the frame, and animating the shared scene fog would need per-frame uniform churn for little visual gain.
- Inspiration check: the sibling `nanolathe` repo's fog is fog-of-war/visibility (Go backend), not atmospheric rendering, so nothing carried over beyond confirming the noise-field approach already established in this codebase.
