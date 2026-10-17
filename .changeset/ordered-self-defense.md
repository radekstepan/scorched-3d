---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Ordered units defend themselves en route and rejoin patrol on arrival: a manual move order no longer strips the hull's behaviors — hits taken while ordered record a self-defense threat memory (the turret traverses, the ambient scheduler, HQ-fire hold, and squad focus all read it) while the drive keeps the order, and arrival clears the order without holding so the hull resumes its patrol loop — pursuing a live memory first, then wayfinding, monitoring, hunting, and defending like any patrol hull.

## Task writeup

# Task — manual move orders keep behaviors (self-defense en route, patrol after arrival)

Sending a unit somewhere used to lobotomize it: the order cleared and refused
threat memories, so the hull walked through fire in silence, and arrival
parked it on `hold: true` forever — no patrol, no hunts, no retaliation. Two
root causes, both in the order/threat contract:

1. `notifyThreat` (core `retaliation.ts`) refused ordered movers outright, so
   no memory ever existed for the guns to answer while marching.
2. `advanceMover` (core `movement.ts`) resolved arrival as order-cleared-into-
   hold, so the autonomous loop never resumed.

## Decision: a blocked move prevents a chase, not weapon fire (retail TA)

The nanolathe retail spec (`04-units-orders-scripts-and-movement.md`,
R-STANCE-01 §3) states it verbatim: a `Move_Ground` in the retry loop means
damage cannot replace it with an attack order, but the attacker is still
offered to the weapon slots and fire-at-will maintenance still acquires. The
port:

- `notifyThreat` admits ordered hulls (holds still refuse — an explicit hold
  stays passive). The victim-relative engage/disengage gates still apply, but
  the anchor leash is skipped for ordered hulls: there is no chase to leash,
  and a unit sent across the map must still answer close fire.
- `advanceMover`'s order branch ticks the memory underneath the drive and
  re-attaches it past the `driveToward` rebuild (same trap as the departure
  lead-in), but never steers for it — the hull keeps driving where it was
  sent.
- A new order still clears any live memory (a fresh order cancels an
  in-progress pursuit); re-hits re-record. Hunts, seeks, advances, recon,
  and sidesteps still refuse ordered hulls — the task asks for answering
  fire *if attacked*, not proactive hunting while marching.

The gun side needed no changes: the ambient scheduler and `trackThreat`
already include ordered hulls, so turrets visibly return fire en route; the
memory additionally feeds `isFighting` (self-defense-first HQ hold) and
`squadFocus`, and converts to a normal pursuit — with the usual disengage /
leash / expiry gates evaluated before any steering — on the first tick after
arrival.

## Decision: arrival rejoins the patrol loop, not a hold

Arrival now returns `order: undefined, hold: false` with a live memory
intact: the next tick either pursues (leg frozen) or drives the frozen patrol
leg. Empty-path orders, wrecks, and explicit `holdMover` still hold. The
driven-path prediction still ends its trail at the destination (patrol
resumes past it, off the trail). Three existing tests parked hulls via
zero-length / completed orders (locomotion settle, track-trail silence);
wrecks — the only stationary state left — now freeze those hulls, and the
hold gates stay pinned at the unit level.

## What changed

- `packages/core/src/units/retaliation.ts`: `notifyThreat` records
  self-defense memories on ordered hulls (anchor leash skipped, engage gates
  kept); holds still refuse. Module + function docs rewritten.
- `packages/core/src/units/movement.ts`: order branch ticks + re-attaches
  the memory without steering; arrival rejoins patrol. `Mover`
  order/hold/threat field docs, `orderMover` / `advanceMover` /
  `predictDrivenPath` docs updated.
- `apps/web/src/renderer/movement.ts`, `TerrainCanvas.tsx`: comment/doc
  updates only (ordered victims record; holding victims refuse).
- `README.md`, `docs/architecture.md`: order-semantics rows updated.

## Tests

- Core `retaliation.test.ts` (+4, 2 rewritten): ordered records / holding
  refuses; ordered records past the anchor leash but keeps the engage gate;
  memory ticks under orders without steering (drops at expiry); arrival
  pursues a live memory with the leg frozen; shell variants of the
  record/refuse split.
- Core `pathfinding.test.ts` (1 rewritten): arrival resumes the patrol leg.
- Core `movement.test.ts` (1 updated): shore-slide arrival rests unheld.
- Web `movement.test.ts` (1 rewritten, 1 reworked): arrival resumes patrol;
  locomotion settle freezes via wrecks.
- Web `retaliation.test.ts` (+1, 2 rewritten): ordered hull answers fire en
  route, drives the full march, pursues on arrival, patrols after the kill;
  ordered victims record in the side-alert test.
- Fail-first: all 8 new/rewritten core tests + 2 web tests failed before the
  implementation change, then passed. Full core suite 666/666 green; full
  web suite green except the known pre-existing `deployPages.test.ts`
  workflow-yaml failure (untouched area). `yarn typecheck` green (3 tasks).
