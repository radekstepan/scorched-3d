---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Defenders now answer rapid attackers instead of only taking hits: stunned hulls stagger to face their live attacker (orders and departures still win the heading), and hulls facing a live threat turn at combat urgency — full traverse until the gun bears, then the deliberate pivot settle — so a 1v1 defender brings its turret into action mid-duel.

## Task writeup

The brief suspected the first unit to fire stuns the enemy so it cannot respond, and asked that — first-hit feel kept — the defender fight back from then on. Headless measurement against the real `advanceMovers` + `UnitMovement` + `CombatFx` loop (teamed 1v1, fixed seed) confirmed the mechanism and found it is about *facing*, not the gun: stun never blocks the gun (per design), but a stunned hull turned toward its patrol leg instead of its attacker, and every held facing crawled at the 0.35× pivot floor.

Repro (before): hammer with its back to a peewee at 500u — the hammer's hull oscillated between patrol-facing stuns (peewee beat 0.09–0.28s vs 0.15s+ stun per hit ≈ 54% stun uptime) and threat-facing pursuit gaps, all at 0.455 rad/s, while its ±50° turret flipped between its traverse stops; aim error never closed and the hammer died having fired **0 volleys** (peewee untouched). Flash-vs-peewee was near-total suppression too (3 volleys, 0.10 dealt). Tank-vs-tank duels were already symmetric, and a stun-ablation run (hook unwired) proved stun is not the whole story — the pivot floor alone needs 6.9s for a 180° facing.

## What changed

- Core (`packages/core/src/units/movement.ts`): `tickStunned` faces a live threat memory (last-known position) when the mover carries no order, departure, or hold — slotting between departure and patrol leg, mirroring `advanceMover` steering priority — while the drive stays held, the order cursor frozen, and the recoil slide untouched (first-hit stagger feel preserved). New `urgent` flag on `turnHull`: threat-facing while held hurries at full traverse past twice the kind's turret traverse, eases to the pivot floor across the band, and pivots at the floor once the error is inside the arc — the hull hurries exactly until its gun can bear, then settles. All three pursuit hold-facing sites (outnumbered hold, sidestep arrival, stand-off hold) and stunned threat-facing pass it; patrol/order/departure/hold facing, rolling turns, and corrupt-input handling are bit-identical.
- Docs (`docs/architecture.md`): one clause on the `facing.ts` row for combat urgency. README needs no change (its "each blast … pointing the hull at its live shooter" claim is now *more* true).
- Tests: `movement.test.ts` (+7: stunned-threat direction, full-rate urgency stunned + holding, in-arc floor preservation, urgency-band shape, orders-win, expired-memory fallback) and renderer `retaliation.test.ts` (+1 full-loop hammer-vs-peewee pinned-volley regression). The 4 behavior tests plus the integration test were observed failing before the fix (0 hammer volleys); the 3 preservation pins passed throughout.
- `.changeset/retaliation-combat-urgency.md` (new) — **patch** for core + web (drive-feel fix, no exported API changes).

## Important decisions

- **Face through the stun, don't shorten it.** Retail TA stuns binary (stopped *and* silent, then resumes — nanolathe `06 §10`), and only paralyzer weapons stun at all; this codebase's every-hit recoil-stun is its own feel invention. Shortening it would make hammer-under-fire drive on indifferently (the thing task-55 fixed), so the stagger (recoil slide, drive hold, visible rock) stays on every hit and only the *heading* changes: "stun the drive, not the gun" (task-47 principle), completed — the gun now answers through the recoil.
- **Urgency knee at the turret traverse, not a flat fast rate.** Task-186 deliberately slowed held facing (45° in ~0.35s read as a snap) and pinned it; a flat full-rate threat-facing would revert that. The knee resolves both tasks: inside the arc the gun already bears so the hull settles deliberately (186 regime, pinned bit-exact), outside it the gun is provably silent so the hull hurries. Per-kind by construction (hammer hurries until ±50°, peewee until ±90°).
- **Peewee-vs-tank DPS left alone (named follow-up, not smuggled).** After the fix every defender returns fire (hammer 0→6 volleys, 0.00→0.66 dealt; flash 3→8; stump 6→8; commander 9→11), but the peewee still wins 1v1s on DPS (0.03 @ ~0.185s + 0.06 grenades out-rates tank guns even with the stun hook unwired). Rebalancing the value table is a separate tuning task with map-wide consequences — cf. the task-184 precedent.

## Verification

- After: hammer-vs-peewee-back 6 volleys / 0.66 dealt (was 0 / 0.00); hammer-vs-flash duel resolves 2× faster (1196→547 frames); tank-vs-tank outcomes unchanged (strong still wins).
- `yarn workspace @scorched-3d/core test`: 28 files / 772 tests pass (7 new). `yarn workspace @scorched-3d/web test`: 962 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-branch assertion (untouched by this change). `yarn typecheck` (3 tasks) green. Playwright not run (per task rules).
