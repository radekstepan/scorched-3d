---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Sides now remember where the enemy is: each team keeps a sticky last-known enemy contact refreshed from the squad focus, and idle hulls advance toward it on the hunt leash instead of guarding their patrol loop after contact is lost. Position memories skip the disengage gate (a spot cannot flee) while live grudges keep full hysteresis, and advances refuse like hunts — orders/hold win, outnumbered hulls wait for backup, unblooded sides patrol as before.

## Task writeup (moved from docs/tasks/84-team-advance-ai.md)

# Task 84 — Team advance: push the last-known enemy direction after contact is lost

On the doubled map (task 74) the skirmish kept stalling: a mid-map meeting
ended, threat memories expired after 12 s, hunts saw nothing past the 1100
notice gate — and every survivor walked its patrol loop and guarded it while
the enemy regrouped a screen away. Retaliation knew *how* to fight and the
strategy layer knew *whether* the fight was winnable; nothing remembered
*where* the enemy was. Sides now keep a sticky team-level contact — the
last-known live enemy position, refreshed from the squad focus while any
teammate pursues — and idle hulls whose side knows the enemy direction
advance toward it instead of idling.

## Decision: advance rides the threat pipeline as a position memory

New core constructor `advanceMemory(x, z)` (`retaliation.ts`) builds a
`ThreatMemory` with `attacker: -1` (a position, not a roster grudge — the
same convention as an HQ structure seek, so it never feeds squad focus or
gun grudges) on the hunt leash (`HUNT_LEASH_RADIUS`), so the push stays
local to the patrol anchor like every other pursuit.

Two drive rules changed in `pursueStep` (`movement.ts`) to make that work:

- Position memories skip the disengage gate: a last-known spot cannot flee,
  so distance from it is the reason to advance, not a reason to give up.
  Live grudges keep the full hysteresis. (HQ structure seeks were already
  leash-bound inside 650, so they behave exactly as before.)
- The refreshed memory keeps its carried leash instead of dropping it: a
  wide-leash chase previously collapsed to the tight 650 anchor guard after
  one drive tick, so hunt-range pursuits died on the second step. Retaliation
  memories carry no leash and step byte-identically.

## Decision: the renderer owns the sticky contact, the core owns the gates

`UnitMovement.sweepHunt` records each side's contact per tick (its
`squadFocus` position — being shot counts as discovery, since the victim's
retaliation memory points back at a live enemy) and keeps it after contact
is lost. A free hull that finds no hunt advances when its side knows the
direction; the issue refuses exactly like a hunt:

- ordered/holding hulls (player orders win), wrecked hulls, sides with no
  contact ever (guard fallback: unblooded sides patrol byte-identically),
  no live enemy left anywhere (the war is over — survivors stand down
  instead of marching on corpses), contacts past the hunt leash of the
  patrol anchor, and outnumbered hulls (`shouldHold`: wait for backup,
  never push alone into a column).

A hull carrying an advance still upgrades to a live hunt the tick one
appears (the sweep clears the -1 memory for the acquisition attempt), and
position memories now survive the dead-attacker clear — a structure is
never a dead roster row, which also lets HQ obstruction seeks (task 81)
actually drive instead of dying in the next sweep. Guns are untouched:
targeting stays live-enemies-only across team lines, so friendlies never
draw fire; the advance only moves hulls into range.

Nanolathe parallel: retail TA units guard a post, answer attackers inside
it, and return — the advance is the one deliberate deviation: once the
post has been bloodied, the side pushes the enemy direction instead of
returning to it.

## What changed

- `packages/core/src/units/retaliation.ts`: `advanceMemory` (+ doc section).
- `packages/core/src/units/movement.ts`: disengage exemption for attacker
  -1, leash preservation across drive ticks, docstrings.
- `apps/web/src/renderer/movement.ts`: sticky `teamContact` per side,
  advance fallback in `sweepHunt` (`advanceTowardContact`), -1 memories
  survive the wreck clear, advance upgrades to live hunts same-tick.
- `README.md` (AI one-liner), `docs/architecture.md` (advance rows).

## Tests

- Core `retaliation.test.ts` (+5): advance shape/leash/-1, invalid
  positions, disengage-exempt drive past 1250 inside the leash, leash/expiry
  give-ups, leash preserved across two drive ticks.
- Web `retaliation.test.ts` (+4): idle hull advances toward the squad's
  last-known contact on a -1 memory and visibly closes; guard fallback with
  no contact ever; ordered hull stays on its order while its side advances;
  outnumbered hull waits instead of advancing into a column.
- Existing suites untouched and green (dead-attacker drop, no-civil-war,
  lone-scout wait, squad-focus join all hold).

## Verification

`yarn typecheck` (3 tasks), `yarn test` (core 22 files / 447 tests, web 34
files / 409 tests), `yarn build` — all green.
