---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

HQ reinforcements finally leave the exit road alone: each release walks the hall straight out of the mouth on a one-shot departure, then stages on a loop that lives entirely beside the lane — the road sits empty once releases stage, and the entrance stays passable for the next one.

## Task writeup

Why the previous fix (6069b5a, "hq: releases stage off exit lane") didn't hold: its `[near, far]` loop kept the far waypoint ON the centerline at the lane's far end, with both loop legs crossing the lane diagonally. A headless repro (4 releases at realistic 15–35 s cadence through the real `UnitMovement`, spacing + separation included) measured the damage: every hull spent 65–71% of its life on the road, the road sat occupied 95% of the time with all four hulls piling onto it at once, and exiting hulls perpetually met staged hulls head-on at the shared far point. The old test only asserted a single hull "stays past the mouth" — blind to road occupancy and multi-unit traffic, so it passed while the road stayed jammed. The structural lesson: a cyclic patrol cannot express "lead in, then loop" — any on-lane loop waypoint gets revisited every cycle, so staged hulls can never leave the road.

What changed:

- Core `Mover` gains an optional departure `leadIn`: a one-shot drive target ahead of the patrol loop. `advanceMover` drives it with the leg frozen (order → hold → threat → lead-in → patrol); arrival clears it and joins the loop the same tick, so the departure never repeats. Pursuit steers over it and freezes it like the leg; stuns pause it (and face it); orders and holds clear it; slope-pinned past `BLOCKED_SKIP_AFTER` it abandons to patrol. Without a `leadIn` the drive is byte-identical to before.
- `hqStagingRoute` now returns `{ leadIn, loop }`: the departure sits just past the mouth on the anchor row (past the curb ends, so the veer can only start clear of the hall), and BOTH loop points sit off the lane on the release's side (160/320 ahead, 96 lateral) — every loop leg runs parallel to the road and never crosses back onto it. Releases still alternate sides via the deterministic per-team counter, so same-side pairs at most share one off-road loop.
- `UnitMovement.addUnit` takes the departure, seeds releases at leg 0 (nearest loop point first — less time on the road during the exit veer), and `moverState`/`markDestroyed` carry/drop the field.

Important decisions:

- Departure-as-patrol-prefix, not order-then-patrol: releases keep same-tick hunt acquisition and pursuit while exiting (the holds/orders trap from the last batch still applies — ordered/holding hulls never engage). This mirrors retail TA factories (nanolathe `04-units-orders-scripts-and-movement.md` §3.8 `GetBuilt` rally inheritance: the product walks the inherited rally, then patrols).
- The curb-wall constraint stands: the first drive stays dead straight down the hall on the centerline; only the loop JOIN veers, past the mouth. `driveToward` rebuilds movers without unknown fields, so the lead-in (like pursuit's threat memory) must be explicitly re-attached after each drive step.
- Post-fix repro: per-hull road time 65–71% → 1–5% (exit drives only), post-exit road occupancy 0 ticks out of 4199, loopers stay 147+ past the mouth.

Tests: 4 new core `departure lead-in` tests (drive-then-join, pursuit override + preserve, slope abandon, order/hold clear vs stun survive — all observed failing pre-change); rewritten `hq.test.ts` staging geometry (loop fully off-lane, departure just past the mouth); rewritten renderer staging tests (single-release exit-then-veer, plus a 4-release road-occupancy regression test that fails on the old shape).
