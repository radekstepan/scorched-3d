---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

HQ peewee builds in 20 s, full roster scaled by the same 4/3 factor: per-kind build times 20–46⅔ s instead of 15–35 s (flash ≈ 24.3, stump ≈ 29.3, hammer ≈ 46.7, weighted mean ≈ 22.8 s) — first release still at 20 s, same 4-per-side cap, roster, and mix

## Task writeup

Task: make HQ produce units faster — peewee out in 20 s, other units adjusted accordingly.

## What changed

Rescaled the reinforcement clock in `packages/core/src/units/hq.ts` by the
peewee factor 20/15 = 4/3:

- `HQ_SPAWN_MIN_INTERVAL` 15 s → 20 s (peewee).
- `HQ_SPAWN_MAX_INTERVAL` 35 s → 140/3 s ≈ 46.7 s (hammer).
- Flash ≈ 24.3 s and stump ≈ 29.3 s fall out of the same
  linear-in-strength interpolation untouched: scaling both endpoints by
  4/3 scales every kind's build by exactly 4/3, so relative ratios hold
  and no per-unit numbers were invented.

Nothing else moved: first release `HQ_SPAWN_INTERVAL` stays 20 s (it is
the opening delay and the unknown-kind fallback, not a unit build time),
the 4-per-side cap, the weighted peewee-first roster, the strength
ordering, the door-slide animation, and the seeded one-draw-per-release
determinism are all untouched. The full cap now fields in at most
20 + 3 × 140/3 = 160 s of battle time.

Also updated the stale absolute-time mentions: the `spawnIntervalFor`
doc comment and the `hqFx.test.ts` pacing comments. `README.md` and
`docs/architecture.md` describe the pacing only qualitatively ("stronger
units slower to build", "first release at 20 s") and stay accurate, so
neither needed an update.

## Decision: exact 4/3 scaling, first release untouched

The brief pins the peewee at 20 s with the other builds scaled by the
same factor rather than reinvented, so both interpolation endpoints
scale by exactly 4/3 — the peewee:hammer ratio, the weighted mix, and
all constant-relative tests survive intact. Note the trade: against the
previous 15 s peewee this lengthens per-kind builds (the task title says
"faster" but the explicit 20 s requirement with proportional scaling is
a 4/3 slowdown of the build leg); the first reinforcement still arrives
at 20 s, so the opening tempo is unchanged.

## Files

- `packages/core/src/units/hq.ts` — rescaled min/max build times + doc comments.
- `packages/core/src/units/hq.test.ts` — `faster production cadence`
  block becomes `production cadence`: absolute pin of 20 / 20 / 140/3 s
  plus flash ≈ 24.3 / stump ≈ 29.3 ratio locks, and the 5-seed
  tick simulation now proves the full cap releases within 160 s.
- `apps/web/src/renderer/hqFx.test.ts` — pacing comments only (tests
  already read the constants).
- `.changeset/hq-peewee-20s-cadence.md` (new) — **patch** for core + web.

## Tests

- Core `hq.test.ts` (36) + `peewee.test.ts` (16): green (test-first —
  the new 20 s pin failed against the old 15 s constant before the fix).
- Web `hqFx.test.ts` (13): green against the rebuilt core dist.
- Full `yarn test`: green except one pre-existing `deployPages.test.ts`
  failure (GitHub Pages workflow branches), confirmed failing on the
  untouched tree via `git stash`.
- Full `yarn typecheck`: green.
- Playwright not run (per task rules).
