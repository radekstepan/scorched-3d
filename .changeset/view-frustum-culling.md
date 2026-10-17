---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Off-screen units no longer pay for occlusion sampling, ghost syncs, or health-bar re-seats, and the forest math that dominated every tick now rejects distant trees with a cheap box check first — Ashen Pass keeps every unit driving and fighting off-screen while the camera's view costs far less to maintain.

## Task writeup

Ashen Pass (highpass) reported 29 fps. A headless tick-equivalent probe over the real map (15,075 trees, 24 units, counting `groundY` probes per subsystem) showed the frame was dominated by forest-scale work repeated every tick, plus view work for units nowhere near the screen:

- `liveStands()` rebuilt all 15,075 tree heights every tick (~16.6k `groundY` probes/tick in movement, plus double rebuilds on crush ticks), even though heights move only on crater dents and exaggeration re-snaps.
- `treesCrushedByStep` (up to 2× per unit per tick) and `trunksOnBarrel` (1× per unit) ran full closest-approach math over all 15k trees with no broadphase (~1M exact evaluations/tick).
- Occlusion sampled all 24 units × 3 taps × 16 terrain probes plus 72 full-stand tree walks per tick, synced all 24 ghost mirrors, and re-seated all 24 health bars — whether or not the camera could see them.
- Track marks (up to 320 pooled quads) set `frustumCulled = false`, so every mark drew on every frame from any camera.

## What changed

- Core (`packages/core/src/units/terrain.ts`, `combat.ts`): AABB broadphase inlined in `treesCrushedByStep` and `trunksOnBarrel` — four compares reject trees outside the step/tube box before the exact math. Bit-identical results (outside is provably past reach; boundary points still reach the exact test, strict-`<` for crush, inclusive for the tube). Inline, not a shared helper, per the task-164 lesson.
- Renderer (`apps/web/src/renderer/stands.ts`, new): `StandsCache` builds the tree-stands snapshot lazily and shares it until `dirty()` — quiet ticks cost zero probes; fell ticks rebuild once on next read.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): uses `StandsCache` (existing fell/crush/resolve dirty sites untouched), drops the per-tick null-out, and adds the two missing invalidations the audit found — crater dents (`dentTerrain`) and exaggeration re-snaps. Decays need no dirty (fallen→gone is non-standing→non-standing); ignitions never flip standing.
- Renderer (`apps/web/src/renderer/viewCull.ts`, new): `computeUnitVisibility` tests one r70 view sphere per unit against the camera frustum (r70 covers hull + x-ray taps + the lift-60 health bar). View-only gate: sim (drive, combat, damage, broadcasts) runs ungated.
- Renderer (`occlusionFx.ts`, `healthBars.ts`): `update` takes an optional `visible` array — off-screen units skip sampling/sync/re-seat and hide, re-syncing the same tick they re-enter view. Omitted/short entries default to visible (legacy callers unchanged). HQ bars stay ungated (two forts, negligible).
- Renderer (`tracks.ts`): marks keep the default `frustumCulled = true` — three.js culls the static quads exactly by world sphere, so off-screen lanes cost no draw calls.
- Tests: `stands.test.ts` (5: lazy-once, standing policy, dirty rebuild incl. crater heights, no-implicit-invalidation pin, empty forest), `viewCull.test.ts` (4: in-view/behind/side, radius margin incl. the ≥60 bar-lift bound, live-matrix freshness, empty roster), `occlusionFx.test.ts` (+1: zero probes while gated, stale-pose hold, same-tick resync, legacy default), `healthBars.test.ts` (+1: same for bars), `tracks.test.ts` (+1: culling pin), core `terrain.test.ts`/`combat.test.ts` (+2 each: boundary pins + seeded brute-force-agreement sweeps as broadphase tripwires).
- `.changeset/view-frustum-culling.md` (new) — **patch** for core + web (perf internals, no player-facing change, no README update per the hot-loop-sweep precedent).

## Important decisions

- **Cull view updates only, never sim ticks.** Movement posing was deliberately NOT gated: the seat is cheap static-field math, and combat reads live `body.position` for muzzles — stale bodies would move shots. Off-screen units keep driving, fighting, and dying exactly as before; only the readouts (ghost, bar) sleep, and they re-sync before they can be seen.
- **Explicit dirty over implicit freshness.** The stands cache cannot see damage-field writes, so invalidation stays at the audited mutation sites (a test pins that an un-dirtied fell keeps serving the old snapshot, so a forgotten dirty fails by analogy). Heights got their own two dirty sites because nothing else moves them.
- **Simple now, index later.** The remaining ~15k-iteration walks (broadphase rejects, visible-unit occlusion taps, capped spot counts) are the measured follow-up and want a uniform-grid index over the static tree XZ — deliberately left out as the elaborate half of this task. Likewise skipped: occlusion staggering (ghost lag for little gain once gated), waypoint prediction gating (default-off overlay), HQ-bar gating (2 bars).
- **Nanolathe:** checked `internal/combat` and `internal/ai` for broadphase/sector idioms — no reusable pattern (no matches); the AABB reject + lazy cache follow this repo's own task-52/101/111 precedents instead.

## Verification

- New-module tests observed failing pre-implementation (missing-module import errors), then green. Broadphase tests are behavior-preserving tripwires by design (identical results before/after); the win is sized by a plain-node A/B on real Ashen Pass tree data (deleted after): 2000 crush queries 185→98 ms, 2000 barrel queries 191→71 ms, identical hit counts (680/768).
- Headless tick-equivalent probe (deleted after): `groundY` probes/tick ~19.5k→~6.7k, stands builds 120→25 over the window, occlusion sampled for 7.0/24 units avg with a zoomed-in camera. No wall-clock assertions anywhere (vitest tick wall ~20→~5.6 ms is indicative only).
- `yarn workspace @scorched-3d/core test`: 671 pass. `yarn workspace @scorched-3d/web test`: 785 pass; the single failure is the known pre-existing `deployPages.test.ts` workflow-yaml assertion (baseline-verified on the untouched tree). `yarn typecheck` and `yarn build` green. Playwright not run (per task rules).
