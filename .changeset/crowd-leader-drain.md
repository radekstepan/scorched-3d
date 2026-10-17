---
"@scorched-3d/core": patch
---

Converging units no longer orbit their waypoint in a permanent pinwheel: crowds now elect a roster-order leader that creeps through the parting crowd push-free while everyone else yields, so converges serialize instead of cycling — and degenerate coincident patrol loops rest instead of dithering off their post.

## Task writeup

The "dance" had two mechanisms, both measured headlessly through the real `advanceMovers` pipeline:

1. **Mutual sidestep circulation in crowds.** Every conflicting pair counter-steps the same rotational way; in a four-way converge the sidesteps sum to a coherent circulation, so the pack orbits the shared waypoint at slow-zone gaps (48–55u) with nothing moving but the rotation — measured: nobody arrives in 3600 ticks, net mean rotation −5 rad over 1800 ticks.
2. **Coincident-loop dither.** Degenerate patrol loops (`planRoutes` pads with spawn copies when no gentle ground is nearby) arrive-and-advance onto their own position every tick, re-aiming each time — measured: 157u of wander over 600 ticks for a hull with nowhere to go.

## What changed

- Core (`packages/core/src/units/movement.ts`): crowd-leader drain —
  - new `slowContacts` (crowd gauge: neighbours of any index in the slow zone) and `yieldsToLeader` (true while an elected lower leader sits in the slow zone) helpers;
  - `advanceMovers` elects leaders in roster order: an unordered hull with a loop to drive, 2+ slow-zone contacts, no elected lower leader in its slow zone, and neither holding nor stunned. Pairs (one contact) keep the tuned mutual regime — only crowds defer. A leader takes no separation push at all and creeps at `ORDER_SPACING_FLOOR` instead of stopping in the stop zone, walking straight through while the crowd parts around it (full push, faster than the creep, so nobody stacks). Coasting leaders keep the drive pause — a push-free leader can never re-arm, so the pause always lifts and the creep resumes;
  - `resolveSeparation` takes the elected `leaders` array (module-private; single caller) and zeroes the push for leaders, still draining a stale coast budget exactly once through the no-push path;
  - `advanceMover` rests on coincident next waypoints (already there: advance the leg, clear `stuck` like any arrival) instead of driving onto its own position. Real loops never land here (waypoints sit ≥12 cells apart), so only degenerate loops change.
- Core (`packages/core/src/units/movement.ts`, verification fix): leaders are elected sequentially and each hull yields only to an *already-elected lower leader* — hulls that cannot lead (holders, ordered, stunned, routeless) and lone passers-by never suppress the drain. Yielding to any lower index instead lets one parked hold veto the drain for a whole crowd permanently (found by a headless probe: 0 arrivals in 5400 ticks, ~12 rad swept each; fixed: all arrive by tick 892, identical to the no-suppression control).
- Core (`packages/core/src/units/movement.test.ts`): new `crowd circulation` describe (four-way converge passes through; converge around a lowest-index held hull drains) plus the coincident-loop rest test in `advanceMover`.
- Docs (`docs/architecture.md`): movement row notes the drain. No README change (behavior tuning, not architecture).

## Important decisions

- **Slow-zone key, not stop-zone.** Converges orbit at slow-zone gaps (48–55u), dipping inside only intermittently — a stop key would never engage and the pinwheel would spin on.
- **A total index order, hence acyclic.** Yield edges point strictly from higher to lower indices, so leadership can never cycle; as a corollary, any two simultaneous leaders sit more than a slow radius apart (a leader in your slow zone suppresses you), so leaders never interfere.
- **Yield-to-elected-only over yield-to-any-lower.** The draft's any-lower rule reintroduces a permanent pinwheel whenever the crowd's lowest index is ineligible — a player-held hull parked anywhere near a converge is the common, persistent case. Elected-only keeps the acyclicity proof (strictly lower indices) while closing the hole, and the sequential election is well-founded (`yieldsToLeader` reads lower indices alone) at the same O(n²) the snapshot already pays.
- **Nanolathe: checked, nothing applied.** Sibling `internal/movement` (`traffic_steer.go`, `traffic.go`) uses "leader" for convoy following — a same-way mover ahead on a route that followers queue behind — and resolves crowding with footprint-grid occupancy plus arrival dwell timers. There is no continuous steering-separation loop to borrow a circulation-breaker from, so the roster-order election is designed from the local measurements above.

## Verification

- New tests observed failing pre-fix: the two draft tests fail on base implementation via stash A/B (exactly 2 fail, 100 pass); the holder test fails on the draft election via a one-line revert (holder test fails, four-way sibling passes).
- Headless interaction probes (temporary, removed after use): an ordered crosser arrives through an active crowd (order clears ~tick 929, patrol drains); pre-armed coast budgets drain (pause lifts, creep resumes — the comment's claim); a mid-converge stun drains; holder-heart drains post-fix.
- `yarn workspace @scorched-3d/core test`: 26 files / 712 tests pass (3 new). `yarn workspace @scorched-3d/web test`: 836 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion, stash-verified on the untouched tree this session. `yarn typecheck` (3 tasks) and `yarn build` green.
