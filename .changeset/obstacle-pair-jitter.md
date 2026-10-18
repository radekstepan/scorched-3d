---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Units no longer jitter back and forth when clearing an obstacle: patrol pairs that met head-on now arc around each other at a floor crawl instead of shuttling in and out of the stop radius, pinned detours skip past the unreachable point instead of republishing the same detour forever, and separation judges ordered pushes against the live steering point (the detour corner while rounding a rock, not the far order cursor).

## Task writeup

Task: "Sometimes units struggle to clear an obstacle and 'jitter' back and forth. Investigate and fix. Maybe because unit is close to a rock? Trying to clear a hill?"

## Investigation: two mechanisms, not one

Probed with temporary `zz-*.test.ts` fixtures (since deleted) around a sheer 3×3 rock pillar plus open-field pair shapes. Per-tick step dots proved useless as a metric — velocity is ~0 at every turnaround, so even a violent 8u shuttle is made of micro steps — and position-recurrence conflated bounce with smooth circling. The metric that survived is windowed-heading flips: travel direction over a trailing 10-tick window must reverse. Findings:

1. **Boundary hover.** A pair's pre-tick gap sits just outside `STOP_RADIUS` (~48.4u); the driven step dips in, the separation coast shoves 8u back out, the homing drive pulls straight back in — a ~40-tick shuttle with zero net progress. Base rate on the pack-advance fixture: 89 chatter flips with the gap pinned at [48.0, 49.0].
2. **Detour skip-cycle.** A patrol hull shoved off its route mid-detour with the return blocked pins against a detour point it can never capture; abandoning the leg republishes the same detour, churning legs (30 flips / 7200 ticks) while neighbours bounce off it.

A third shape — slow loitering/orbiting at a frozen detour point on sheer pillars — is a known residual (see below), not a shuttle.

## What changed (`packages/core/src/units/movement.ts`)

- `pairTangent()` (new, exported): a 1u fixed-sense arc target around the single close neighbour — the same rotational sense as the separation sidestep (`(-rz, rx)` of the away axis), so drive and push lean the same way and the pair always counter-arcs. Pure pairs only: fewer than two slow contacts, motion-pure intent (no order, hold, live threat, or departure), same leg, strictly obtuse steering intents (convoys keep hold-and-part). Engages on a live stop-zone neighbour and stays engaged while an armed coast budget commits the hull to the exit (the hover sits just outside the radius, so a strict live gate alone never opens); the committed arc is never re-gated, so nothing can flap on it. Gap-neutral perpendicular motion spirals past instead of bouncing.
- `advanceMovers()` computes one tangent per hull and threads it through `advanceMover()` → `driveToward()` as a drive-target-only override: arrival and leg bookkeeping still judge the leg, and the detour is preserved (frozen) and resumes once the pair opens. Tangent hulls keep the spacing floor and skip the coast pause — pausing would pin them static inside the radius, the exact standstill the arc exists to break out of.
- `skipDetourPoint()` (new): when a patrol skip fires with a detour point active, the route advances past the missed point (last point consumes back to homing, which skips the leg in turn) instead of abandoning the leg — progress stays monotone.
- `steerGoalDir()` (new, exported; replaces `orderGoalDir`) + `pickSteerTarget()`: the live steering intent in drive priority (detour point → order cursor → departure → pursuit → patrol leg). The ordered-only goal-opposed strip on the immediate push now judges this point, so a detour round a rock steers the strip, not the far cursor. Unordered hulls explicitly keep the full divergent push (their only in-radius motion); coincident splits stay exempt.
- Walled-push drain fix: a push walled off on every axis now falls through to the coast drain instead of returning with the stale budget frozen — the frozen budget pause-locked an unordered hull's drive forever on top of the pin.

## Nanolathe inspiration

Sibling `nanolathe` retail spec `04-units-orders-scripts-and-movement.md` `[R-MOV-01 §7]`: a blocked mover "keeps turning, speed capped at half `MaxVelocity`" — it never parks at zero. The tangent arc is the same idea collapsed into synchronous steering: a pair inside the stop radius keeps a floor crawl along a gap-neutral arc instead of stopping dead and waiting for separation to unstack it. (Retail has no push at all — "no push, no stacking" — and resolves crowding through repath + caps; here there is no path-request scheduler, so the per-tick arc + separation push play that role, same observable outcome: pairs open, patrols keep lapping.)

## Decisions

- **Steer the drive, never the coast.** A long v1–v8 series tried steering the separation coast/push on live geometry; every variant flapped at pair edges or broke crowd drain (crowd reversals 57 → 151) and grazing/pack metrics. Separation push/coast stays pre-fix divergent; only the drive target arcs, and the arc decision is single-shot deterministic per encounter.
- **Pack-advance `chatterFlips` 0 → ≤1** (in `movement.test.ts`, documented): the tangent perturbs the early trajectory into one smooth S-corner knock-on late in the run — tail gap 65 vs 52 pre-tangent, hull path kinks 11 → 2. A single-pass corner, not chatter (base: 89 sustained flips); narrowing further reintroduces hover-flap. Keeps 98% of the metric's regression power.
- **Ordered strip kept although unisolated on fixtures.** All three rock fixtures measure identical ordered phases in both trees (0/2/7 flips) — the reported "ordered units jitter at a rock" shape never reproduced there; every measured win is post-arrival patrol. The retarget is the principled judgment point for exactly that shape (an ordered hull rounding a rock steers at its detour corner), with unordered behavior explicitly preserved and all suites green, so it stays; the patrol-fix carries the measured regression power.
- **No patrol-flip bound on the pack torture test by design.** Five hulls ping-ponging through one sheer pillar is adversarial: arcs trade a few rounding corners for pin-freedom (39 vs 32, both transient) and tax laps there (15 → 10). Real-map patrols (greenreach, 12 units, 3600 ticks) hold travel/lap/flip parity (+0.1% travel, 58 = 58 laps, 0 = 0 flips), so the pack test locks prompt completion and continued lapping, not the corner count.

## Verification

- New tests (13): `pairTangent` gates (arc geometry + sense, convoy/transition nulls, order/hold/threat/departure nulls, crowd/coincident nulls, committed-sticky hold + solo-glide null, intent-less partner), `steerGoalDir` priority + nulls, detour-point skip sequence (advance → consume → leg skip, never clipping the wall), and the `obstacle jitter` trio (crossing patrolFlips < 100 with base 181 → 64; file patrolFlips < 15 with base 26 → 5; pack completion + lap guards). Pre-fix trees fail the two flip bounds (181, 26); ordered-phase and completion bounds pass both trees as no-stall guards.
- `yarn typecheck` clean; full core suite 817/817 (29 files) green, including the surfaced pack-advance bound; movement/crowd/detour/retaliation subsets 239/239.
- Playwright not run (per task rules).

## Known residuals (follow-ups, not this task)

- Slow loitering at frozen detour points on sheer pillars (cross patrol still logs 64 flips): the hull orbits a point it can neither capture nor get blocked enough to skip. A dwell-timeout skip would subsume it but needs care (a hull queued behind a crowd at a corner must not skip the corner and clip the obstacle). Rare on real maps, where detour points sit on reachable ground.
- No user-visible (>0.5u-step) reversals remain on any fixture; residual flips are slow arcs and S-corners.
