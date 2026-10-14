# Learnings

Distilled from per-task writeups in `docs/tasks/` across the initial 3-task run, the 4-task camera/controls/FX run, and the 4-task facing/destruction/movement/selection run. Read this before touching the monorepo layout, branding, terrain, units, camera, effects, movement, or selection so we don't repeat the same mistakes.

Task index:
- 01 — Turborepo migration (`docs/tasks/01-turborepo-migration.md`)
- 02 — Rename to Scorched 3D (`docs/tasks/02-rename-scorched-3d.md`)
- 03 — Static demo units (`docs/tasks/03-units-demo.md`)
- 04 — Keyboard pan (`docs/tasks/04-keyboard-pan.md`)
- 05 — Commander camera start (`docs/tasks/05-commander-camera.md`)
- 06 — FPS overlay (`docs/tasks/06-fps-overlay.md`)
- 07 — Units firing (`docs/tasks/07-units-firing.md`)
- 08 — Facing hulls + traverse-limited turrets (`docs/tasks/08-facing-turret.md`)
- 09 — Environment destruction (`docs/tasks/09-environment-destruction.md`)
- 10 — Unit patrol routes (`docs/tasks/10-unit-routes.md`)
- 11 — Selection + pathfinding (`docs/tasks/11-selection-pathfinding.md`)

## 1. Monorepo layout (from 01)

- **Budget for stricter shared configs.** Adopting photomator's `tsconfig.base.json` enables `noUncheckedIndexedAccess`, which surfaced ~30 latent indexing errors in moved terrain/renderer code. Fix at read sites with `??` fallbacks rather than relaxing the config — the reads are in-bounds by construction and behavior stays unchanged.
- **Core must be built before dev.** `apps/web` resolves `@scorched-3d/core` through workspace `dist/`; run `yarn build` once before `yarn dev`. Turbo's `^build` ordering only covers scripted tasks (`build`, `test`, `typecheck`), not `dev`.
- **`git mv` needs destinations pre-created.** Move files first, then write new files — otherwise rename detection gets clobbered.
- **Keep task boundaries.** Repo/scope identity (`@scorched-3d/*`, `APP_NAME` constant) belongs to the migration; user-visible copy belongs to the rename. Don't bleed one into the other.
- **Only add workspaces you need.** `apps/web` + `packages/core` is enough for a single demo shell with client-side state; `packages/ui` / `apps/server` would be dead weight. The `apps/*` + `packages/*` globs leave room to grow in photomator shape.

## 2. Branding and rename (from 02)

- **Package IDs stay.** `@scorched-3d/*` already match the adopted name and photomator's `@<repo>/<workspace>` convention; renaming them churns imports and the changesets fixed group for no user-visible benefit.
- **Derive, don't duplicate.** HUD renders `APP_NAME.toUpperCase()` and `APP_DOCUMENT_TITLE` is derived as `` `${APP_NAME} · Terrain` `` — one source of truth, with tests pinning the literal tab title so an accidental `APP_NAME` edit fails loudly.
- **Leave sibling references alone.** Remaining `nanolathe` strings are intentional: the `docs/tasks.md` sibling-repo path, historical notes in writeups, changeset descriptions, and the test's own guard regex.
- **Sync-regex is narrow.** `scripts/sync-app-version.mjs` targets only the `APP_VERSION` line, and `syncAppVersion.test.ts` fixtures use synthetic branding source — adding constants near `APP_VERSION` is safe.

## 3. Units and terrain (from 03)

- **Nanolathe unit identity is retail ids.** Canonical names live in `internal/content/compile_unit.go` (`UnitDef.UnitName` like `ARMCOM` / `ARMSTUMP`); grepping quoted `"ARM*"` ids in `*_test.go` is the fastest confirmation.
- **New RNG streams get a fresh XOR constant.** Unit placement uses `seed ^ 0x9e37`, separate from terrain/feature streams, so new content never perturbs the existing heightfield and old determinism snapshots keep holding.
- **Hook regen via `generateMap()`.** Putting derived content (`units`) directly on `TNTMap` inside `generateMap()` means preset change + REGEN re-place units with zero App wiring — the existing `useMemo(generateMap)` picks it up.
- **Surface layers share three touchpoints.** Anything sitting on terrain (trees/rocks/units) needs: build per map, re-snap on exaggeration change, dispose on unmount. A future shared "surface attachment" helper could collapse this duplication.
- **Guarantee the roster with tiers.** Strict placement invariants (dry, gentle, empty, separated) hold on most seeds, but relaxed + scoring-fallback tiers are still needed to never ship a short roster; tests assert the relaxed bounds so the fallback can't silently regress.
- **Units are gameplay, not dressing.** They stay visible when the Features toggle is off.

