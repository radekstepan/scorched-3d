---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Peewee HQ assaults hold outside the works at grenade range: structure assaults now hold at 220 units (the peewee's grenade range) instead of the peewee's 180 knife-fight stand-off, which sat in the HQ hall mouth and let crowd shoves walk attackers down the hall into the bunker

## Task writeup

# Peewee HQ assault standoff

Assaulting peewees sometimes ended up inside the enemy HQ. The drive holds
attackers at their kind's `PURSUE_STANDOFF` from the fort anchor, and the
peewee's 180 knife-fight hold sits 2 units past the hall mouth (178 out,
web `HQ_EXIT_OFFSET`) — parked in the doorway, so any separation shove from
the melee churn walked it down the hall into the bunker. Every other kind
already holds at or past 220 (flash exactly), which is why only peewees
walked in.

## Fix

- Core `retaliation.ts`: new `STRUCTURE_ASSAULT_STANDOFF = 220` floor, and
  `pursueStandOff(kind, structure)` takes an optional structure flag —
  assaults hold at `max(kind table, floor)`. The floor clears the leveled
  pad corridor (208) with crowd-shove margin and equals
  `PEEWEE_GRENADE_RANGE` on purpose: the assaulting peewee lobs grenades
  from the hold instead of closing to knife-fight. Hull-duel stand-offs are
  untouched (default flag keeps the legacy table exactly).
- Core `movement.ts`: `pursueStep` passes `threat.structure` into the hold
  check, so only HQ assaults use the floor — advances and grudges still
  close to the kind table.

## Decisions

- No gun-layer change: `launchShot` already lobs grenades for peewees at
  muzzle-to-impact ≤ 220, so holding the assault at 220 delivers the
  "prefer grenade at close combat" behavior with no admission change. The
  50-unit muzzle gate still holds fire point-blank (pinned doctrine).
- No general building collision: the drive still has no HQ obstacle, so a
  hull pursuing a live enemy past the works can clip the walls. That is a
  bigger pathing feature; this task covers the assault hold only.

## Tests

- Core `retaliation.test.ts` (+3): floor pins — past the pad corridor,
  equal to grenade range, only the peewee's assault moves, hull duels
  unchanged; drive-level — an assaulting peewee at 200 holds while the
  same memory without the structure flag closes, and a distant assault
  still marches.
- Core `peewee.test.ts` (+1): assault hold reads grenade mode
  (`peeweeAttackFor(pursueStandOff("peewee", true))`).

## Verification

Core 803 passed, `yarn typecheck` clean. Web suite: all pass except
`deployPages.test.ts`, which fails identically on the untouched tree
(pre-existing, workflow-YAML expectation). No Playwright (per brief).
