---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Retaliation pursuit AI: splashed hulls now record a threat memory (attacker + last-known position + countdown) and idle/patrolling hulls turn and pursue to per-kind weapons-range stand-off, giving up past the disengage bound, the patrol-anchor leash, or memory expiry. Player orders win (ordered/holding hulls never retaliate), pursuit drives through the same gated movement so hulls never teleport, and the waypoint overlay draws chases in rose alert.

## Task writeup (moved from docs/tasks/55-retaliation-pursuit-ai.md)

# Task 55 — Retaliation pursuit AI (hit hulls turn and fight back)

Patrolling hulls used to take fire with total indifference — they kept
walking their loop while being shelled, so the skirmish read as target
practice. Every splash now also leaves a threat memory on the victim
(attacker index + last-known position + a 12 s countdown), and
idle/patrolling hulls steer toward that memory to fight back while it is
fresh, near, and reachable — then give up and resume their patrol.

## Decision: threat memory in core, shooter threaded through the blast path

The victim must pursue the *attacker*, not just recoil from the blast —
and blasts only know a position, not a shooter. So `Shot` now carries
`attacker`/`target` roster indices from `tryFire` through impact into
`explode` → `damageUnits` (new trailing `shooter` + `hostile` params),
which resolves each survivor's threat from the shooter's *live* body
position and fires the new `onUnitThreatened` hook next to the existing
`onUnitStunned`. The canvas wires it to `UnitMovement.threatenUnit`, which
feeds core `notifyThreat` against the patrol anchor.

Fallbacks, in order (documented in `resolveThreat`): a dead shooter or a
self-splash blames nobody (corpses are not pursued, own-blast self-hits
never chase themselves); a blast with no shooter on record (white-box
callers only — organic fire always knows) blames the nearest live hull
inside the engage gate; non-hostile bursts (a wreck cooking off via
`explodeDeath`) blame nobody, so survivors never pursue each other over a
cook-off. Killing blows fire neither hook — the wreck holds instead.

## Decision: the AAA gate set (engage / hysteresis / leash / stand-off)

Owned by the new core module `retaliation.ts` (pure: no rng, no wall
clock — the memory is a `ttl` ticked by sim `dt`):

- Engage `900`: a fresh victim ignores hits from farther away, so
  cross-map artillery never pulls a patrol off its loop.
- Disengage `1250` (deliberately larger — the gap is the hysteresis that
  stops boundary flicker): an engaged hull tolerates a fleeing attacker
  longer than a fresh one, and same-attacker re-hits refresh inside it.
- Leash `650` from the patrol anchor (route waypoint 0): pursuit never
  chases across the map; a threat past it is ignored outright, and a
  fleeing attacker that outruns it is let go.
- Stand-off per kind (`flash 220 / stump 280 / commander 300 /
  hammer 480`): the pursuer closes, then holds and faces while the turret
  scheduler shoots — hulls close, guns kill. Fixed brawl distances, not a
  fraction of max range: bolt max ranges are flight-time safety nets
  (thousands of units), so 60%-of-max would hold every hull at ~800 and
  the chase would never visibly drive.
- Expiry `12 s` without a re-hit, plus latest-close-hit-steals (a new
  attacker inside the engage gate takes the memory).

## Decision: player orders win, movers never teleport

Ordered and holding units never retaliate: `orderMover`/`holdMover` clear
any live memory and `notifyThreat` refuses hits taken while ordered, so an
ordered hull stays where it was sent. Pursuit drives through the same
`driveToward` as patrol and orders (turn caps, alignment grip,
rough-terrain drag, slope gating, spacing, separation — pinned pursuers
hold like ordered hulls instead of skipping their frozen leg) — it only
swaps the target, with the patrol leg frozen and resumed on give-up.
Stun pauses the drive but the threat clock keeps ticking underneath, so
hesitation never extends memory. Wrecks stay silent (renderer refuses +
clears on the kill).

## Decision: rose for pursuit in the waypoint overlay

Amber already means player orders and slate means patrol, so a chase
needed its own hue: `WAYPOINT_PURSUIT_COLOR = 0xfb7185` (rose alert —
hostile intent at a glance, inside the ember/damage palette, never cyan
which is selection). `activeTrailMode` gains `"pursue"`, the static patrol
loop hides while chasing (one future per hull), and the driven-path
prediction previews the chase from the static memory (the live drive
additionally tracks moving attackers through the roster snapshot).

## What changed

- `packages/core/src/units/retaliation.ts` (new): `ThreatMemory`,
  gates, `PURSUE_STANDOFF`, `notifyThreat`/`tickThreat`/`clearThreat`/
  `hasThreat`/`pursueStandOff`; exported from the core barrel.
- `packages/core/src/units/movement.ts`: `Mover.threat` field;
  `orderMover`/`holdMover` clear it; `advanceMover` pursues through
  `pursueStep` (live `foes` positions, stand-off hold, disengage/leash/
  expiry give-up → patrol) and ticks the clock under stun;
  `advanceMovers` passes the roster snapshot as foes.
- `apps/web/src/renderer/combatFx.ts`: `Shot` carries
  attacker/target; `explode`/`damageUnits` thread shooter + hostility;
  `resolveThreat` + `onUnitThreatened` hook with the silence rules above.
- `apps/web/src/renderer/movement.ts`: `threatenUnit` (wreck/self/order
  guards) + `hasThreat`; `moverState` copies the memory;
  `markDestroyed` drops it.
- `apps/web/src/renderer/TerrainCanvas.tsx`: wires `onUnitThreatened`
  to `threatenUnit`.
- `apps/web/src/renderer/waypoints.ts`: `"pursue"` mode, rose trail +
  tracer, loop hidden while chasing, pursuit fallback path.
- `README.md`, `docs/architecture.md`: retaliation behavior documented.

## Tests

- `retaliation.test.ts` (core, 19 tests): engage/ignore gates, leash,
  order/hold refusal, same-attacker refresh vs disengage drop, memory
  steal rules, invalid inputs, ttl countdown + key drop, stand-off bounds
  + ordering, pursuit steering with frozen leg, live-attacker tracking,
  stand-off hold, disengage/leash/expiry give-up resuming patrol, ordered
  override, determinism (same hit sequence replays bit-equal),
  `advanceMovers` roster pursuit.
- `retaliation.test.ts` (web, 9 tests): hook blames the live shooter;
  silence on self-splash/dead shooter/cook-off; nearest-live fallback and
  its gate; no threat on killing blows; `threatenUnit` refusal set;
  idle-hull pursuit closes distance; waypoint rose mode with hidden loop.
- Existing suites untouched and green (movement 45, combatFx/impact,
  waypoints, movement renderer).

## Verification

`yarn test` (core 338 passed / 19 files + web suite), `yarn typecheck`,
`yarn build` — all green.
