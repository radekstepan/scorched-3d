---
"@scorched-3d/core": patch
---

HQ siting: forts now step inland onto ground that is already high enough instead of raising a works hill — Dust Plains pads need 0–2 units of fill where they used to need 15–21.

## Task writeup

Task: "On Dust Plains we fixed the HQ position such that it's at a high enough elevation. See if we can place the HQs further inland to not have to build a little 'hill' for it."

### Root cause

The HQ scorer (`placeHqs` in `packages/core/src/units/hq.ts`) preferred the outermost dry column and the LOWEST ground within the 16-column end band. On Dust Plains the outermost dry columns sit on the shore ramp (anchor ~sea+9), while the pad + apron reach ~14 cells further inland onto the steppe (~sea+25) — so `levelHqPads` filled a 15–21 unit hill under every fort. Probing 8 seeds confirmed it: anchors at 84–85 (sea 75), pad tops at 100–105.

### What changed (core only — no renderer change needed)

- `hq.ts` new `hqPadTop` (+ `isHqRoadCell`): the pad level-up target (pad cells + apron ring, exit-lane rect excluded) extracted into a shared pure helper; `levelHqPads` now calls it with byte-identical behavior, and siting prices every candidate through it. The road test is arithmetic (no lane allocation), so per-candidate scoring stays cheap.
- `hq.ts` `placeHqs`: each strict/relaxed candidate loses `padLift × HQ_PAD_LIFT_WEIGHT (60)` score — one unit of fill outweighs one map-end column (pull 50), so a shore ramp loses to the inland flat behind it while flat valley floors (no lift anywhere) still site at the outermost dry column. `HQ_END_BAND` widened 16 → 48 so the inland steppe is reachable. The half-sweep fallbacks keep their valley-target scoring (verified byte-identical on highpass, which uses them).
- Kept `levelHqPads` + `gradeHqExits` as the safety net: placement alone does not suffice globally (caldera/archipelago still need real fill on their slopes), but on Dust Plains they are now a 0–2 touch-up instead of a hill.
- Tests (`hq.test.ts`): synthetic shore-ramp→steppe field pins the trade (fort takes the first flat column, 12 in, with zero lift; flat far end still takes the outermost column); Dust Plains regression pins ≥18 columns inland, anchor ≥ sea+20, lift ≤ 4 across 5 seeds (measured 20–22 / sea+24–29 / 0–2, vs 12–14 / sea+9–10 / 15–21 before); `hqPadTop` unit test (apron counts, driveway spike ignored) and an `isHqRoadCell` ⇄ `hqRoadCells` cell-for-cell agreement test for both facings.

### Decisions

- Nanolathe inspiration (real): `docs/DESIGN_ECONOMY_CONSTRUCTION.md` C17 runs the same per-cell gates (water, depth, height, slope) at the factory exit as at the chosen site — i.e. pick a site whose footprint already passes instead of sculpting around a bad one. Mirrored here by pricing the required earth-moving into the site score instead of fixing it up afterwards.
- Price the lift rather than re-target the height term: the valley-floor preference stays intact (low AND flat still wins); only sites that would need a hill pay. Measured lift fell on every preset (greenreach 3–21 → 0–9, rivercross 7–15 → 0–3, caldera 29–44 → 24–36, archipelago mostly 25–47 → 0–18 with fallback outliers unchanged-or-better), with no invariant regressions.
- Verification: new tests fail 4/4 on base (the two siting tests on behavioral assertions) and pass with the fix; core suite 618/618 green, `yarn typecheck` green, web suite 732/733 with the single failure pre-existing on the untouched tree (`deployPages.test.ts` workflow-yaml assertion) — unrelated, left alone.
