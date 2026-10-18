---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Forest-blocked guns walk around tree belts to a clear firing seat: when the near shuffle cannot clear the lane, an obstructed seek scans wider for the nearest seat with a genuinely clear line of fire instead of closing straight through the wood

## Task writeup

A unit that keeps hitting trees repositions — but only by one shuffle: the forest-futility cure (`attachForestStep`) scored the two ±48 lateral seats and, when neither strictly improved, gave up and closed straight toward the enemy through the belt, firing into crowns the whole way. Any belt wider than a single shuffle (~100u) therefore read as hopeless even with open ground a short walk to the side.

## What changed

- New `clearLaneSeat` in `packages/core/src/units/combat.ts`: scans lateral rings at 1–5 shuffle-steps (±48–240u) off the firing line, near to far with the roster-hashed side first, and names the first seat whose lane to the target crosses zero standing trees and whose seat stands clear of every crown (a muzzle parked inside the canopy would stick its first round). Returns null on an already-clear lane, past the bound (a seat farther out is a flank march, not footwork), and on degenerate inputs. Pure and deterministic, like its siblings; accepts the same optional `blocked` terrain probe as `orbitStrafe`.
- `apps/web/src/renderer/movement.ts` (`attachForestStep`): the cure now prefers in order — a near shuffle whose lane is fully clear (legacy seats and flank pressure preserved byte-identically), else the wide clear seat, else the partial near improvement, else the plain close through the wood. With no way round, behavior is unchanged: the hull crushes a lane and the guns fire through on proven futility.

## Termination / oscillation / performance

- Bounded: each new escape needs three more consecutive sticks (existing event gate), the obstruction sidestep survives re-seeks and alternating hits until arrival (existing `seekEngage`/`notifyThreat` preservation), and arrival clears it — a hull at a clear seat stops reporting, so escapes cannot ping-pong.
- No per-tick cost: the ring scan runs once per obstructed report with capped counts (each candidate stops at its first crossed tree), not per unit per tick.

## Files

- `packages/core/src/units/combat.ts` — `clearLaneSeat` + `CLEAR_LANE_MAX_OFFSET`.
- `packages/core/src/units/combat.test.ts` — open-lane hold, ring-1 seat, belt walk-past, crown-seat veto, past-bound give-up, degenerate cases.
- `apps/web/src/renderer/movement.ts` — wide-seat fallback in `attachForestStep` (+ docs).
- `apps/web/src/renderer/retaliation.test.ts` — belt escape to a zero-wood lane (+ walk-out), no-way-round plain close.

## Verification

- New belt test observed failing before the fix (no sidestep attached on a 9-crown belt), green after; fallback test passes before and after.
- `yarn workspace @scorched-3d/core test --run` — 838 passed.
- `yarn workspace @scorched-3d/web test --run` — 1131 passed, 1 failed in `deployPages.test.ts` (expects branch `main`, workflow pins `master`); verified failing on the untouched tree via `git stash`, pre-existing and unrelated.
- `yarn workspace @scorched-3d/core typecheck`, `yarn workspace @scorched-3d/web typecheck` — clean.
- Playwright not run (per task rules).

## Nanolathe

Checked for an equivalent mechanic: retail `Attack_Chase` only strafes around the engagement circle (already the cited parallel for `orbitStrafe`); nothing in the retail spec repositions around forest cover, so the clear-seat scan is a new mechanic, not a port.
