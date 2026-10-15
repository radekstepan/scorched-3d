# Task 104 — Random HQ reinforcements, stronger units slower to build

Each live HQ used to release a fixed cycle (Peewee → Flash → Stump →
Hammer) on a flat 40 s clock. Now every release is a weighted-random draw
where weaker units come out more often, and the clock rearms for the drawn
unit's own build time — stronger units take more time to make (Peewee 30 s,
Flash ≈ 34 s, Stump ≈ 42 s, Hammer 70 s). The per-side cap of 4, the
first-release delay of 40 s, and the wrecked-HQ silence are unchanged, so
both teams share the same pacing and a destroyed HQ still goes quiet.

## What changed

- `packages/core/src/units/hq.ts`
  - `HQ_SPAWN_CYCLE` + `spawnKindFor` (fixed rotation) replaced by
    `HQ_SPAWN_ROSTER` (same four line units, weakest first — still no
    commanders) plus three pure helpers:
  - `hqSpawnStrength(kind)` — splash-weighted punch per landed hit
    (`UNIT_HIT_DAMAGE × BLAST_RADIUS`: Peewee 1.26, Flash 2.16, Stump
    3.96, Hammer 10.24). Hull health is uniform (damage is a 0..1
    fraction for every kind), so the gun is the whole story; the
    admitted-range order agrees (Hammer longest, Peewee shortest), so any
    reasonable metric ranks Peewee < Flash < Stump < Hammer — the weights
    and build times only rely on that order.
  - `spawnWeightFor(kind)` — inverse strength against the Peewee
    (1 / 0.58 / 0.32 / 0.12); off-roster kinds (commanders) weigh 0 and
    never spawn.
  - `pickNextSpawnUnit(rng)` — one weighted draw over the roster,
    exactly one `rng` draw per pick, so seeded streams replay exactly.
  - `spawnIntervalFor(kind)` — linear in strength from 30 s (weakest) to
    70 s (strongest); the weighted mean (≈ 35 s) sits near the legacy
    40 s cadence. Off-roster kinds fall back to `HQ_SPAWN_INTERVAL`.
  - `tickHqSpawn(state, dt, hqAlive, rng?)` now returns the released
    `UnitKind` (or null) instead of a boolean, and rearms the clock with
    `spawnIntervalFor(kind)`. It draws rng only on a release — silent
    ticks (dead HQ, cap reached, countdown running) consume nothing.
- `apps/web/src/renderer/hqFx.ts` — `HqFx` draws through the new tick
  (kind stored as `pendingKind` when the clock fires, released at
  door full-open, discarded if the HQ dies mid-animation) and accepts an
  optional `HqEnv.rng` (defaults to `Math.random`, like the ambient
  combat stream — `TerrainCanvas` needed no changes). Both forts share
  one stream in team order, so a seeded stream replays both sides.
- `docs/architecture.md`, `README.md` — one clause each on
  random/strength-paced reinforcements.
- `.changeset/random-hq-units.md` (new) — **minor** for core + web:
  reinforcement pacing and mix change gameplay behavior.
- This writeup (`docs/tasks/104-random-hq-units.md`).

## Decisions

- Strength = damage × blast, not a hand table: it reuses the same
  per-kind stats the splash and duel code already balances, so a future
  rebalance moves spawn mix and build times with it. Range and refire
  order agree with the ranking, so the exact product shape doesn't
  matter — only the order does, and every metric in the codebase agrees
  on it.
- Linear-in-strength build times (30–70 s) instead of proportional ones:
  raw strength spans 8× (1.26–10.24), which would build Peewees every
  ~11 s and Hammers every ~93 s; the damped span keeps the weighted mean
  near the legacy cadence while still making artillery take more than
  twice as long as a scout.
- The first release stays on the legacy 40 s timer (kind drawn at fire):
  battle openings play exactly as before, and only the follow-up cadence
  varies with what the factory builds.

## Test evidence

- Core `hq.test.ts` (+11 cases): strength order + damage×blast
  cross-check, weight order with Peewee 1 / commander 0, interval
  monotonicity bounded by 30/70 s with legacy fallback, stub-roll roster
  bands, single-draw consumption, seeded determinism, full-roster
  coverage with weak-favoring mix over 2000 draws, tick rearm to the
  released kind's interval, rng untouched while silent.
- Core `peewee.test.ts` roster case rewritten to the new API.
- Web `hqFx.test.ts` (+1, 2 rewritten): seeded first-release kinds pinned
  against a fresh `pickNextSpawnUnit` stream for both forts, cap +
  twin-seed reproducibility, per-kind gaps between releases matching
  `spawnIntervalFor` plus door overhead.
- `yarn workspace @scorched-3d/core build` (web tests resolve the built
  core dist — a stale build fails them with boolean-kind artifacts), then
  full `yarn test` + `yarn typecheck` — see commit verification.
- Playwright not run (per task rules).