## 4. Camera controls and testability (from 04–05)

- **Framework-free helpers stay node-testable.** `cameraPan.ts` / `cameraStart.ts` / `fps.ts` / `combat.ts` hold all math/state with zero three.js-React imports, so vitest covers them without WebGL. `combatFx.ts` goes one step further: the manager drives a real `THREE.Scene` headless (no renderer needed).
- **Web needed its own vitest lane.** `apps/web/vitest.config.ts` + a `test` script reusing the already-hoisted vitest binary (no new deps) unblocked renderer-logic tests; core + web suites now run via `yarn test` (44 core + 49 web after task 07).
- **Pan in screen space, not world axes.** Ground-projected camera forward + `forward × up` stays correct after orbiting (matches nanolathe's held-arrow scroll pass). Orbit `maxPolarAngle` keeps the camera above the horizon so the projection never degenerates; keep a world-north fallback for the overhead case anyway.
- **Frame-rate independence via clamped `dt`.** `clock.getDelta()` with a 50ms clamp (and `elapsedTime` read after the delta call) drives pan, combat, and FX; FPS itself measures on `performance.now()` so it includes pan/exaggeration work independent of the `dt` clamp.
- **Zoom-proportional pan + edge margin.** Speed `distance × 1.2/s` with diagonal normalize (diagonals = cardinal speed, opposites cancel); clamp the orbit target to map + 25% margin so players can look past the shoreline without getting lost. `preventDefault()` pan keys, ignore editable controls, clear held keys on blur.
- **Commander start = ray through unit.** Camera sits on the center-through-unit ray at `edge + 350`, outside the map on whichever side the commander spawned; dead-center falls back south. Height `anchor + 0.25 × maxDim` matches the old eye height and stays inside orbit `maxDistance`. Determinism is free (seeded `placeUnits()` + first-commander pick, no RNG).
- **Re-snap by vertical translation, not re-aim.** Shifting camera + target by the anchor's ground-height delta preserves orbiting/panning done since load; combat transients are cleared instead (mid-flight endpoints were sampled at old heights). Take a minimal structural field (`width/height/heights/seaLevel/units`) and define your own cell-pixels constant rather than importing core — keeps helpers dependency-free.
- **Nanolathe has no camera framing to borrow.** Its spawn logic is battle-state, not opening-camera; don't force inspiration — follow local orbit-camera idioms and say so in the writeup.

## 5. HUD overlays and ambient combat (from 06–07)

- **Write overlays via direct DOM, not React state.** The FPS pill updates `textContent` on a 500ms report window (2×/sec) so the canvas subtree never re-renders at frame rate; `pointer-events-none`, bottom-right placement (clear of header/columns/footer), `tabular-nums` stops digit jitter. Fixed window beats EMA here: two numbers of state, smooths hitches without hiding sustained drops. Guard backward clock jumps + non-finite timestamps.
- **Split combat into pure core + thin three manager.** `packages/core/src/units/combat.ts` (profiles, `pickSkirmishPair`, `nextShotDelay`, `flightDuration`, `projectilePosition` lerp + `sin(pi·t)·arc` lift, muzzle offsets) is fully unit-tested; `combatFx.ts` only schedules/animates/disposes. Collapsing the weapon catalog to per-kind speed/arc + one interval scheduler stands in for per-slot reload timers; wall-clock timing via the loop's clamped `dt` (no fixed-tick sim phase in a rAF demo).
- **Borrow nanolathe's projectile families, adapt the rendering.** Cannon shells = ballistic arcing spheres, bolts = flat fast velocity-oriented boxes (mirrors `battle_sprites_projectiles.go` head→tail strokes); dynamic lights riding shots become a 2-light pool kicked at muzzle + impact, decaying ~0.2s. Cite the source files/spec sections in the writeup.
- **Cap everything.** Max 6 concurrent shots, 8 explosions (oldest evicted), 2 shared point lights, shared geometries; only small materials + spark buffers are per-effect and disposed on removal. Shots always "hit" near the hull with scatter — random ambient skirmish only, no health/damage model.
- **Compute muzzles from live state each shot.** Body position + facing per shot keeps recoil kicks (0.28s restore) and exaggeration re-snaps from desyncing guns. Commander has no barrel mesh, so its bolt leaves from chest height. No sound — visuals only.
- **Bump minor for visible features.** Tasks 04–06 were patches; ambient combat is user-visible enough for minor. Docs-only learnings updates need no changeset (precedent: `bbd4feb`).

## 6. Facing, destruction, movement, selection (from 08–11)

- **Turn hulls instead of gating fire.** A forward-arc fire gate would stall the ambient skirmish (most random pairs start outside any narrow arc). Turning the hull at a capped rate toward the target with the turret slewing only the clamped remainder keeps every engagement firing eventually while showing facing discipline; the turret clamp binds because the hull rate-limits. Turret always faster than hull = fine vs gross motion (from 08).
- **One posing place for aim.** `getTurret()` / `setUnitAim()` in `units.ts` own all hull/turret yaw; exaggeration re-snaps only move origins so aim survives. Commander reuses its whole upper torso as the "turret" (legs stay on hull). Muzzle + recoil use the absolute turret line (`muzzleYaw`), recomputed from live state each shot (from 08).
- **Pending-pair scheduler with fast retry.** `tryFire()` registers attacker→target and fires only when `canFire()`; misses retry in ~0.15s instead of a full ambient interval, so traverse delays never read as silence. Expose `totalFired` / `aimState()` readouts for tests/HUD (from 08).
- **Decals over vertex deformation.** True cratering fights the baked-geometry + shader pipeline and the exaggeration re-snap path; dark instanced discs (+1.2, polygon-offset) read as scorch at demo scale with one draw call and trivial re-seating via `reseatScorch()`. Persistent (session-lifetime, oldest-eviction at 48) instead of fading — the battlefield accumulates history (from 09).
- **Fell, don't remove.** Felled trees keep a stump trunk, felled rocks a sunk 0.35× rubble instance — no holes in instanced buffers, no index invalidation. Carry `userData.felled` sets + shared `writeTreePose()` / `writeRockPose()` helpers so re-snaps preserve felled state instead of resurrecting features. `fellFeatures` never touches unit groups; units are never moved by blasts (from 09).
- **Optional env hooks keep headless tests cheap.** `CombatEnv` (`groundY`, `fellFeatures`) is optional with no-op defaults so existing `CombatFx` tests construct unchanged; `clearTransients()` keeps scorch, `dispose()` removes it. Sync decals only on impact via a reused scratch object — no per-frame allocations (from 09).
- **Hulls belong to movement, turrets to combat.** In live play `CombatFx` never yaws a hull (`setExternalHull()` mode: hulls stay on travel heading, only turrets slew); headless tests keep internal-hull behavior so old traverse suites pass untouched. Tick movement before combat; on exaggeration change `clearTransients()` then `movement.resnap()` (movement X/Z is authoritative — reverse order restores stale recoil bases) (from 10).
- **Forward drive, not steering to the point.** Velocity runs along the hull with alignment grip (full speed lined up, ~0.3× spun around) so corners produce turning arcs at capped rates. Spacing stays slow/stop only (hold inside 30u, crawl inside 72u) — full avoidance is the pathfinding task's job (from 10).
- **Routes read the field, never reseed it.** `planRoutes` uses its own `seed ^ 0x3ec1` stream and only reads heights, so terrain/placement snapshots can't shift; waypoint 0 = spawn, rest on dry + gentle ground within 45 cells. Routes are derived per regen in the canvas, not stored on `TNTMap` (from 10).
- **Shift recoil anchors with the hulls.** The kick stores its restore point at fire time; a driving unit would restore up to ~15u backward. Each movement tick shifts active anchors by the hull delta via `shiftRecoilBase()` (from 10).
- **Top-notch pathfinding = A* + smoothing + formation.** 8-dir A* with corner-cut prevention, cardinal-1/diagonal-√2 costs, octile heuristic, deterministic `(f,h,z,x)` heap tie-break; greedy string-pulling smoothing that keeps the detours A* paid for; `nearestWalkable()` ring snap + straight-drive fallback so unreachable goals degrade instead of stranding; hex-ring `formationTargets()` so groups arrive as a line, not a pile. Arrival → hold, patrol never auto-resumes; orders suspend patrol without forking it (from 11).
- **Assert walkability on real maps, not just synthetic flats.** An x/z transposition in `cellSlope` nulled every detour and only real-map waypoint tests caught it; shoreline cells read as steep because the slope probe touches the water neighbour (same as `place.ts`) — tests must expect that (from 11).
- **Click resolution raycast-first, projection-second.** Raycast wins on hull hits; otherwise nearest projected body within 28px counts so small/occluded hulls at glancing angles stay clickable. Box-select needs Shift+drag (plain left-drag orbits); right-click-no-drag orders (right-drag still pans); Esc clears; click/drag disambiguates at 6px; orbit disabled for the gesture only, always restored. Document the one UX deviation from retail (left-click orders) in the HUD footer (from 11).
- **Minimap markers are DOM, not canvas.** Baked minimap stays terrain-only; live kind-colored dots with selection outlines are absolutely-positioned spans at ~4Hz through React state — no per-frame canvas upload, closes task 10's stale-spawn limitation (from 11).
