---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Engaged guns snap to their target across the range gate: the current aim counts as admitted within a 150-unit sticky margin, so range-edge jitter holds instead of flickering — plus a pinned hysteresis contract and full AI target-selection coverage.

## Task writeup

The brief suspected guns re-pick a new target every volley, and that this target-switching is why big enemy groups read as stationary and quiet. Part 1 disproves the mechanism but confirms a smaller real gap; part 2 closes it; part 3 pins the whole contract.

## Part 1 — diagnosis (target-switching is NOT the cause)

Measured headless through the real combat pipeline (`CombatFx.update`, scratch probes since deleted):

- 1v1 / 3v3 / 6v6 flash lines, 60 s each: **0 target switches** in every run. Guns hold their aim across volleys — the `STRATEGY_STICKY_WEIGHT` (200) bonus in `pickStrategicTarget` is live on the exact path the scheduler uses (`pickLivePair` passes `sticky: pending.get(attacker)`), and the pending aim persists across volleys, so re-picks agree.
- Dynamic regimes (scripted ±120u strafe orbits, 700→350 advances): 1–2 switches per 60 s across 12 guns.
- Kill-rich hammer brawls (10–11 kills / 120 s, splash chains): 0–1 steal-switches. All other re-aims are correct kill-forced re-acquisitions.
- A simplified grid model of the scoring dynamics alone (uniform attacker draw + `pickStrategicTarget` re-picks + evolving hp, no movement/traverse/scheduler nuance): 0–1 steals per 200 volleys across seeds.

So guns already snap. The actual measured cause of "big groups not shooting much" is the **single shared ambient timer**: total battle-wide throughput saturates at ~1.3 volleys/s regardless of group size (19.5 volleys/gun in 1v1 → 6.6 in 6v6 → ~3/min/gun in a 24-hull battle). That is deliberate documented architecture ("single interval scheduler standing in for per-slot reload timers") with pacing/perf caps built around it — redesigning cadence is a separate follow-up task, not taken here per the gun-target-selection scope. The one genuine switching gap found is the **admitted-tier cliff**: a current target stepping 1 unit past `maxDist` instantly loses to any admitted challenger, restarting traverse — no hysteresis on the range gate.

## What changed

- Core (`packages/core/src/units/strategy.ts`): new `STRATEGY_STICKY_ADMISSION_MARGIN = 150` — the engaged (sticky) candidate in `pickStrategicTarget` counts as admitted out to `maxDist + margin`. Within-tier scoring is untouched, so a clearly better admitted challenger still steals on the score (hysteresis, not a lock), and dead/past-margin targets drop promptly. Degenerate gates (`maxDist <= 0`) admit nothing, exactly as before. No caller changes needed — both scheduler paths already thread through this function.
- Docs (`docs/architecture.md`): one clause on the strategy row for the range-gate hysteresis. README needs no change (scoring refinement, no user-visible feature).
- Tests — core (`packages/core/src/units/strategy.test.ts`, +9 "gun stickiness (snap)"): holds across 10 volley re-picks while a rival is chipped; prompt switch on kill; holds 1 step past the gate; ±1 edge pins at exactly `gate + margin`; absolute 150 pin (cadence precedent); quantified steal threshold (challenger must be strictly >200 closer, equality goes to lowest index — both index orders pinned); focus needs 2 teammates (340 > 200 > 170) to pull; near-dead (missing 0.8) steals while chipped (missing 0.7) holds; clearly-better challenger still steals past the gate (not-a-lock pin).
- Tests — web (`apps/web/src/renderer/combatFx.test.ts`, +4 "CombatFx gun stickiness (snap)"): the only engaged gun's volleys all land on one target across scheduler re-picks with everyone alive; white-box kill re-acquires promptly; the range-gate regression (holds a target at gate+50 silently for 4 s of guaranteed re-picks, then drops a target at gate+250 and re-engages with live fire); the committed part-1 repro shape (6v6 lines, 30 s: switch rate < 0.05/volley, throughput floor ≥ 20 volleys so the hysteresis can never silence guns).
- `.changeset/gun-target-snap.md` (new) — **patch** for core + web (AI scoring refinement + tests).

## Important decisions

- **Fix the gap that exists; report the cause that matters.** Switching was already ~nil, so no weight retune could move group fire rates. The admission-margin fix closes the one real flicker path (range-edge re-aim storms during approaches/retreats), and the writeup names the shared timer as the measured volume cause with numbers, recommending a cadence follow-up instead of smuggling a pacing redesign into a targeting task.
- **Hysteresis, not a lock (nanolathe retail precedent).** Nanolathe's autonomous slots retain the current target while it stays valid and only re-acquire when retention fails (`internal/combat/autonomous.go` retention shortcut + `ReconsiderTarget` in `modern_targeting.go`/`rules.go`: keep while live/enemy/visible, drop when invalid). Ported as scoring hysteresis rather than a hard lock: the engaged target keeps a 200 pull + 150 range slack, but death, true range loss, and strictly-better challengers all still switch promptly — self-defense answers via `trackThreat` feed the same sticky preference and keep working.
- **150 covers jitter, not maneuvers.** Sized to several 48u strafe steps / separation shoves of boundary noise between a gun's volleys, small against 850–1050 admissions; a steadily fleeing target still outruns it in seconds and the launch gate holds fire past max range either way.
- **Left the focus tally inclusive.** The attacker's own pending aim counts toward its target's focus tally (extra stickiness, existing tuned behavior); excluding it would weaken the snap to "fix" a number no probe shows as a problem. The contract pins quantify the margin with explicit tallies instead.

## Verification

- New core tests observed failing before the fix (tier cliff returns the challenger; margin import undefined), green after. The web range-gate regression was verified to fail with the fix stashed (both strategy files) and pass with it; the other new web tests are contract pins passing either way. (One iteration caught a vacuous 1 s hold phase that could end before the first timer expiry — extended to 4 s so re-picks are guaranteed.)
- `yarn workspace @scorched-3d/core test`: 26 files / 695 tests pass (9 new). `yarn workspace @scorched-3d/web test`: 812 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion, confirmed identical on the untouched tree via `git stash`. `yarn typecheck` (3 tasks) and `yarn build` both green. Playwright not run (per task rules).
