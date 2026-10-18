---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Factories produce reinforcements indefinitely while they stand: a live HQ no longer goes silent after 4 releases, so late battles never stall with a lone survivor and quiet factories

## Task writeup

The report: something off — a peewee left as the last unit standing, a live HQ producing nothing, the opponent destroyed.

Root cause was the HQ reinforcement clock's lifetime cap: `HQ_MAX_SPAWNS = 4` let each factory release exactly 4 units ever, then return null on every tick for the rest of the battle. Both HQs run the same clock, so both sides stopped reinforcing within the first ~2 minutes; the battle then ground down to whatever survived longest (usually a peewee — weakest hull, most-spawned at ~67% of draws, and a scout that holds at range when outnumbered) with no way to recover. The README already promises continuous production ("the factory opens its door, then it sends a new unit… if enemy fire destroys the factory, it sends no more units"), so the cap contradicted the documented behavior.

## What changed

- Core (`packages/core/src/units/hq.ts`): `tickHqSpawn` gates on `hqAlive` only — the `spawned >= HQ_MAX_SPAWNS` lifetime gate and the `HQ_MAX_SPAWNS` export are gone. `HqSpawnState.spawned` is now a running total, not a cap. Build pacing (20–46⅔ s per kind, territory-scaled), the weighted roster, and the destroyed-HQ silence are untouched.
- Web (`apps/web/src/renderer/hqFx.ts`): comment-only — `spawnedAt` documented as a running total. No logic change needed: the manager already delegates the gate to `tickHqSpawn`, and destroyed forts still skip the clock, slam the door, and pose the wreck.
- Tests: core `hq.test.ts` — the "past the cap stays quiet" case becomes "dead HQs stay quiet", plus a new regression test that drives 8 releases past the old cap and proves the clock stays armed for a 9th; the worst-case pacing test now covers 8 sustained releases within `20 + 7 × 140/3` s across 5 seeds. Web `hqFx.test.ts` — the cap test becomes an indefinite-production test (>4 releases, twin-seed determinism, `spawnedAt` equals deliveries).
- Docs (`docs/architecture.md`): the HQ row's "per-side cap of 4" clause becomes "indefinite production while the works stands". README needed no change — it already described this behavior.

## Important decisions

- **Remove the cap, don't raise it.** Any lifetime total re-stalls eventually; the ambient battle is meant to run by itself with no end screen, so only destruction stops a factory. Production (~1 hull per ~23 s per side) stays well below the rate combat removes hulls, so rosters stay bounded by battle, not by a counter.
- **Keep `spawned` as a stat.** The HUD status shape is unchanged; the counter now reads as a running reinforcement total instead of progress toward a cap.
- **Drain the door in the indefinite-production test.** `spawned` increments on the clock draw while `onSpawn` lands at door full-open, so a loop that ends mid-slide shows one more draw than delivery (15 vs 14). A small post-loop tick completes the delivery without firing the next clock (rearm ≥ 20 s) — the old cap masked this because it let the door drain after the final draw.

## Verification

- `yarn workspace @scorched-3d/core build` (web tests resolve core via `dist`), then `yarn workspace @scorched-3d/core test`: 804/804 pass.
- `yarn workspace @scorched-3d/web test`: 1060 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. Playwright not run (per task rules).
- `yarn typecheck` green across both workspaces.
