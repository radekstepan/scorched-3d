---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Double the starting battle on every map: the baseline roster goes from 6 to 12 hulls (6v6), with per-map counts scaling up in step — Ashen Pass fields 24 (12v12), Dust Plains and River Crossing 20 (10v10), Greenreach and Glass Caldera 12 (6v6), and Gods Channel 8 (4v4) on its cramped isles.

## Task writeup

# Double starting units

Every map now opens with about twice the steel: `UNIT_COUNT` 6 → 12 and
each `PRESET_UNIT_COUNTS` entry doubled, keeping the per-map scaling by
accessible land (Ashen Pass still double the baseline, Gods Channel still
the smallest battle) and keeping every entry even so the west/east
`teamOf` split stays exact.

## Changes

- `packages/core/src/units/place.ts`: `UNIT_COUNT` 6 → 12;
  `PRESET_UNIT_COUNTS` greenreach 6 → 12, archipelago 4 → 8,
  highpass 12 → 24, caldera 6 → 12, rivercross/dustplains 10 → 20.
- `packages/core/src/units/place.ts` `teamSpan`: root-cause fix the
  doubled roster exposed — the east span's inclusive upper bound was
  `width - MARGIN`, one cell past the in-bounds invariant
  (`cellX < width - MARGIN`) the placement test enforces. The old 6-draw
  rosters never rolled the boundary cell; the 24-hull Ashen Pass roster
  did (highpass seed 123456 spawned at cellX 312 = width - 8). The east
  edge now stops at `width - MARGIN - 1`, mirroring the west `>= MARGIN`
  edge. Placements stay deterministic per seed; east-side layouts shift
  accordingly.
- `packages/core/src/units/pathfinding.ts`: two formation comments that
  pinned "roster is 6" updated to 12 (the no-cutoff reasoning still
  holds — 12 ordered hulls still fan well short of retail's 30-cutoff
  regime).
- Tests (`place.test.ts`): per-map expectations updated (dustplains /
  rivercross 10 → 20, minimum 2v2 → 4v4, east span edge 120 → 119);
  two new tests pin the doubling — the explicit per-preset table plus
  `UNIT_COUNT = 12`, and a default-roster 6v6 team split. The existing
  placement-validity suite (dry, gentle, unoccupied, in-bounds,
  ≥10-cell separation across all presets × seeds) now guards the
  doubled rosters unchanged.

## Decisions

- Scaled the whole table ×2 instead of flattening to one count, so the
  land-scaled roster design from the per-map-rosters task survives: open
  maps feel twice as big, cramped isles stay playable.
- Fixed the span edge in `teamSpan` rather than clamping in the sampler,
  so the public span contract and the placement invariant agree — the
  only consumer is the placement pass, so no other call sites move.
- No README update: bigger opening battles change no architecture or
  controls. The sibling nanolathe repo offered nothing to borrow here —
  this is a count change, not TA mechanics.
- Verification: core 637/637 green (635 existing + 2 new), web 738/739
  with the only failure the pre-existing unrelated deployPages
  branch-name mismatch (identical on the untouched tree), typechecks
  clean.
