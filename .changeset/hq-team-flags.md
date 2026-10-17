---
"@scorched-3d/web": minor
---

Team-colored HQ flags: each HQ factory now flies its side's colors from a steel flagpole on the rear roof crown, so team identity reads at a glance from any orbit angle.

## Task writeup

Each HQ previously carried team identity only via the ground ring, architecture trim stripes, and HUD/minimap — nothing vertical. `buildHq` now adds a `hq-flag-mast` group seated on the rear roof crown (`HQ_FLAG_X = -40`, `HQ_FLAG_BASE_Y = 36`): a tapered steel pole (`hq-flag-pole`) with a finial ball (`hq-flag-finial`) flying a team-colored cloth plane (`hq-flag`, 20×11 world units) that streams rearward (-X local, away from the door + beacon).

## Decisions

- Color source of truth: `TEAM_DEFS[team].color` directly — the same source the ground ring (`teamRingColor`) and architecture trim use, so the flag can never drift from the other identity markers.
- Plain `MeshLambertMaterial` with `DoubleSide`, no emissive: matches the factory-surface convention (pinned by the "reads as a factory" census) and lets the existing wreck char pass kill the team color with no extra quench logic (unlike the emissive beacon stack).
- Mast rides one group so `poseHqWreck` topples it in one write (lean 0.22 rad, sink 2u); team 1's canvas mirror keeps the cloth streaming toward its own map edge. Disposal is free via `HqFx`'s generic traverse.
- Draw budget: the `hqModel` geometry budget goes 40 → 43 draws (38 base + 3 mast meshes), same headroom as before — precedent is the halo-layer budget bump in the AAA muzzle-flash task. Triangles still far under budget.

## Files

- `apps/web/src/renderer/hq.ts` — `HQ_FLAG_*` constants, mast build in `buildHq`, `getHqFlag`/`getHqFlagMast` accessors, mast topple in `poseHqWreck`.
- `apps/web/src/renderer/hq.test.ts` — new `hq team flag` suite (3 cases: mast seating + cloth color/geometry per team, null accessors on plain groups, wreck topple + char idempotence).
- `apps/web/src/renderer/hqModel.test.ts` — draw-budget bound 40 → 43 with rationale comment.

## Verification

- `yarn workspace @scorched-3d/web test` — 836/837 pass; the single failure (`deployPages.test.ts` branch assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated.
- `yarn workspace @scorched-3d/web typecheck` — clean.
- No core changes, so no core rebuild needed. Playwright not run (per task rules).
