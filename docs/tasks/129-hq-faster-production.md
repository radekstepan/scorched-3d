# 129 — HQ factories produce reinforcements twice as fast

Task: produce HQ units faster.

## What changed

Halved every leg of the reinforcement clock in `packages/core/src/units/hq.ts`:

- First release after battle start: `HQ_SPAWN_INTERVAL` 40 s → 20 s
  (also the unknown-kind fallback in `spawnIntervalFor`).
- Per-kind build times: `HQ_SPAWN_MIN_INTERVAL` 30 s → 15 s (peewee),
  `HQ_SPAWN_MAX_INTERVAL` 70 s → 35 s (hammer); flash ≈ 17 s and
  stump ≈ 21 s fall out of the same linear-in-strength interpolation,
  so the weighted mean drops from ≈ 35 s to ≈ 17.5 s.

Nothing else moved: the 4-per-side cap (`HQ_MAX_SPAWNS`), the weighted
peewee-first roster, the strength ordering, the door-slide animation, and
the seeded one-draw-per-release determinism are all untouched. The full
cap now fields in at most 20 + 3 × 35 = 125 s of battle time instead of
250 s, so reinforcements join the fight while it still matters.

Also updated the stale absolute-time mentions: the `spawnIntervalFor`
doc comment, the `hqFx.test.ts` pacing comments, and the `hq.ts` row in
`docs/architecture.md`. `README.md` describes the pacing only
qualitatively ("stronger units slower to build") and stays accurate.

## Decision: exact halving, cap untouched

" Faster" with no number is a pacing call, so I doubled the cadence
exactly rather than inventing a new curve: every interval scales by ½,
which keeps the peewee:hammer build ratio, the weighted mix, and all
existing constant-relative tests intact. The 4-unit cap is about battle
size, not speed, so it stays — faster production, not a bigger army.

## Files

- `packages/core/src/units/hq.ts` — halved intervals + doc comment.
- `packages/core/src/units/hq.test.ts` — new `faster production cadence`
  block (2 tests): absolute pin of 20 / 15 / 35 s, and a 5-seed
  tick simulation proving the full cap releases within 125 s.
- `apps/web/src/renderer/hqFx.test.ts` — pacing comments only (tests
  already read the constants).
- `docs/architecture.md` — first-release time 40 s → 20 s.
- `.changeset/hq-faster-production.md` (new) — **patch** for core + web.

## Tests

- Core `hq.test.ts` (28): green, including the 2 new cadence tests.
- Web `hqFx.test.ts` (10): green, unchanged behavior.
- Full `yarn test` + `yarn typecheck`: green (see commit verification).
- Playwright not run (per task rules).
