# Architecture

How Scorched 3D is built. Mirrors the sibling photomator repo's layout, minus the pieces this project does not need (no server, no UI package, no Playwright).

## Workspaces

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@scorched-3d/web`) | Vite application: HUD shell, view options, minimap, unit legend, and the Three.js terrain + unit renderer. Depends on `@scorched-3d/core`. |
| `packages/core` (`@scorched-3d/core`) | Framework-free game logic: product branding, TNT-style terrain generation (heightfields, tiles, palette, textures), and deterministic static-unit placement. |

There is no `packages/ui`: the web app is a single demo shell, so shared React components would be premature. There is no `apps/server`: all state is generated client-side per seed. Both can be added later following the photomator shape (`apps/*`, `packages/*` workspaces are already globbed).

## Key files

| File | Responsibility |
| --- | --- |
| `apps/web/src/App.tsx` | HUD composition, preset/seed state, minimap with unit markers, unit legend, probe readout. |
| `apps/web/src/renderer/TerrainCanvas.tsx` | Three.js scene: terrain mesh, water, sky, trees/rocks, static units, hover picking. |
| `apps/web/src/renderer/units.ts` | Low-poly TA unit meshes (Commander/Stumpy/Flash/Hammer) with elevating barrel pivots + muzzle tips, and exaggeration re-snapping. |
| `apps/web/src/renderer/shaders.ts` | Terrain/sky/water GLSL shaders. |
| `apps/web/src/index.css` | Visual tokens and HUD panel styling. |
| `packages/core/src/branding.ts` | Product identity: `APP_NAME`, `APP_VERSION`, tagline, description. |
| `packages/core/src/units/place.ts` | Seeded roster placement on dry, gentle, separated ground. |
| `packages/core/src/units/movement.ts` | Patrol routes + forward-drive hull physics with steep-slope clamp/skip, lateral separation steering, and an ordered-hull spacing floor. |
| `packages/core/src/units/terrain.ts` | Bilinear seating, hull pitch/roll, and step blocking for movers. |
| `packages/core/src/units/pathfinding.ts` | Grid A* move orders with smoothing + formation fan-out, incl. walkable snapped formation targets. |
| `packages/core/src/units/facing.ts` | Hull turn rates and traverse-limited turret clamping. |
| `packages/core/src/units/combat.ts` | Ambient-skirmish weapon profiles and ballistic projectile math (muzzle velocity + gravity solver, range admission). |
| `packages/core/src/units/destruction.ts` | Blast scorch + graduated collateral damage (tree burn states, rock levels, spread). |
| `apps/web/src/renderer/features.ts` | Tree/rock instanced posing per damage state, re-snap preserving. |
| `apps/web/src/renderer/fireFx.ts` | Transient instanced flame/smoke views over the damage field. |
| `apps/web/src/renderer/movement.ts` | Thin patrol/order driver: poses bodies from core movers. |
| `apps/web/src/renderer/selection.ts` | Click/box picking helpers for RTS selection. |
| `packages/core/src/terrain/types.ts` | Typed map model: presets, tiles, features, view options, placed units. |
| `packages/core/src/terrain/generate.ts` | Seeded heightfield sampling, feature stamping, tile painting, minimap, unit placement. |
| `packages/core/src/terrain/noise.ts` | Value-noise and FBM helpers. |
| `packages/core/src/terrain/palette.ts` | 256-color palette and per-tile color ramps. |
| `packages/core/src/terrain/texture.ts` | Albedo/height/minimap `ImageData` composition. |
| `packages/core/src/index.ts` | Public barrel export for `@scorched-3d/core`. |
| `scripts/sync-app-version.mjs` | Rewrites `APP_VERSION` from workspace versions (see Versioning). |

## Build notes

`@scorched-3d/core` compiles with `tsc -b` (composite project) to `dist/`; `@scorched-3d/web` resolves it through the workspace symlink, so `yarn build` must run at least once before `yarn dev` picks up core changes. Turbo's `build` task declares `dependsOn: ["^build"]` to enforce that order, and `typecheck`/`test`/`lint` all depend on `^build`. The web bundle stays single-file via `vite-plugin-singlefile` (`dist/index.html`).

TypeScript strictness follows `tsconfig.base.json` (including `noUncheckedIndexedAccess`), which is stricter than the original single-package `tsconfig.json`. Typed-array and palette indexing therefore carries `??` fallbacks at read sites; all are in-bounds by construction, so the fallbacks never fire — they only satisfy the checker.
