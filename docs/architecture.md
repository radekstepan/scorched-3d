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
| `apps/web/src/App.tsx` | HUD composition, preset/seed state, minimap with team-outlined unit markers and HQ fort squares, team + HQ + unit legend, probe readout. |
| `apps/web/src/renderer/TerrainCanvas.tsx` | Three.js scene: terrain mesh, water, sky, trees/rocks, static units, team HQ forts with reinforcements, hover picking. |
| `apps/web/src/renderer/units.ts` | Low-poly TA unit meshes (Commander/Stumpy/Flash/Hammer) with elevating barrel pivots + muzzle tips, team ground rings, and exaggeration re-snapping. |
| `apps/web/src/renderer/camo.ts` | Subtle procedural hull camo: one shared near-white grayscale texture per kind bound as hull-material map (hue-preserving, no hull tint), deterministic bake. |
| `apps/web/src/renderer/shaders.ts` | Terrain/sky/water GLSL shaders. |
| `apps/web/src/index.css` | Visual tokens and HUD panel styling. |
| `packages/core/src/branding.ts` | Product identity: `APP_NAME`, `APP_VERSION`, tagline, description. |
| `packages/core/src/units/place.ts` | Seeded roster placement on dry, gentle, separated ground, mustered as even Blue (west) / Orange (east) team halves on opposite map sides. |
| `packages/core/src/units/movement.ts` | Patrol routes + forward-drive hull physics with steep-slope clamp/skip, goal-aware lateral separation steering (ordered hulls never shoved backwards; exits glide on a decaying coast while unordered drive pauses, so close hulls settle instead of chattering on the stop radius), an ordered-hull spacing floor, and self-defense memories that tick under orders without steering (arrival rejoins the patrol loop). |
| `packages/core/src/units/retaliation.ts` | Retaliation AI: per-hull threat memory (attacker + last-known position + countdown) with engage/disengage hysteresis, a patrol-anchor leash, and per-kind weapons-range stand-off; idle hulls pursue through the movement drive, ordered hulls record a self-defense memory the guns answer without steering (converting to a pursuit on arrival), and holding hulls refuse. Shell wounds investigate past the bolt gates (`SHELL_ENGAGE_RADIUS`, hunt leash carried on the memory) through the same pipeline, so shelled hulls turn on the firing position. Hunt acquisition points idle hulls at nearby live enemies on a wider leash through the same pipeline; team-advance position memories (attacker -1, disengage-exempt, leash kept across ticks) push the last-known enemy direction after contact is lost on the wide `TEAM_ADVANCE_LEASH_RADIUS` (roughly a full map width, so mid-map contacts and deep HQ sightings march instead of dying on the hunt leash). HQ-structure assaults (`seekStructure`, `structure: true`) hold the fort push through stray splashes and retarget onto a consistent challenger after `HQ_DEFENSE_HITS` hits in a row from one gun — self-defense first, the fort after. |
| `packages/core/src/units/strategy.ts` | Strategic skirmish layer: health-weighted local odds (allies around me vs enemies around the threat) gating hunt acquisition and holding outnumbered pursuits in place for backup, squad-focus + wounded + threat + sticky target scoring for hunts and gun aims, with the engaged gun target counting as admitted within a range-gate margin so range-edge jitter holds the aim instead of flickering it. Peewee scouts probe anyway on wider scout gates (notice 1500 / leash 2000 / disengage 1650) so the squad engages what the scout finds. |
| `packages/core/src/units/intel.ts` | Shared team enemy intel: per-side, per-enemy last-known positions (hulls by roster index, forts by negative HQ-team key) with sim timestamps, fed by every hull's sightings plus damage alerts. Mobiles expire after `INTEL_MEMORY_DURATION` (60 s) unseen, forts never age, dead subjects drop, and a record whose subject moved on drops once a live teammate re-checks the empty spot (`INTEL_CONFIRM_RADIUS`); free hulls advance on their nearest remembered contact. |
| `packages/core/src/units/terrain.ts` | Bilinear seating, hull pitch/roll, and step blocking for movers. |
| `packages/core/src/units/pathfinding.ts` | Grid A* move orders with smoothing + formation fan-out, incl. walkable snapped formation targets. |
| `packages/core/src/units/facing.ts` | Hull turn rates and traverse-limited turret clamping, plus turn authority: rolling hulls turn at the full traverse cap while held hulls (stunned, pinned, spacing-held, stand-off facing) neutral-steer at a per-kind pivot floor. |
| `packages/core/src/units/combat.ts` | Ambient-skirmish weapon profiles and ballistic projectile math (muzzle velocity + gravity solver, range admission capped under half the map so HQs never take cross-map lobs), plus cross-team pair picking. |
| `packages/core/src/units/hq.ts` | Team HQ factory works: deterministic valley-floor siting (dry margin, map-relative high-ground cap, hall-clear exit lane, island fallback), leveled dirt construction pads + cleared (unpainted) exit lanes, honest blast splash, and the reinforcement clock (first release at 20 s, per-side cap of 4, weighted-random kinds with per-kind build times — stronger units rarer and slower). |
| `apps/web/src/renderer/hq.ts` | HQ factory view (production hall, monitor roof, chimney stacks, silo, workshop annex, framed sectional door, exit hall, team ring) with wreck pose. |
| `apps/web/src/renderer/hqFx.ts` | HQ manager: damage, spawn clocks, door-slide animation, release/kill/damage hooks. |
| `packages/core/src/units/destruction.ts` | Blast scorch + graduated collateral damage (tree burn states, rock levels, spread). |
| `apps/web/src/renderer/features.ts` | Tree/rock instanced posing per damage state, re-snap preserving. |
| `apps/web/src/renderer/fireFx.ts` | Transient instanced flame/smoke views over the damage field. |
| `apps/web/src/renderer/movement.ts` | Thin patrol/order driver: poses bodies from core movers, plus the retaliation entry point (`threatenUnit`, shell-aware with a same-team guard, writing the side's shared intel board on every hit — even when the victim is holding — so mates reinforce the firing position) fed by combat's threat hook and the per-tick hunt sweep (`sweepHunt`) that feeds the intel board from every live hull's eyes (spotting is passive — ordered and outnumbered hulls report without engaging — then prunes stale/dead/confirmed-gone records) and points idle hulls at live enemies (peewee scouts on wider scout gates, probing alone so their sightings focus the squad) — advances them toward their nearest remembered contact when no hunt is in notice on the wide team-advance leash, ranges scouts toward the enemy anchors while no intel exists yet (active recon), and shares a hull's live-HQ sighting team-wide while assaulting the spotted fort as a structure memory (per-enemy records, so hull and fort contacts coexist). Shelled victims also traverse their turret onto the live shooter (`CombatFx.trackThreat`, which never fires by itself). Obstructed fort shots assault through `seekStructure` (the sweep restores the assault when no hunt acquires, and `isFighting` reports live enemy grudges so engaged guns hold HQ fire). |
| `apps/web/src/renderer/selection.ts` | Click/box picking helpers for RTS selection. |
| `apps/web/src/renderer/selectionFx.ts` | Selection visuals: static white/cyan double ring + chevron beacon (no pulse/spin/bob), contrast policy, ring/beacon-only highlight (hull paint preserved), minimap dot style. |
| `apps/web/src/renderer/selectionIcons.ts` | Selection tray: pre-rendered memoized per-kind icons + (kind, team) grouping with team-color top borders. |
| `apps/web/src/renderer/occlusionFx.ts` | Occlusion x-ray: sampled camera→hull taps vs live heightfield + standing-tree volumes; blue silhouette ghost (selection cyan: true hull/turret outline + slight transparent fill, pose-mirrored) for hidden live units only (dead husks never ghost), hull paint untouched. |
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
