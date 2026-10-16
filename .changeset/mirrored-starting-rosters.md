---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Mirror the starting rosters so both teams field the identical unit-kind multiset: one half-roster is drawn per seed (every kind covered first, the rest random) and dealt to each side in independently shuffled order, closing composition gaps that reached 80%+ starting-strength differences on some seeds.

## Task writeup

# Make the starting teams units more balanced

## What changed and why

Starting teams were dealt from opposite ends of a single random roster (`placeUnits` drew `count` random kinds, then `teamOf` sent the first half west and the rest east). Counts were already even, but composition was luck: a probe over 40 seeds per map found mismatched team compositions 40/40 times on every map, with average per-team starting-strength gaps (damage × blast per hull, summed) of ~20-32% and worst cases above 80% — e.g. one side opening with three hammers and two commanders against a peewee-heavy side.

`placeUnits` now builds the roster via `buildMirroredRoster`: a single half-roster is drawn with the existing variety logic (every kind covered first in shuffled order, the rest random) and both teams field that exact multiset, each in its own shuffle. Equal counts were already guaranteed; now composition and starting strength are exactly equal too.

## Important decisions

- Mirrored multisets, not identical order: each side's kinds shuffle independently, so placements and which hull sits where still vary — fairness without a carbon-copy opening.
- Randomness kept across seeds: the shared half-roster is still drawn fresh per seed, so regens show different battles; only the cross-team lottery is gone.
- Odd counts degrade gracefully: the short (east) side gets a strict subset of the shared half, so no hull is ever unassigned and the extra hull is the only asymmetry (all shipped presets are even, so this path is dormant).
- HQ reinforcements untouched: weighted-random spawns are symmetric in expectation (both HQs draw from the same roster/weights), so they stay as the intentional mid-battle variety.
- Seeded placements shift: the new draw order consumes the seeded rng stream differently, so exact spawn cells for a given seed change — determinism (same seed, same battle) is preserved.
