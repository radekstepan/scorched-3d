---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Ordered groups hold formation on arrival instead of dancing: a move order now completes into a posted guard (retail MOVE-arrival semantics), so units ordered home fan into their formation slots and stay there — each arrival adding to the formation — with shoved arrivals stepping back onto their slots once traffic clears.

## Task writeup

Task: "I have 17 units selected. They destroyed HQ. Back at their own HQ. They do this 'dance' driving around. Looks odd. They should create an orderly formation and keep adding to it."

### Root cause

A move order's arrival rejoined the patrol loop (`advanceMover` returned `hold: false` on the final waypoint). Seventeen units ordered home would each peel off onto its own patrol route the moment it arrived — crossing lanes, spacing stops, and separation jostling turned the base into a permanent dance. Retail TA does the opposite (nanolathe `04-units-orders-scripts-and-movement.md` outcome table §8): MOVE arrival is code 5 complete (unit idles), only PATROL arrival rotates to the next point.

### What changed

- Arrival completes into a hold (`packages/core/src/units/movement.ts`): the order clears, `hold: true`, and the destination is recorded as a new `Mover.post` guard slot. A live self-defense memory ticks out in place but never steers a held hull — the guns keep answering it via the existing scheduler/`trackThreat` path, which never read `hold`.
- Guard-post return (same file): a posted arrival shoved off its slot steps back once its drive is unblocked (spacing > 0, i.e. exactly when no separation push acts on it — so the return can never chatter against a shove). Inside arrival slop it rests exactly; slope pins hold facing the post and retry (the post is never skipped); new orders, explicit holds, and wrecks strip the post.
- Returning holders strip goal-opposed separation like ordered hulls (`resolveSeparation` + new `postGoalDir`): without the strip, the homing drive equilibrates with the radial push into a static pocket hover around a settled mate (measured: stuck 70u out forever); the kept sidestep slides the returner around the shell until the post clears. `steerGoalDir` still reads holders as null, so pair-tangent convoy checks are untouched.
- Static holders take radial push only, never the sidestep: each passing straggler's lateral shove walked holders ~5u off-slot, accumulating to 100u+ over a 17-hull arrival stream and hollowing out the fan core. Radial passes cancel (approach reverses as the straggler recedes), so holders wobble in place; radial unstacking still opens piled-up arrivals.
- Measured settle (deterministic core sim): 17-hull clustered group — all within 15u of fan slots, pairwise ≥ 48, zero drift over 300 extra ticks. Weave-torture 6-hull (every lane crosses the core) settles to 14u.
- Ambient game untouched: the AI never issues move orders (patrol/departure/threat only), so uncommanded play resolves byte-identically.

### Tests

- Rewrote arrival-contract tests to hold-on-arrival: core `pathfinding.test.ts` (cursor + hold + post + memory pins), core `retaliation.test.ts` (memory ticks out, never pursues), renderer `movement.test.ts` (holds destination, new order re-drives), renderer `retaliation.test.ts` (answers fire, holds, memory expires, stays).
- Reworked the obstacle-jitter `runPhases` fixture from order-then-patrol to pure patrol (orders can no longer deliver hulls into a lapping phase): completion now reads hull-to-goal proximity; bounds re-measured honestly (patrol full-stops serialize where ordered floor-creep flowed — slowest file-of-four crossing 1812 ticks).
- New: core `arrival formation` block (6-hull weave + 17-hull reported scenario with exact-rest pins), core `guard post` block (7 tests: step home, blocked stand, exact rest, NaN strip, order/hold strip, memory ticking, axis-aligned unstacking), renderer `holds group arrivals in formation as stragglers join` (end-to-end `orderGroup` through `UnitMovement`).
- `yarn typecheck` clean, `yarn build` clean, core 826/826 green, web 1117/1118 (sole failure is pre-existing `deployPages.test.ts`, which fails on the untouched tree — it expects `branches: ["main"]` while the repo uses `master`; unrelated, left alone).

### Decisions / non-goals

- Held arrivals do not chase (no hunt acquisition, no threat recording — the pre-existing `hold` contract); guns still fire in range. Chasing would break the formation the task asks to keep.
- Attack-order completion still resumes patrol/chain-hunts (threat-memory path, not move orders) — out of scope for this task.
- Cross-order slot allocation (a second group order reuses slots 0..n rather than filling around the parked formation) deliberately not implemented: the task's "keep adding to it" is the stragglers-into-the-fan case, which now works.
- README not updated: it documents no player-order behavior at all (still says "You give no orders"), so there is no order-behavior section to extend — documenting the order system is a separate task.
