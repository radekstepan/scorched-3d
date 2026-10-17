---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Fix the ~3s UI lockup when switching to the Unit Folio. Diagnosis (headless vitest probe): every folio mount — and every roster click — synchronously regenerated the full Greenreach map and composed its entire 5120x4096 (84 MB) albedo (~750ms CPU), then uploaded it to the GPU with mipmaps while also recreating the WebGLRenderer and recompiling shaders. The preview plane only ever samples a ~90-cell patch of that map.

Core: add `composeAlbedoWindow(map, tileX, tileZ, tilesW, tilesH)` (origin/size clamped, at least one tile) and reimplement `composeAlbedo` on top of it with identical texels. The inner loop reads palette bytes directly instead of allocating a per-pixel RGB tuple, which also speeds up the battlefield's full-map compose.

Web: `buildPreviewTerrain` now composes only the tile window the plane samples (~1440x1440, ~8 MB) and caches the deterministic CPU-side map/albedo per session, so repeat visits and roster switches skip generation entirely; each build still mints fresh GPU handles so per-mount disposal stays safe. New `subject.ts` bundles everything a roster switch replaces (model, Stumpy comparison, animation rig, fitted measure grid), and `UnitFolio` splits its mount effect (renderer/scene/terrain, built once) from a roster effect that swaps just the subject, disposes its predecessor, and reframes. Cold folio entry drops from ~750ms to ~160ms CPU with a 10x smaller texture upload; warm builds take ~8ms and roster clicks no longer recreate the renderer.

Decisions: window UVs are texel-aligned to tiles rather than stretched across the full map (a ~0.3% scale correction, visually identical); the cache holds one deterministic entry so it cannot grow; StrictMode safety comes from the mount effect fully owning setup/teardown while the kind effect only calls the current swap closure. No README change: behavior and controls are unchanged, only load cost.

Verification (no Playwright): new core tests pin window/full-texel equivalence and clamping; new folio tests pin the sampled window, in-bounds UVs, cache sharing/invalidation, subject contents, and disposal; updated folio contracts pin one renderer/terrain build per visit with per-kind subject swaps. Full core suite (765 tests), full web suite (961 passed; the single failure is the pre-existing, unrelated `deployPages` main-vs-master branch-name mismatch), and typechecks for both workspaces pass.
