---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The View menu loses its Water toggle: water now always renders on maps with a sea level, and the seabed wet tint + caustics apply unconditionally below the waterline.

## Task writeup

The task asked to remove the Water toggle. Water-on was the default and the only sensible presentation for a battle map, so this change deletes the option outright instead of hiding the control — the surface, the underwater shader tint, and every sea-level-gated behavior now key on `map.seaLevel > 0` alone.

## What changed

- Core (`packages/core/src/terrain/types.ts`): `ViewOptions.showWater` removed.
- Web (`apps/web/src/App.tsx`): default options drop `showWater`; the "Water" Toggle leaves the View panel.
- Web (`apps/web/src/renderer/shaders.ts`): `showWater` uniform removed; the underwater branch is now `if (vWorld.y < waterY)`.
- Web (`apps/web/src/renderer/TerrainCanvas.tsx`): removed the `showWater` uniform seed and per-tick drive; `water.visible`, the day-fog lake-mist fold-in, and the camera surface-lift gate on `map.seaLevel > 0` only.
- Tests (`apps/web/src/renderer/shaders.test.ts`): the "gated calm water" block becomes "always-on calm water" — negative pins that neither shader nor canvas mentions `showWater`, plus pins for the depth-only tint gate and the sea-level-only surface visibility.

## Important decisions

- **Delete the flag, not just the button.** Keeping a dead `showWater` field would leave shader/uniform plumbing for a state nobody can reach; removing it end to end keeps the next reader from wondering what turns water off.
- **Dry maps stay dry.** Everything still gates on `map.seaLevel > 0`, so sea-level-zero presets (Ashen Pass, Dust Plains) render exactly as before — no water sheet, no tint, no fog fold-in.

## Verification

- `yarn typecheck` green; `yarn workspace @scorched-3d/core test`: 803/803 pass.
- `yarn workspace @scorched-3d/web test`: 1060 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. Playwright not run (per task rules).
