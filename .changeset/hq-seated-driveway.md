---
"@scorched-3d/core": patch
---

HQ terrain seating: forts now sit ON the ground at their local high point instead of dug into a pit, and each exit driveway is graded to a gentle, always-climbable ramp out of the hall mouth.

## Task writeup

Task: "On Dust Plains one of the HQ is set in the ground such that the driveway out is in a 'pass' that's hard for units to climb out of. Make the building sit higher up to clear local terrain or adjust the terrain."

### Root cause

Two cooperating causes, both in the HQ ground works (`packages/core/src/units/hq.ts` + `generate.ts`):

- Siting picks LOW valley-floor anchors (the scorer rewards lowness), and `levelHqPads` then leveled the whole construction pad DOWN to that anchor height — digging the works into a pit wherever the pad covered rising ground.
- On Dust Plains the forts land in the rim-hill band, so the pit walls were ~15 height units tall, and the worst one stood exactly at the hall mouth: probe showed single-cell steps of +13 to +20 (e.g. 84 → 102) right past the pad front, at or above the `PATH_MAX_SLOPE = 15` climb gate — reinforcements held against a pass wall they could barely or never climb.

### What changed (core only — no renderer change needed)

- `hq.ts` `levelHqPads`: pads now level UP to the highest ground they cover — pad cells plus their immediate apron ring — so the slab and hall floor sit on top of local terrain. The exit-road columns are excluded from the max (the mouth wall is a ramp job, not a reason to raise the whole fort), and the anchor cell rises with the pad, so dry-margin / hall-clear siting guards still hold afterwards.
- `hq.ts` new `gradeHqExits` (+ `HQ_EXIT_MAX_STEP = 5`): walks each exit corridor outward from the pad-front seam, following the center row's natural ground but clamping every step to ±5 up or down, benching the full road width to that one profile — flat across, gentle along. Cuts cliff walls into ramps, fills drops and wet dips into causeways; flat ground passes through untouched. Runs after leveling, before tile classification, so tiles and units see the finished driveway.
- `generate.ts`: calls `gradeHqExits` in the ground-works sequence; extracted the raw height loop into exported `sampleHeightField` so siting invariants can be measured on the ground the siter saw.
- Tests (`hq.test.ts`): pad-leveling test updated to the level-up contract (incl. apron-corner accounting); new synthetic tests for wall-ramping, wet-dip causeway fill, mirrored east driveway, grading idempotence, and the `HQ_EXIT_MAX_STEP ≤ PATH_MAX_SLOPE / 2` contract with the drive gate; the map-wide integration test now also asserts every pad clears its non-road ring and every driveway centerline step stays within the cap, across all 6 presets × 3 seeds; the siting test measures raw heights and pins `generateMap().hqs` to `placeHqs(raw)`.

### Decisions

- Nanolathe inspiration (real): `docs/DESIGN_ECONOMY_CONSTRUCTION.md` C17 validates the factory exit with the same per-cell gates (water, depth, height, slope) as a chosen site — mirrored here by grading the exit to the same climb gate the movers drive, with wide margin (5 vs the 15 hard gate, at the edge of pathfinding's zero-cost tier).
- Level-up rather than re-site: moving the forts elsewhere would dodge this map's rim but leave the pit-digging mechanic for the next one; seating high + grading the exit fixes the class of bug on every preset (verified: worst exit step ≤ 5 and zero above-pad ring on all presets × 4 seeds).
- Siting untouched: the valley-floor preference is still right for picking the neighborhood — construction now finishes the job instead of fighting it.
- Verification: core suite 599/599 green, `yarn typecheck` + `yarn build` green, web suite 693/694 with the single failure pre-existing on untouched HEAD (`deployPages.test.ts` expects workflow branches `["main"]`, repo uses `master`) — unrelated, left alone.
