---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Units parked in fog now read as fogged: hulls haze toward the fog color with the same valley term as the terrain under them, so low-lying armor sits in the mist instead of rendering crisp against it — subtle by contract (day hulls always keep at least 65% of their shaded paint from this term), with markers untouched so units stay findable.

## Task writeup

## What changed

- Renderer (`apps/web/src/renderer/unitFog.ts`, new): the valley-haze injection for hull Lambert materials —
  - `spliceUnitFogVertex`/`spliceUnitFogFragment` (pure, tested): a world-Y varying plus a valley term applied after three.js's `#include <fog_fragment>`, reusing the engine's own `fogFactor` for the distance share so the combine matches the terrain exactly (`fog + (1 - fog) * valley * strength`). The band span is generated from the shared `VALLEY_FOG_SPAN` constant, so the GLSL cannot drift from the JS mirror; the whole block sits under `#ifdef USE_FOG`.
  - `unitFogUniforms` + `setUnitFog`: one shared uniform field aliased into every hull program (color aliases the canvas fog `Color`, so day/night retints propagate with zero per-frame work).
  - `unitHullMaterial(color)`: the single hull-paint constructor every hull mesh builds through; `unitFogFactor`/`unitValleyWhitening` JS mirrors implemented by the shared `applyValleyFog`/`valleyFogFactor` (equality with the terrain math is structural, not coincidental).
- Renderer (`units.ts`): all hull-mesh creators (boxes, barrels, wheels, both walkers' legs, commander antenna) route through `unitHullMaterial`. Team rings stay plain `MeshBasicMaterial`.
- Renderer (`combatFx.ts`): the shared wreck breach-collar uses `unitHullMaterial`, so exploded husks haze with live hulls.
- Renderer (`night.ts`): `applyDayNight` writes the preset valley strength to the shared unit field (day 0.35, night 0) alongside the terrain uniform.
- Canvas (`TerrainCanvas.tsx`): binds the field once at init; waterline + exaggeration ride the per-tick uniform block with the terrain/water writes, so the band tracks the height slider.
- Tests: `unitFog.test.ts` (13: splice purity/anchors/order, USE_FOG gating, installed-`ShaderLib` anchor guard, cache-key distinctness, uniform aliasing, every-kind hull sweep, spawned-unit coverage, team-ring exclusion, damage/wreck survival, terrain-combine equality at sample points, zero-fog identity, night identity, readability floor sweep, canvas wiring source pin), `night.test.ts` (+1: strength written both directions), `combatFx.test.ts` (+1: wreck collar carries the key).
- `.changeset/unit-valley-fog.md` (new) — **patch** for core + web (view-only addition in the fixed version group).

## Important decisions

- **Valley term only — the one term hulls were missing.** Investigation showed hulls already distance-fade via `scene.fog` (same near/far as the shaders; smoothstep-shaped vs the terrain's linear ramp, both pinning 0/1 at the ends), mist-bank sprites already blend over hulls behind their plane, and the drift wobble (±17.5% far-field breathing) is unreadable on a 26-unit hull. The gap was the day-only valley height term: terrain in hollows hazed while hulls stayed crisp. Matching just that term is the minimal fix with a single source of truth.
- **Subtle by construction, not by tuning.** No new strength constant: hulls take the terrain's own 0.35 day strength through the shared uniform, so day/night and any future retune move together. The readability floor is pinned in tests (whitening ≤ strength across a distance×height sweep; full-valley day hulls keep 65% of their paint).
- **Markers stay crisp (UI layers win over scenery).** Team rings, selection chevrons, health bars, and occlusion ghosts keep their existing distance response and never take the valley term — the haze must never hide a unit the player is looking for. Pinned by cache-key assertions (markers equal the fresh-material baseline).
- **Fog-less scenes compile it out.** Thumbnail/icon scenes carry no `scene.fog`, so without the `USE_FOG` gate the valley term would whiten tray icons toward sky blue. The gate keeps icons crisp with no special-casing at the build sites.
- **Wrecks match live hulls for free.** Charring recolors materials in place (verified: same instances after `applyWreckChar`), and the collar shares the helper — one test pins each half.
- **Out of scope, noted:** trees/rocks/HQ forts also skip the valley term today; extending the same helper to them is a follow-up, not this task.
- **Nanolathe:** checked `internal/meshscene/battle_fog*.go` — fog-of-war/intel logic, not atmospheric rendering (same finding as the day-fog tasks); nothing carried over.

## Verification

- New tests observed failing before implementation (missing-module import error), then green after.
- `yarn workspace @scorched-3d/web test`: 800 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion, verified identical on the untouched tree via `git stash`. `yarn workspace @scorched-3d/core test`: 679 pass. `yarn typecheck` (3 tasks) and `yarn build` both green. Playwright not run (per task rules).
