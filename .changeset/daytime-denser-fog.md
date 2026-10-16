---
"@scorched-3d/web": patch
---

More fog in daytime: denser distance haze plus more numerous mist banks

## Task writeup

Day maps read too clear: the distance fog was a single shared range tuned for night readability, and the day ground-fog was a sparse whisper of 12 faint banks. Daytime now gets its own denser fog range and a fuller set of mist banks, while night keeps exactly its previous look.

## What changed

- `apps/web/src/renderer/night.ts`: `DayNightLighting` gains `fogNear`/`fogFar`. Day runs 2800/9500 (was the shared 3600/12400); night keeps 3600/12400. `applyDayNight` now writes the range to `scene.fog` plus the terrain/water shader uniforms on every toggle (plain values, not aliased like the fog color, so each target is written).
- `apps/web/src/renderer/TerrainCanvas.tsx`: the opening-frame fog range seeds from `dayNightLighting(options.nightMode)` instead of hardcodes.
- `apps/web/src/renderer/dayFog.ts`: 12 → 18 mist banks, peak opacity 0.10–0.20 → 0.12–0.28. Min separation 700 → 520 (18 banks cannot hold 700 on this footprint — verified empirically), and min lift 6 → 8.
- Tests: `night.test.ts` pins the new preset values, asserts day runs denser than night, and checks the range lands on scene fog + both shader materials in both toggle directions. `dayFog.test.ts` updates the count/peak contract bounds and pins the lift-clears-bob invariant.

## Decisions

- Distance fog and mist banks together, not one or the other: "more fog in daytime" reads as atmosphere, and the two systems stack (far haze + near ground mist) without either becoming a blanket.
- Night untouched by design: the old shared range becomes the night preset, so the moonlit look is pixel-identical to before.
- Min lift raised to 8 as a root-cause fix, not a test tweak: with more banks, a low-lift + wide-radius draw dipped 0.4 units under the surface at the bottom of the drift bob. Max bob is 6.72 (`DRIFT_RADIUS * 1.4 * 0.1`), so the old floor of 6 never actually guaranteed the "hovers above the surface" invariant the test asserts.
- Sibling `nanolathe` repo checked for inspiration: its fog is fog-of-war (unexplored shading), not atmospheric, so nothing carried over.
