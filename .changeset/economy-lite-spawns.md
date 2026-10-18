---
"@scorched-3d/core": patch
"@scorched-3d/web": minor
---

Economy-lite spawns: factories build faster when their side holds more ground. A new Factories panel shows each side's ground share and build pace, so positioning now matters strategically.

## Task writeup

Reinforcements used to arrive on fixed per-kind timers no matter how the battle went. The territory (influence) system already tracked who holds what, so the spawn clock now reads it: hold more ground → faster builds, lose ground → slower builds, with even ground replaying the legacy pacing exactly.

## What changed

- Core (`packages/core/src/units/influence.ts`, new export): `territoryShare(field, now)` — each side's freshness-weighted share of claimed ground (sums to 1; cold field splits 50/50 so the opening plays symmetric; contested cells credit both sides; fully stale ground credits nobody). Sim-seconds in, no wall-clock.
- Core (`packages/core/src/units/hq.ts`): `spawnIntervalScale(share)` — linear 1.4× (no ground) through 1.0× (even) to 0.6× (whole map), clamped with a 0.5 fallback for non-finite input; `tickHqSpawn` takes an optional trailing `share` (default 0.5 = byte-identical legacy rearm) scaling the rearmed build time.
- Web (`apps/web/src/renderer/hqFx.ts`): `update(dt, shares?)` feeds the per-team share into the clock (absent = even ground, legacy callers untouched); `HqStatus` gains `share` + `pace` (builds per legacy second) with a `paceAt` accessor.
- Web (`apps/web/src/renderer/TerrainCanvas.tsx`): the tick computes `territoryShare(territory.field, t)` right after stamping and passes it to `hq.update`, so the clock always reads fresh ground.
- Web (`apps/web/src/App.tsx`): new Factories panel in the inspector rail — per-team row with color chip, ground-share %, and build pace (or "destroyed"), plus a one-line explainer pointing at the Territory toggle. Reads the existing 4 Hz `onHq` broadcast; no new wiring.
- Tests: core `influence` +6 (cold/open split, one-sided, symmetric, freshness weighting, contested, stale), core `hq` +3 (scale bounds/symmetry/clamping, share-paced rearm with same-seed same-kind), web `hqFx` +2 (status share/pace, head-to-head rebuild gaps), `App.economy` +3 (canvas share feed, Factories rows, destroyed state), `App.layout` source pin updated to the new `hq.update` call.
- Docs (`docs/architecture.md`): hq/hqFx/App rows updated, missing influence row added. README factory line gains the ground-speeds-builds sentence.

## Important decisions

- **Scale the rearm, not the countdown.** Only the rearmed interval is share-scaled; the running countdown ticks at 1×. This keeps the clock trivially bounded (a shut-out side builds at 1.4×, never starves) and makes even ground exactly legacy pacing — the default `share = 0.5` parameter keeps every old caller bit-identical.
- **Symmetric 0.6×/1.4× band.** ±0.4 around 1.0: strong enough to feel (a dominant side reinforces ~2.3× faster than a shut-out one), bounded enough that comebacks stay possible. Linear in share, so every push visibly moves the needle.
- **Share from raw freshness sums, not the smoothed paint.** The overlay blur exists to render contiguous blobs; the economy reads the underlying claims directly — cheaper (one grid walk, no 9-tap smoothing) and exactly proportional to held ground.
- **Pace shown as a rate, not seconds.** `pace = 1/scale` reads "×1.25 builds" — higher is better, matching the "more ground = better" intuition; an interval in seconds would invert it.
- **Nanolathe: no direct precedent applied.** The sibling's spawn/economy work is per-player build queues with metal/energy costs (retail model), not map-control pacing; this task's brief explicitly scopes to scaling the existing timer clock, so no sibling pattern was borrowed.

## Verification

- `yarn build` green; `yarn typecheck` (3 tasks) green.
- New/updated suites: core 790 pass (28 files), web 1031 pass with 1 failure in `deployPages.test.ts` that reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. Playwright not run (per task rules).
