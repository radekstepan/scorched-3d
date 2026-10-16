---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Peewee scout role: the lightest hull spots enemies past regular notice (1500), ranges on a wider leash (2000) with a matching disengage bound, and probes alone where heavier hulls wait for backup — shadowing at range instead of suiciding — so its sightings focus the squad and feed the sticky team contact that pulls the rest into the fight

## Task writeup (moved from docs/tasks/90-peewee-scout.md)

# Task 90 — Peewee scout role: find the enemy, focus the squad

Skirmishes kept stalling into stationary face-offs: mutual stand-off holds
and wait-for-backup patience meant a side that lost sight of the enemy
guarded its patrol loop while the enemy regrouped a screen away — retaliation
knew *how* to fight, strategy knew *whether* the fight was winnable, and the
team advance remembered *where* the enemy was, but nothing went looking for
it. The peewee — smallest, fastest, shortest-ranged hull on the field —
now works as the squad's scout: it spots contacts past regular notice,
probes alone where heavier hulls wait, and shadows at range instead of
suiciding, so its live threat memory focuses the squad and feeds the sticky
team contact that pulls the rest in.

## Decision: wider scout gates, same hysteresis shape

Owned by core `strategy.ts` (pure: no rng, no wall clock — same snapshot in,
same decision out, replays stay identical), keyed off `isScoutKind`
(peewee only):

- Notice `SCOUT_NOTICE_RADIUS = 1500` (`HUNT_ENGAGE_RADIUS + 400`): a scout
  spots a column its heavier teammates cannot see yet — past regular notice,
  yet inside the shared disengage bound.
- Leash `SCOUT_LEASH_RADIUS = 2000`: a ranging scout may chase a contact
  farther from its patrol anchor than a tank — still local on the doubled
  map, never a map-wide chase. Carried on the threat memory like every hunt
  leash, and issued advances carry it too (a scout-range advance would
  otherwise die on the drive's anchor-leash gate on its first step).
- Disengage `SCOUT_DISENGAGE_RADIUS = 1650` (notice + 150): the same 150-unit
  hysteresis gap as the regular gates (engage 1100 < disengage 1250), so a
  scout on the boundary does not flicker either. Without it the drive
  (`pursueStep`, now kind-aware via `disengageRadiusFor`) dropped every
  scout-range acquisition on its first step — found on integration, covered
  by a dedicated drive test.

Heavier hulls resolve byte-identically: absent or non-scout kinds take the
regular gates everywhere (covered by an explicit parity test), and all
existing patrol/order/pursuit suites hold untouched.

## Decision: scouts probe, the drive still protects them

`acquireStrategicHunt` takes a trailing optional `kinds` roster: a scout
skips the `shouldHold` courage gate (probing alone is its job) and chooses
on the scout gates, while `chooseTarget` gains an optional `scout` flag
(explicit `maxDist`/`leash` still win). Probing is not suiciding: an
outnumbered in-progress pursuit still holds facing the threat inside the
drive — the scout shadows at eyes-on distance, sharing the contact via
`squadFocus`, and closes once backup arrives (heavy hulls behave the same;
the scout only gets there first).

The renderer (`movement.ts` `sweepHunt` / `advanceTowardContact`) threads
`this.kinds` through: scout advances range on the scout leash and push ahead
even when the odds at home look bad, while heavier hulls still wait for
backup. Player orders still win everywhere (ordered/holding scouts neither
acquire nor advance — covered), wrecks stay silent, and guns are untouched:
targeting stays live-enemies-only, the scout only moves hulls into range.

## What changed

- `packages/core/src/units/strategy.ts`: `SCOUT_NOTICE_RADIUS`,
  `SCOUT_LEASH_RADIUS`, `SCOUT_DISENGAGE_RADIUS`, `isScoutKind`,
  `huntNoticeRadiusFor` / `huntLeashFor` / `disengageRadiusFor`;
  `TargetOptions.scout`; `chooseTarget` scout defaults;
  `acquireStrategicHunt` trailing `kinds` (courage exemption + scout gates
  + scout leash on the memory).
- `packages/core/src/units/movement.ts`: `pursueStep` disengage gate via
  `disengageRadiusFor(kind)` (non-scout history byte-identical).
- `packages/core/src/units/retaliation.ts`: `advanceMemory` takes an
  optional trailing `leash` (defaults to the hunt leash — every legacy call
  site is bit-identical).
- `apps/web/src/renderer/movement.ts`: kinds threaded into
  `acquireStrategicHunt`; scout-leash + courage-bypass advances in
  `advanceTowardContact`; docstrings.
- `README.md` (AI one-liner), `docs/architecture.md` (strategy + movement
  rows).

## Tests

- Core `strategy.test.ts` (+7): scout kind/gate naming incl. the 150-unit
  hysteresis parity, spotting past regular notice (tank refuses, scout +
  `chooseTarget` acquire), ranging past the regular leash, probing alone
  into a group where tanks wait, shadowing at range (drive holds facing,
  memory kept), holding scout-range contacts past the regular disengage
  (tank lets go, scout steps closer), kinds-free byte-parity.
- Web `retaliation.test.ts` (+4 `peewee scout`): scout spots a column at
  1300 past tank notice and its heavier teammate advances on the sticky
  contact and visibly closes; scout probes alone into a column where the
  all-flash control waits; scout ranges to an 1800 contact on the scout
  leash where a heavier hull in the same spot never leaves its loop;
  ordered scouts refuse to probe.
- Existing suites untouched and green.

## Verification

`yarn test` (core 22 files / 463 tests, web 34 files / 420 tests),
`yarn typecheck`, `yarn build` — all green. No Playwright (per brief).
