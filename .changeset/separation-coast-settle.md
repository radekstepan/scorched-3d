---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Close-packed hulls no longer jitter: separation exits now glide on a short decaying coast instead of chattering against the homing drive on the stop radius.

## Task writeup

The user's assumption was right about the culprit but the mechanism needed measuring: it is not the sidestep sign flipping or renderer tremble, it is a bang-bang limit cycle between the constant-magnitude separation push (hard cutoff at the 48u stop radius, evaluated on post-drive positions) and the homing drive (0.5 crawl just outside). A headless probe through the real `advanceMovers` pipeline showed the pair gap sawtoothing 48.0↔49.0 every other tick — ~1u peak-to-peak at ~30 Hz — for as long as waypoints pull through each other, plus indefinite pinning at the boundary for pack advances. Ordered crossings were already smooth (the task-72 goal-opposed radial strip) and plain holders already settle (no return force: per-tick step ends at exactly 0), which fenced the bug to drive-vs-push opposition at the boundary.

## What changed

- Core (`packages/core/src/units/movement.ts`): separation gains an exit coast —
  - `Mover.sep` carries a remaining coast budget (world units along the last applied push heading; absent — never zero-length — once drained, walled off, or superseded);
  - `SEPARATION_COAST_DISTANCE = 8`: every fresh push that moves re-arms a full-budget glide along the applied heading; `resolveSeparation` drains it at `SEPARATION_SPEED` past the radius, ending exactly (last tick takes only the remainder), degrading to axis slides against terrain and absorbing against walls instead of banking motion;
  - the coast heading is frozen on purpose: the applied step stays continuous across boundary crossings instead of toggling 0↔full every other tick, which kills the chatter by construction;
  - `advanceMovers` pauses unordered drive while a coast is armed (one place, via the new `validSep` helper — `driveToward` rebuilds movers without the field, so the budget is re-attached onto driven steps next to the resolve). Ordered hulls are exempt so explicit orders stay alive (their floor drive is slower than the glide, and the goal-opposed strip keeps the two from fighting head-on);
  - explicit holds never arm the coast (no drive to chatter against, so they stop on the radius instead of gliding past their parking spot), and `orderMover`/`holdMover` strip a stale budget like the departure lead-in.
- Core (`packages/core/src/units/movement.test.ts`): new `separation coast` describe (8 tests: three no-chatter sims across slow/fast/crossing/converging shapes, exact holder settle, exact budget drain, wall absorb, drive-pause with ordered exemption, order/hold strip). The adjacent-ordered deadlock bound widens from arrival-slop-only to arrival slop + one coast glide — the old bound held with 0.48u of margin and pinned post-arrival stillness separation was never contracted to keep (the sibling hull already rests 33u+ past the goal).
- Web (`apps/web/src/renderer/retaliation.test.ts`): the outnumbered-loser test pins winner path length (>150u in 10 s) instead of endpoint displacement (>30u). The coast changes orbit phase, not strafing effort — measured winner travel went UP on the fixed code (163–231u → 238–296u) — so the endpoint pin was phase-fragile; the rewritten test passes on base too.
- Docs (`docs/architecture.md`): movement row notes the coast. No README change (behavior tuning, not architecture).

## Important decisions

- **Hysteresis-in-time over ease bands.** A stateless fix cannot work here: ramping the push inside the radius creates a lean equilibrium (drive balances push deep inside, patrols stall leaning on each other forever — computed d≈21–46 depending on ramp width), and an outer ramp band does the same outside the radius while regressing the task-72 convoy verdict. Only memory breaks a bang-bang cycle without a lean, so the push keeps its constant magnitude inside (finite-time un-stack untouched) and decays in time past the boundary.
- **Drive pause over a faster coast rate.** A +10 coast-rate margin did not move the fast-hull residual (flash cross held at 23 flips): the pair axis rotates under the frozen heading until any fixed rate sinks back inside. Pausing the unordered homing drive while the glide runs removes the opposition instead of outrunning it, and needs no per-kind rate knob. The pause always lifts (the budget drains in finite time), so it cannot deadlock.
- **Nanolathe: checked, nothing applied.** Sibling `internal/movement` (`crowded_arrival.go`, `traffic*.go`, `overlap_rules.go`) resolves crowding with footprint-grid occupancy plus arrival dwell timers — there is no continuous steering-separation loop to borrow a settling shape from, so the coast is designed from the local measurements above.

## Verification

- Chatter flips (gap reversals within ≤4 ticks) per 900-tick sim, base → fixed, via stash A/B: hammer cross 66→0, boundary start 95→0, triple 28→0, pack advance 23→0, peewee pack 89→0, flash cross 51→0; ordered cross 0→0 and holders 0→0 unchanged. Remaining flips sit ≥13 ticks apart (passes and slow jostling).
- New tests observed failing on base (7/8; the holders-settle pin passes there as designed — it guards the brief's settle criterion).
- `yarn workspace @scorched-3d/core test`: 26 files / 679 tests pass (8 new). `yarn workspace @scorched-3d/web test`: 785 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion, stash-verified on the untouched tree twice this session. `yarn typecheck` (3 tasks) and `yarn build` green. All three task-72 arrival-tick bounds pass unmodified. Playwright not run (per task rules).
