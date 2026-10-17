---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

HQ reinforcements finally clear the exit road and entrance for real: the one-shot departure now runs all the way to off-road staging before any pursuit steers the hull, so new units can never park at the door or on the road while deciding whether to fight.

## Task writeup

Why the previous fix (521f1b3, "releases depart straight, then stage fully off the exit road") didn't hold in the real game: its departure assumed a release with no orders, no holds, and no pursuit would simply walk out — but in a live battle every release acquires a team-advance memory same-tick (its side already knows the enemy), and pursuit steered *over* the frozen departure. A headless repro against the real spawn+drive pipeline (default map, both HQs, full rosters, real hunt/advance sweep — the sterile single-side test was blind to all of it) quantified the failure: zero of eight releases ever completed their departure in 4 minutes of game time. Each lone release read the odds at the far contact as unwinnable, so the outnumbered hold parked it at the spawn (in the hall, 16–24 s at a time), and the sweep's per-tick advance refresh never let the hold expire — releases only moved in pairs, when the next spawn flipped the odds. One HQ's road sat occupied 100% of the post-exit window with per-hull road time up to 99.8%.

What changed:

- Core `advanceMover` runs the departure ahead of pursuit, and the departure completes AT the loop in two latched phases: the straight walk to the via point past the mouth (the curb-wall constraint stands — the veer can only start past the mouth), then the join leg onto the loop. A live threat ticks underneath the whole exit (expiry validated, the guns keep answering it) but never steers until the hull reaches staging — so any odds-hold waits off the road instead of parking at the mouth. The phase latches by rewriting the departure target to the loop point once the via is reached: an earlier rim-check version flapped the target back to the via and dithered hulls on the rim (caught by the new tests before it ever ran anywhere else).
- Post-fix repro on three maps: per-release road time 1.5–9.1% (exit walks plus combat marches only), entrance time down to the ~4 s exit walk, and post-exit road/entrance occupancy 0.0% on greenreach and dustplains for both HQs. On highpass (Ashen Pass) the forts site ~1000 units apart straddling one pass corridor, so the late-window road reads busy — occupier sampling confirms that is the mustered battle plus release marches to it (transient combat traffic, per-release road ≤8.2%), while release entrance occupancy is ≤3.7% (~3 s transits, one a cross-map HQ raid).

Important decisions:

- Departure-as-rally, extended — not exit-gating: retail refuses to pile products onto a blocked exit (nanolathe `04-units-orders-scripts-and-movement.md` §3.8: blocked-exit validation retries in 15 ticks), but the measured failure was pursuit parking, not spawn overlap (4 s exits vs 15–35 s cadence), so gating the door would have papered over the real bug. The fix keeps the `GetBuilt` rally-inheritance precedent from the last batch (the product walks the rally, then patrols) and extends the rally to staging; stock retail mobiles are maneuver + fire-at-will (`R-STANCE-01` §6), which is exactly what the exit does now — the march continues while the live memory keeps the guns answering.
- Releases stay acquirable: memories still attach same-tick and the guns answer during the exit — only steering waits for staging. The holds/orders trap from earlier batches still applies and is untouched.
- The old "pursuit steers over the departure" core test was rewritten, not weakened: the precedence change is the deliberate contract fix, and the new tests pin both halves (departure drives while the threat ticks; pursuit steers the tick the loop joins).

Tests: 2 rewritten + 1 new core `departure lead-in` tests (two-phase exit with latch, departure-before-pursuit with ticking threat, outnumbered-exit regression with a hold-armed control — all observed failing on base); 1 new renderer regression (`walks a release under fire all the way to staging instead of parking at the door`: release + spotter-shared intel + frozen enemy pair through the real `UnitMovement` sweep, asserting the advance memory is live mid-exit yet staging is still reached — observed failing on base with the departure never lifting).
