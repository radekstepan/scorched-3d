---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Shared team enemy intel: each side now keeps a per-enemy last-known memory instead of one sticky contact point, fed every sweep by every live hull's eyes — ordered, holding, and outnumbered hulls report what they spot without engaging — plus damage alerts and HQ sightings. Mobiles expire after 60 s unseen, dead subjects drop, and a record whose subject moved on drops once a live teammate re-checks the empty spot, so sides march on fresh knowledge instead of getting lost on stale points; free hulls advance on their nearest remembered contact on the team-advance leash.

## Task writeup

# Shared team enemy intel

Units on the larger maps were getting genuinely lost: each team kept a
single sticky last-known contact — one point per side, never expiring,
refreshed only while a teammate actively pursued. Two enemy groups in
different directions collapsed to one (the point flapped or one group
stayed unknown), a hull that merely *saw* the enemy shared nothing
(ordered, holding, and outnumbered hulls never acquire, so their eyes
were wasted), and a stale spot marched the side forever. If a team
discovers the enemy, the other units should know their last location —
all of them, while it is fresh, and never past it.

## Decision: a nanolathe-style remembered board, per enemy

The sibling nanolathe repo's Modern AI observer keeps a `Remembered`
record per sighted enemy — last observed position plus a `LastSeen`
tick — refreshed by visible contacts and dropped when the record ages
out (60 s for mobiles, buildings never) or the owner looks at the spot
again and finds nothing. New core module `packages/core/src/units/
intel.ts` adapts that model to this codebase's conventions:

- `rememberSighting` records/refreshes one enemy's last-known position
  with a sim-seconds timestamp. Hull contacts key by roster index;
  spotted forts key by `fortIntelKey` (negative, one per enemy HQ team),
  so hull and fort contacts coexist instead of clobbering one point.
- `sweepIntel` prunes once per sweep: mobiles unseen past
  `INTEL_MEMORY_DURATION` (60 s, five threat-memory lifetimes — long
  enough to march a contact across the doubled field) drop, forts never
  age (a works does not move), dead subjects drop (nobody marches on
  corpses), and a record whose subject moved on drops once a live
  teammate stands within `INTEL_CONFIRM_RADIUS` (250) of the remembered
  spot — the side looked and found nothing.
- `nearestIntel` names the contact each free hull advances on (leash-
  gated, ties to the lowest key); `hasIntel` gates scout recon.

Framework-free and deterministic like the rest of core: no rng, no wall
clock (the renderer passes its deterministic `elapsed`), ties
deterministic.

## Decision: spotting is passive, pursuit stays gated

`UnitMovement.sweepHunt` now feeds the board from *every* live hull's
eyes through the same sight picture hunts use (ridges hide, high ground
extends, wood shrinks, scout-aware) — ordered, holding, threatened, and
outnumbered hulls all report — on top of the existing damage alerts
(`threatenUnit` writes the board even when the victim refuses the
memory under orders) and HQ sightings. Only free hulls *act* on it:
advances still refuse exactly like hunts (player orders win,
outnumbered non-scouts wait, leash applies), and a sighting focuses the
side the same sweep it happens (one tick earlier than the old
focus-derived contact). The old focus refresh, the "live grudges win
over forts" override, and the advance-time war-over scan are gone by
design: per-enemy records make clobbering impossible, and maintenance
guarantees every record names a live subject, so the wipe stand-down
rides the same gate.

## What changed

- `packages/core/src/units/intel.ts` (+ barrel export): board types,
  fort keys, `rememberSighting` / `hasIntel` / `nearestIntel` /
  `sweepIntel`, `INTEL_MEMORY_DURATION`, `INTEL_CONFIRM_RADIUS`.
- `apps/web/src/renderer/movement.ts`: `teamContact` replaced by the
  `intel` board; `shareSightings` (passive eyes) + `sweepIntel`
  maintenance + `locateIntel` resolver in `sweepHunt`; `threatenUnit`
  writes hull records (unknown shooters share nothing — no subject to
  remember); `advanceTowardContact` marches the nearest remembered
  contact; `reconTowardEnemy` gated on `hasIntel`.
- `README.md` (AI one-liner), `docs/architecture.md` (intel + driver
  rows).

## Tests

- Core `intel.test.ts` (+15): fort-key round-trip/disjointness, record/
  refresh, junk refusal, nearest (+leash gate, tie-break, corrupt
  skip), TTL expiry boundary, fort non-expiry, dead-subject drop,
  confirm-gone drop vs subject-held vs unvisited, corrupt prune.
- Web `retaliation.test.ts` (+5 new, 2 updated): an ordered hull's
  sighting shared (old focus sharing would leave the mate patrolling);
  an outnumbered spotter's sighting shared while it holds; mates
  advance on their own nearest of two contacts; a dead contact ends the
  advance; a stale covered firing position drops while the true one
  holds. The two updated tests assert the same advances one sweep
  earlier (same-tick sharing).
- Pre-existing: 1 `deployPages.test.ts` failure (workflow-yaml branch
  assertion) reproduces on the untouched tree — unrelated to this
  change.

## Verification

`yarn typecheck` green; core suite green (25 files); web suite green
except the pre-existing deployPages failure above; `yarn build` green.
