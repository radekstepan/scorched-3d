---
"@scorched-3d/web": patch
---

Let tanks finish aiming and return fire when several enemies attack them in a forest.

Diagnosis: the damage hook called `trackThreat` on every incoming hit, unconditionally replacing the gun's pending target and clearing its overshoot latch. This bypassed the scheduler's existing sticky target score. Alternating attackers could restart the traverse faster than the turret could settle, so a ready weapon pointed between enemies without firing. A regression with a real Stumpy model, two independently firing Flash attackers, surrounding standing trees, external hull control and burst-cadence threat callbacks produced zero defensive rounds before this fix and at least two in 2.5 seconds afterward.

Threat-driven acquisition now retains an existing live hostile target while it remains within the same admission range plus sticky margin used by strategic targeting. Dead, missing, friendly or distant targets release the aim, and direct friendly threat calls are refused. Inspired by Nanolathe's retain-before-acquire weapon scan (retail executable spec 06 §3), this is deliberately confined to damage notifications: the strategic scheduler can still pick a better target. Movement retaliation still records incoming threats, per-unit reload clocks remain independent, and every shot still passes the terrain/tree launch gates and existing obstruction-reposition pipeline.

Verification: new regressions cover multiple attackers in a forest, acquisition release after destruction/retreat, and friendly threat refusal. The combat and retaliation suites also cover blocked forest shots, lane clearing, lateral obstruction movement, per-unit weapon clocks and legacy unteamed fixtures. No Playwright was used. This is a local acquisition fix, with no new movement or combat architecture.

Checks: all 727 core tests and 187 combat/retaliation tests, workspace typecheck and production build pass. The full web run passes 942 tests with only the pre-existing Pages workflow test failure (expects `main`, workflow uses `master`).
