---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Forest-blocked guns step out of the wood instead of feeding the canopy: obstructed seeks carry a lateral lane-clearing sidestep, and carried sidesteps are walked to arrival at any range instead of self-canceling at the stand-off boundary

## Task writeup

Units kept firing through or inside forests and kept hitting trees. The guns already reported forest futility (three consecutive tree-stuck rounds raise `onObstructedShot`), but the cure never executed, for two compounding reasons found by headless reproduction:

1. The reposition only ever closed straight toward the target (`seekEngage` pursuit) — through the wood, firing into the crown the whole way — never laterally out of it.
2. Every lateral sidestep self-canceled: the pursuit drive dropped a carried sidestep the stride the hull crossed its stand-off line, so a holder stepping 48u laterally had its step deleted after ~2 ticks (measured: 1.56u of lateral progress after 20 ticks) and drove back at the foe instead.

## What changed

- `packages/core/src/units/movement.ts` (`pursueStep`): a carried sidestep is now walked first at any range and cleared on arrival; the hold/close boundary no longer drops it mid-stride. Rationale: an attached step is scored fresh and walks in ~1s, so the geometry cannot go stale mid-walk — the old "stale by arrival" drop only fit steps carried across long closes, which no attacher produces. Outnumbered hulls still hold without walking (orders/odds authority untouched); expiry, disengage, and leash give-ups still drop the whole memory.
- `packages/core/src/units/retaliation.ts` (`ThreatMemory.sidestep` doc) and `packages/core/src/units/combat.ts` (`firingSidestep` doc): contract updated to "walked first at any range", attached by the sweep (cooldown) or by forest-obstructed seeks (proven futility).
- `apps/web/src/renderer/movement.ts` (`seekEngage` + new `attachForestStep`): when the muzzle-to-target lane crosses standing wood, the fresh seek memory also carries the better `firingSidestep` lateral (same evaluator the sweep uses, with flank pressure from teammates on the same target). Ridge-only blocks keep the plain close; deep forests with no strictly better lateral keep closing through (still crushing a lane); ordered/holding/wreck/leash/self refusals are detected by core returning the mover untouched, so the cure never fights player orders. Structures (`target -1`) resolve the victim seat at the fort roof lift.

## Termination / oscillation / performance

- Bounded: each new step needs three more consecutive sticks, must score a strictly better seat (lane wood dominates, so consecutive report-steps strictly decrease wood — cycles are impossible), and arrival clears the point. Guns keep firing on the move during the ~1s walk (existing ×2 refire), so a cleared lane resets the streak via landed rounds.
- No per-tick cost: the lane scan runs once per obstructed report (event-gated), not per unit per tick; the ~15k-tree maps pay nothing extra in the hot loop.

## Files

- `packages/core/src/units/movement.ts` — walk carried sidesteps at any range.
- `packages/core/src/units/retaliation.ts`, `packages/core/src/units/combat.ts` — contract docs.
- `packages/core/src/units/movement.test.ts` — new boundary no-self-cancel case; closer-drop expectation updated to walk-first with rationale.
- `apps/web/src/renderer/movement.ts` — `attachForestStep` on obstructed seeks.
- `apps/web/src/renderer/retaliation.test.ts` — forest-seek step + walk-out, fort-lane step, no-wood close cases.

## Verification

- New tests observed failing before the fix (core: 1.56u lateral progress vs required >10; renderer: no sidestep attached), green after.
- `yarn workspace @scorched-3d/core test --run` — 713 passed.
- `yarn workspace @scorched-3d/web test --run` — 838 passed, 1 failed in `deployPages.test.ts` (expects branch `main`, workflow pins `master`); verified failing on the untouched tree via `git stash`, pre-existing and unrelated.
- `yarn workspace @scorched-3d/core typecheck`, `yarn workspace @scorched-3d/web typecheck` — clean.
- Playwright not run (per task rules).
