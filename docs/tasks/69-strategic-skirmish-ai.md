# Task 69 — Strategic skirmish AI (odds, focus, patience)

Retaliation + hunt made every hull charge the nearest contact the moment it
noticed one: lone scouts suicided into whole columns, guns split fire across
random pairs, and nobody ever waited for backup. The drive and the turret
scheduler knew *how* to fight; nothing decided *whether* the fight was
winnable. Hulls now weigh the local brawl before committing, join their
squad's fight instead of starting their own, and hold facing the enemy
(waiting for backup) rather than charging alone into a group.

## Decision: odds gate every commitment, counted around two centers

Owned by the new core module `strategy.ts` (pure: no rng, no wall clock —
same snapshot in, same decision out, so replays stay identical):

- `battleOdds` weighs friendly strength around *me* (who can back me up)
  against enemy strength around the *threat* (what I would drive into) —
  allies and enemies counted around different centers on purpose, inside
  `STRATEGY_ASSESS_RADIUS = 650` (the retaliation-leash scale: the brawl
  that matters is the one a hull could drive into). Strength is
  health-weighted: a burning column counts less than a pristine one, so
  damaged groups invite the finish while fresh ones deter. Callers without
  damage state pass nothing and read everyone pristine.
- `shouldHold` (acquisition gate: enemies-vs-allies around my own position)
  makes an outnumbered idle hull patrol on and wait instead of acquiring —
  while `outnumbered` at the threat (allies near me vs enemies near the
  quarry) makes an in-progress pursuit hold in place facing the threat
  instead of driving in. The memory stays fresh, so the hull re-engages the
  moment friends arrive; the usual expiry/disengage/leash gates still
  release it if the fight moves on. The drive hold reads exactly like the
  stand-off hold (turn, no step), so the rose trail stays lit on a waiting
  hull instead of flickering.
- Hold line `STRATEGY_HOLD_RATIO = 1.5`: even fights (1v1, 2v2, 3v3) and
  finishes (wounded groups count less) flow, while a lone hull facing 2+
  fresh enemies waits. Deliberately above 1 so mutual caution cannot
  stalemate equal columns — and the winning side's odds stay fine, so
  skirmishes still run to conclusion instead of stalling.

## Decision: targets are scored, not nearest-only

`targetScore` keeps distance dominant (guns must stay in range and
skirmishes must keep happening) with three pulls, lowest index breaking
ties deterministically:

- wounded `260` (finish the kill — scaled by missing hp, so a burning hull
  at 600 beats a pristine one at 400);
- squad focus `170` per teammate already engaging (focus fire over split
  shots, via `squadFocus`: the most-pursued live enemy on my side —
  grudges against wrecks/mates/unknown sides never focus);
- answering the hull that shot me `120`, plus a `200` sticky bonus for the
  gun scheduler (stay on the current aim, no thrash).

`chooseTarget` (hunts) filters exactly like `acquireHunt` — live enemies
only, inside the notice gate and the anchor leash — so even fights resolve
identically to the old nearest pick while mismatches steer sensibly.
`pickStrategicTarget` (guns) prefers admitted in-range candidates but still
returns the best far target when nothing is admitted, preserving the old
traverse-then-retry rhythm; the scheduler still draws the *attacker*
uniformly (one rng draw, as before), only the aim is strategic.

## Decision: tactics ride the drive as optional context, defaults unchanged

`advanceMover`/`advanceMovers` take a trailing optional `PursuitTactics`
(`self` + `teams` + `alive` + optional `hp`); absent, every step is
byte-identical to before (all existing patrol/order/pursuit tests hold
untouched). The web driver builds it per tick from placement sides,
wreck flags, and combat damage fed once per tick (`movement.setDamage`,
refreshed after `combat.update` — one tick stale, never torn; null until
the first feed, so headless groups keep counts-only odds). Player orders
still win: ordered/holding hulls never consult the layer.

## What changed

- `packages/core/src/units/strategy.ts` (new): odds, `squadFocus`,
  `targetScore`, `chooseTarget`, `acquireStrategicHunt`,
  `pickStrategicTarget`; exported from the core barrel.
- `packages/core/src/units/movement.ts`: `PursuitTactics`; `pursueStep`
  holds facing the threat while outnumbered; roster threading in
  `advanceMovers`; docstring updated.
- `apps/web/src/renderer/movement.ts`: `setDamage`/`health` feed;
  `sweepHunt` acquires through `acquireStrategicHunt` (squad-focus
  snapshot included); `update` passes tactics into `advanceMovers`
  (skipped for team-less headless groups).
- `apps/web/src/renderer/combatFx.ts`: `pickLivePair` draws the attacker
  uniformly then aims via `pickStrategicTarget` (live hp, pending aims as
  focus, current aim as sticky, weapon range + 50 admission); new
  `damageList()` getter for the health feed.
- `apps/web/src/renderer/TerrainCanvas.tsx`: feeds `combat.damageList()`
  into `movement.setDamage` after `combat.update`.
- `README.md` (AI one-liner), `docs/architecture.md` (strategy row).

## Tests

- `strategy.test.ts` (core, 28 tests): split-center odds counting,
  health weighting + wreck exclusion, lone-vs-group hold vs even-fight
  engage, wounded-group finish invitation, empty/unknown/dead no-hold,
  destination-vs-home judgment, exact hold ratio, squad focus + tie-break +
  grudge filtering, score pulls + wounded tradeoff, target choice incl.
  focus/threat answers, wreck/mate/gate/leash filtering, strategic hunt
  parity with `acquireHunt` on even fights + shared refusals,
  wait-instead-of-charge (and commit with mates), focus joining, wounded
  quarry, determinism, gun-target admission/focus/sticky/fallback rules,
  drive integration (wait, re-engage on backup, tactics-free
  byte-parity).
- `retaliation.test.ts` (web, +2 tests): a lone scout patrols on while the
  column commits; a free hull joins its squad's farther focus target.
- Existing suites untouched and green.

## Verification

`yarn typecheck` (3 tasks), `yarn test` (core 21 files / 406 tests, web 29
files / 364 tests), `yarn build` — all green.
