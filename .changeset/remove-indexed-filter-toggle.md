---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The View menu loses its Indexed filter toggle: the terrain albedo is now always nearest-filtered, keeping the crisp indexed-TNT look (the old toggle-on default) at every zoom.

## Task writeup

The task asked to remove the "Indexed filter toggle". Filter-on was the default and the established battlefield look, so this change deletes the option outright instead of hiding the control — the albedo texture is pinned to nearest sampling at creation and nothing re-switches it per tick.

## What changed

- Core (`packages/core/src/terrain/types.ts`): `ViewOptions.pixelFilter` removed.
- Web (`apps/web/src/App.tsx`): default options drop `pixelFilter`; the "Indexed filter" Toggle leaves the View panel.
- Web (`apps/web/src/renderer/TerrainCanvas.tsx`): removed the per-tick mag/min filter branch; the albedo texture is created with nearest mag/min filters and no mipmaps (the old toggle-on state generated mipmaps it never sampled). Height and territory textures keep their linear sampling; the Unit Folio preview keeps its own texture setup.
- Tests (`apps/web/src/App.indexedfilter.test.ts`): new source-level pins — no `pixelFilter` in core types, App, or canvas, no "Indexed filter" toggle, albedo pinned to `NearestFilter` at creation, and exactly two albedo filter writes (no per-tick re-switch).

## Important decisions

- **Delete the flag, not just the button.** Keeping a dead `pixelFilter` field would leave per-tick filter plumbing for a state nobody can reach; removing it end to end follows the Water-toggle removal precedent (commit `656b2ca`).
- **Keep the toggle-on look.** Nearest sampling was the default, and sibling-repo terrain policy ("nearest at identity" for TNT pixels) agrees it is the right fixed presentation — so the battlefield renders exactly as before with the toggle on.
- **Drop the unused mipmaps.** The old toggle-on state generated a full mipmap chain that `NearestFilter` never samples; creating the texture with mipmaps off saves ~1/3 of the albedo VRAM with zero visual change.
- **No README change.** Small view-toggle removal with no architecture impact, same as the Water-toggle precedent.

## Verification

- `yarn typecheck` green; `yarn workspace @scorched-3d/core test`: 817/817 pass.
- `yarn workspace @scorched-3d/web test`: 1113 pass, including the 4 new `App.indexedfilter` pins; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. Playwright not run (per task rules).
