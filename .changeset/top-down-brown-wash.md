---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Stable top-down ground color: the brown wash that flooded the map in top-down view (and shifted with camera angle) was the slope/rock blend reading a view-space normal as world-up. The terrain vertex shader now passes a world-space normal, so the rock blend, hemisphere mix, and sun dot are stable from every angle — steep cliffs stay brown, flat grass stays green.

## Task writeup

# Task 141 — Top-down brown wash was view-dependent lighting, not ground texture

Reported: from the top the world reads almost all brown; the brown shifts
with viewing angle. Suspects were an extra mud texture or misapplied tile
ramp — but the tile/palette path is stable: `paintTile` + `TILE_RAMPS` bake
a fixed per-tile albedo (`composeAlbedo`), and nothing in
`packages/core/src/terrain/` depends on the camera.

Root cause was one line in `terrainVertex` (`apps/web/src/renderer/shaders.ts`):

- The vertex shader fed `vNormal = normalize(normalMatrix * normal)` —
  view-space — while the fragment shader treats `N.y` as world-up in three
  places: `slope = 1.0 - N.y` (brown rock blend), the
  `mix(groundColor, skyColor, N.y * 0.5 + 0.5)` hemisphere, and
  `dot(N, sunDir)` where `sunDir` is a world-space uniform.
- Top-down, the camera looks along world −Y, so a flat ground normal
  (0,1,0) lands near the view-space YZ plane: `N.y ~= 0` → `slope ~= 1` →
  full brown rock on flat grass. Tilt oblique and the same ground reads
  greener. Exactly the reported symptom.

Fix (one line + comment): `vNormal = normalize(mat3(modelMatrix) * normal)`.
The terrain mesh carries an identity transform with `computeVertexNormals`,
so this is the true world-up normal; `mat3(modelMatrix)` keeps it correct
even if the mesh ever moves. No palette, tile, threshold, or uniform
changes — the rock thresholds now simply evaluate against the slope they
were designed for. Water fresnel/spec still (correctly) use view vectors;
only ground tint was affected.

Tests: `shaders.test.ts` gains a `view-independent ground tint` suite (2
cases, GLSL-contract style matching the file): the slope line still reads
`N.y`, the `vNormal =` assignment line contains `modelMatrix` and none of
`normalMatrix`/`modelViewMatrix`/`viewMatrix`/`cameraPosition`, and the
fragment sun/hemisphere terms still dot world-space `N` against `sunDir`.
Both cases failed before the fix (authentic red: `normalMatrix` in the
assignment) and pass after.

## Verification

- Focused `shaders.test.ts`: 21/21 pass (2 new).
- `yarn test` — 574 core + 651 web, all pass.
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules; unit/integration only).
