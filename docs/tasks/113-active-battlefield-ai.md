# Task 113 — Active battlefield AI (recon, team alerts, HQ sharing)

After the strategy layer (task 69) the battlefield kept falling asleep: both
sides patrolled their loops out of notice (1100 hull / 1500 scout gates on a
~5k-wide field), nothing probed, and nothing reinforced — moving one opponent
closer finally started a local fight, but the rest of its side stood around
even while it was under attack or staring at the enemy HQ. Retaliation knew
*how* to fight and strategy knew *whether* the fight was winnable; nothing
kept eyes on the enemy or told the side what one hull had found. Sides now
recon while blind, reinforce while bloodied, and march on a spotted fort.

## Decision: hits alert the side, not just the victim

`UnitMovement.threatenUnit` already refused memories for ordered/holding
hulls (player orders win) — but the refusal also swallowed the information:
the victim's squad focus never formed, no team contact was recorded, and the
side never reinforced. Every genuine cross-team hit now stamps the victim's
side contact at the attacker's position *before* the memory gate, so even an
ordered victim that holds its order still points its mates at the firing
position. Damage is ground truth (the shooter is always inside weapon
range), so no engage gate applies to the alert — the sweep turns it into
advances next tick.

## Decision: advances ride a team-wide leash

The old advance leashes (1400 hunt / 2000 scout from each hull's own
anchor) are what stranded teammates: a contact found on one side of the
field was past the leash of anchors on the other, so reinforcements died in
the sweep and heavies "did nothing". New core constant
`TEAM_ADVANCE_LEASH_RADIUS = 3500` (roughly a full map width) carries every
team advance — hull contacts, HQ sightings, recon pushes — so the side
marches instead of refusing. Retaliation and hunt memories keep their tight
leashes; only attacker--1 position memories (never a grudge, never squad
focus) ride wide. The old scout-vs-tank leash split is gone by design:
scouts still differ through wider notice gates, the `shouldHold` exemption
(they probe where heavies wait), and recon below — not through a longer
leash. The one remaining leash test now asserts both kinds hold past 3500.

## Decision: scouts recon while blind, hulls spot forts team-wide

Two sweep additions close the cold start and the HQ gap:

- Active recon: a free peewee whose side has no contact ranges toward the
  centroid of live enemies' patrol anchors (their staging area) on the team
  leash instead of guarding its loop. Heavies hold until contact exists, so
  the battle opens with probing, not columns wandering. The first hull or
  fort the scout notices converts the push to a live hunt or an HQ assault
  same-tick, which focuses the side behind it.
- Fort spotting: the canvas feeds live HQ positions (`HqFx.targets()`,
  wrecks excluded) into `UnitMovement.setHqProvider`. A hull inside its
  notice gate of an enemy fort shares the works team-wide (live hull grudges
  win — a side already fighting keeps its hull contact) and assaults the
  fort itself as a `structure: true` memory on the team leash, so the side
  that finds the enemy HQ pushes it. A live enemy fort also counts as a
  standing enemy for the advance's war-over check, so the push does not end
  while the works stands.

Nanolathe parallel: retail TA units guard a post and return — recon and the
team-wide push stay the deliberate deviation from task 84 (once bloodied or
spotted, the side attacks), extended to the unblooded open: scouts range
before first contact, and forts are contacts worth pushing.

## What changed

- `packages/core/src/units/retaliation.ts`: `TEAM_ADVANCE_LEASH_RADIUS`
  (+ doc section).
- `apps/web/src/renderer/movement.ts`: team-wide alert in `threatenUnit`;
  `hqProvider` + `setHqProvider`; fort spotting in `sweepHunt` (shared
  contact + `assaultSpottedHq` on the team leash); `reconTowardEnemy` for
  contact-less scouts; advances (and the war-over check) on the team leash
  with live-fort awareness.
- `apps/web/src/renderer/TerrainCanvas.tsx`: wires `HqFx.targets()` into
  `movement.setHqProvider`.
- `README.md` (AI one-liner), `docs/architecture.md` (advance + driver
  rows).

## Tests

- Core `retaliation.test.ts` (+1): a position memory on the team leash
  marches a map-width contact (leash carried, disengage-exempt).
- Web `retaliation.test.ts` (+5 new, 1 rewritten): far mate reinforces a
  bloodied hull on a position memory and visibly closes; ordered victims
  still alert the side; a scout's HQ sighting assaults the fort as a
  structure memory while the blind heavy marches the shared contact; scouts
  recon toward enemy anchors with no contact while heavies (and the far
  enemy) hold; the old scout-ranges-farther test rewritten — the whole side
  now pulls onto an in-leash stale contact, and both kinds hold past the
  team leash.
- Pre-existing: 3 `combatFx.test.ts` failures (unit death, canopy lob,
  ridge lob) reproduce on clean main — unrelated to this change.

## Verification

`yarn typecheck` (3 tasks) green; core suite green (23 files); web suite
green except the 3 pre-existing combatFx failures above (also failing on
clean main at 4d8c09c).
