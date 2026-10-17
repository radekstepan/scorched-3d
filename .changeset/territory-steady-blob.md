---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The Territory overlay no longer flashes: fresh ground held through float32 stamp rounding, a 1.5× slower fade, and a smoothed contiguous blob per side instead of scattered popping cells.

## Task writeup

The territory overlay was visibly flashing. A headless probe through the real stamp → 4 Hz repaint pipeline (scratch vitest, deleted after) found the cause is a precision trap, not the fade curve: stamps live in a `Float32Array` while `now` is float64, so a stamp taken on the paint tick itself rounds *up* past `now` on ~half of all ticks — and `influenceFreshness` read that negative age as "future, therefore stale" (0). Every repaint was a coin flip that blanked the *entire freshly-stamped disc* at once: 26 of 240 repaints blanked held ground, the classic full-field strobe. The 8 s full→fade knee contributes only ~0.005 alpha per repaint — innocent, as is the contested blend on held ground.

## What changed

- Core (`packages/core/src/units/influence.ts`):
  - `influenceFreshness()` clamps `age` at 0 instead of zeroing negative ages — a future/rounded-up stamp means "just seen", so fresh ground never strobes. Still a pure function of `now`; no grid walk.
  - Slower fade: full-strength hold 8 s → 12 s, full fade 60 s → 90 s (1.5×, linear shape kept). At age 30 ground now reads ~0.77 fresh instead of ~0.58.
  - `paintInfluence()` smooths per-team freshness with an edge-clamped 3×3 box blur before the existing contested-blend + alpha-from-peak rule: single-cell pinholes inside held ground fill (~8/9 peak), lone stamped cells paint faint (~1/9 peak) instead of popping, and disc rims feather over one cell. Measured on the probe: static-hold repaint deltas 97 → 0 alpha, moving-unit leading-edge pops 97 → ≤22 alpha with zero transparent↔visible flips, contested flips likewise damped; repaint cost 0.009 ms → 0.055 ms for the 40×32 field — still ~0.02% of the 4 Hz budget.
- Tests: `influence.test.ts` (+5: slower-fade tripwire pins incl. the 12/90 values, float32 round-up sweep through the real stamp path with a hostile-tick coverage guard, pinhole fill, loner dimming, one-cell edge fringe); `territory.test.ts` (+1: no strobe through the real `TerritoryFx` at the hostile timestamp 8/30, with the round-up premise pinned). All pre-existing territory expectations hold unchanged — uniform-disc centers still paint exact faction colors at full alpha, contested midpoints and stale fades are untouched.
- `.changeset/territory-steady-blob.md` (new) — **patch** for core + web (view-only retune, same bump as the overlay itself).

## Important decisions

- **Clamp, don't epsilon.** An epsilon band around zero age would still strobe on large `now` (float32 spacing grows); `Math.max(0, age)` is correct at every magnitude and gives clock-skew future stamps the honest reading (fresh).
- **Blur at read time, not write time.** Nanolathe's `Grid.AddDisc` bakes a linear falloff into summed integers, but last-seen timestamps can't store weights — so the softening lives in `paintInfluence` as a neighbor average, the timestamps-compatible analogue of their soft discs. Kept their full-then-fade freshness shape but not their 0.25 floor: territory must fully clear, so the tail still reaches 0.
- **3×3, not wider.** One cell of feather fills pinholes and damps pops without washing out a lone scout's disc; the 384-unit stamp radius and 4 Hz cadence stay as-is. No README change: the overlay's documented behavior ("stale ground fades out") is unchanged, only steadier.

## Verification

- Probe before fix: `BLINK_OFF 26/240`, static pops 1536, moving/contested max-alpha swing 97. After: `BLINK_OFF 0/240`, static deltas 0, moving/contested max 22 with 0 flips.
- `yarn workspace @scorched-3d/core test`: 26 files / 700 tests pass (5 new). `yarn workspace @scorched-3d/web test`: 813 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion, confirmed failing on the untouched tree via `git stash`. `yarn typecheck` (3 tasks) and `yarn build` both green. Playwright not run (per task rules).
