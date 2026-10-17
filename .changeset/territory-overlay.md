---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The View menu gains a Territory toggle that tints each team's recent ground in its faction color on both the 3D map and the minimap — contested ground blends both colors, stale ground fades out.

## Task writeup

There was no way to see which ground each side holds: units roam, hunt, and reinforce on both ends of the map, but "theirs" lived only in the AI's head. The View panel gains a `Territory` toggle (off by default) that overlays a per-team presence field on the terrain and the minimap.

## What changed

- Core (`packages/core/src/units/influence.ts`, new): framework-free influence field —
  - `createInfluenceField(worldW, worldD)` builds a ~40×32 last-seen grid (128 world-unit cells, nanolathe's sector scale);
  - `stampRoster()` stamps a 384-world-unit disc around each live unit and live fort every tick (dead rows simply stop stamping, so wrecks keep fading history);
  - `influenceFreshness()` holds full strength for 8 s, then fades linearly to 0 at 60 s (nanolathe's `freshness` shape: full for seconds, gone at the one-minute memory limit);
  - `paintInfluence()` resolves each cell: one team → its faction color, both (contested) → a freshness-weighted blend leaning toward the fresher side, neither → transparent; alpha scales with the strongest claim so stale ground fades out. One RGBA buffer (row 0 north) feeds both surfaces.
- Core (`packages/core/src/terrain/types.ts`, `index.ts`): `ViewOptions` gains `showTerritory`, influence module exported.
- Renderer (`apps/web/src/renderer/territory.ts`, new): `TerritoryFx` owns the field plus the shared `DataTexture` (linear filtering for soft blobs, `flipY` so row 0 lands north on the terrain UVs, no color-space decode so the 3D tint matches the minimap hex exactly). Stamps run every tick even while hidden (negligible cost, toggle-on shows live ground); repaint + upload run at 4 Hz only while visible, with an instant repaint on toggle-on (the WaypointFx pattern). `minimap()` hands React a copy so state never aliases the live buffer. UV-mapped, so exaggeration re-snaps need nothing.
- Shaders (`apps/web/src/renderer/shaders.ts`): terrain fragment gains `influenceTex` + `showTerritory` — one guarded texture fetch mixed after the fog (reads at any distance, zero cost while hidden). Water carries no term (same terrain-only call as valley fog).
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): binds the texture, drives the uniform from the toggle, stamps hulls + forts per tick, broadcasts the paint at 4 Hz (null while hidden), disposes on teardown.
- App (`apps/web/src/App.tsx`): `showTerritory: false` default, `Territory` toggle in the View panel, `onTerritory` paint state drawn into an absolutely-positioned overlay canvas under the minimap dots (no layout box, so clicks/dots keep measuring against the image content box).
- Tests: `influence.test.ts` (15: grid budget, disc stamping, roster filtering, restamp refresh, freshness curve incl. the -1 sentinel, exact faction paint, contested midpoint + fresh-leaning blend, stale fade, transparent unknown, radius bound, faction bytes), `territory.test.ts` (6: texture setup, stamp-while-hidden, 4 Hz cadence, instant toggle-on, contested/stale texture, minimap copy), `shaders.test.ts` (+2: GLSL mix placement/order, uniform seeding), `App.territory.test.ts` (10: toggle wiring, hull/fort stamping, dispose, broadcast, canvas order/layout, repaint cadence, shared buffer).
- `.changeset/territory-overlay.md` (new) — **patch** for core + web (view-only addition, same bump as the waypoint overlay).

## Important decisions

- **Timestamps, not decaying sums.** Nanolathe's grids sum integers and fade by rewriting cells; here each cell stores last-seen seconds, so decay is free (a pure function of `now`) and updates touch only the discs around live units — no full-grid walk per tick, ever.
- **"Theirs" = recently near a live unit or fort.** Forts count as presence (home ground reads as home even before patrols spread); wrecks and never-visited cells fade to transparent rather than flipping off.
- **Contested blends, stale fades — one rule.** Both teams fresh → 50/50 midpoint; one fading → the mix leans fresh; alpha always tracks the strongest claim, so "contested" and "stale" are both just the freshness math, with no special-case branches.
- **Overlay after fog, terrain-only.** Mixing post-fog keeps territory readable at long zoom (it's an analysis layer, not scenery); the water sheet stays clean.
- **No resnap, no scene group.** The 3D side is a texture + two uniforms, not geometry — exaggeration changes, regen, and disposal all fall out naturally.

## Verification

- New tests observed failing before implementation (missing-module import errors), then green after.
- `yarn workspace @scorched-3d/core test`: 26 files / 663 tests pass (15 new). `yarn workspace @scorched-3d/web test`: 771 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion in an untouched area. `yarn typecheck` (3 tasks) and `yarn build` both green.
- Perf probe (scratch vitest, deleted after): 60-unit roster stamp ≈ 0.011 ms/tick, full 40×32 repaint ≈ 0.03 ms at 4 Hz, 5 KB texture upload — plus one guarded texture fetch per terrain pixel only while visible. Playwright not run (per task rules).
