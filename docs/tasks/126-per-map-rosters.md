# 126 — Per-Map Starting Rosters

Ashen Pass now musters double units (12); every map's starting roster scales
with its accessible land instead of the old flat 6 everywhere.

## Counts

| Map (preset)   | Dry gentle land* | Units |
|---|---|---|
| Ashen Pass (highpass) | ~100% | 12 (6v6) |
| Dust Plains (dustplains) | ~86% | 10 (5v5) |
| River Crossing (rivercross) | ~80% | 10 (5v5) |
| Greenreach (greenreach) | ~38% | 6 (3v3) |
| Glass Caldera (caldera) | ~39% | 6 (3v3) |
| Gods Channel (archipelago) | ~13% | 4 (2v2) |

\* Share of in-bounds cells above `seaLevel + 4` with slope ≤ 15, averaged over
4 seeds via a scratch vitest probe (deleted after measuring).

## Changes

- `packages/core/src/units/place.ts`: new `PRESET_UNIT_COUNTS` table plus
  `startingUnitCount(preset)` helper (falls back to `UNIT_COUNT` for unknown
  presets). All entries are even so the west/east `teamOf` split stays exact.
- `packages/core/src/terrain/generate.ts`: passes
  `startingUnitCount(preset)` into `placeUnits` instead of the default.
- Tests: new `startingUnitCount` suite in `place.test.ts` (table covers every
  preset, Ashen Pass is exactly double baseline, all even, fallback, every
  generated map ships its count); per-preset expectations in the even-teams
  and battle-maps suites.

## Decisions

- Kept Greenreach/Caldera at the 6-unit baseline rather than strictly linear
  (~4.5) so the default map's battle feel is unchanged; only the extremes
  move (up on open maps, down to 2v2 on the cramped isles).
- No placement changes were needed: the existing strict/relaxed/fallback
  passes place 12 separated hulls on Ashen Pass within the existing
  dry/gentle/unoccupied/separated guards (verified by the unchanged
  placement test across all presets × seeds).

## Verification

- Core: 526 passed; web: 578 passed; both typechecks clean.
