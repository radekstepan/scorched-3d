# Task 59 — Even teams across the map (team colors + hunting AI)

Two even sides now open the battle from opposite halves — Blue west, Orange
east — with team identity readable in the HUD Units box (side chips with
alive counts), in 3D (a team-colored ground ring under every hull), and on
the minimap (team-colored dot outlines). The ambient AI finally hunts: idle
and patrolling hulls notice live enemies and close to weapons range through
the retaliation pursuit pipeline, while the guns only ever fire across team
lines. Player orders still win over every pursuit, and wrecks stay silent.

## Decision: teams muster by roster half in opposite column spans

`PlacedUnit` gains `team: 0 | 1` (core `types.ts`, with `TEAM_DEFS` names +
colors). `teamOf(index, count)` musters the first half west and the rest
east — exact 3v3 halves at the default roster, the odd tail slot joining the
east so no hull goes unassigned. `placeUnits` drops each team inside its own
column span (`teamSpan`: map split at the middle column with a 2-cell
demilitarized gap), reusing the strict → relaxed → scoring-fallback tiers
with the same dry/gentle/empty/separation invariants, so the existing
placement guarantees hold per side. The placement stream (`seed ^ 0x9e37`)
is untouched — terrain/feature snapshots cannot shift — only the draw
*x-ranges* narrowed per team.

Team colors are Blue `0x38bdf8` vs Orange `0xfb923c`: the color-blind-safe
blue/orange opposition the selection task already picked, sitting clear of
the cyan selection core and the rose pursuit trail so identity never
collides with selection or chase state.

## Decision: hunt = proximity acquisition into the retaliation pipeline

No second pursuit system. The task-55 machinery (threat memory + hysteresis
+ leash + per-kind stand-off + frozen patrol leg + player-orders-win) already
drives, holds, and gives up correctly — hunting only needed a second way to
*start* a memory. So `retaliation.ts` gains:

- `HUNT_ENGAGE_RADIUS = 1100` (wider eyes than the retaliation gate: being
  shot is salient at 900, a visible column is worth answering at 1100 — yet
  still inside the shared disengage bound 1250, so the hysteresis gap keeps
  boundary hulls from flickering),
- `HUNT_LEASH_RADIUS = 1400` (~a map half-width: mid-map meetings stay
  pursuable, nobody abandons its side to chase a contact home),
- `ThreatMemory.leash?` (absent = retaliation's tight 650; hunt memories
  carry the wider leash — `pursueStep` honors whichever the memory holds,
  so retaliation behavior is byte-identical for old memories),
- `acquireHunt()` (pure, no rng: nearest live enemy inside the hunt engage
  gate and the hunt leash of the anchor; refuses ordered/holding/busy/wreck
  hulls, same-team mates, wrecks, itself, and unknown sides).

The renderer sweep (`UnitMovement.sweepHunt`, every tick before the drive so
acquisitions steer same-tick) also drops memories pointing at wrecks —
survivors stop guarding corpses and may acquire a live enemy the same tick.
Stale single-team headless groups hunt nothing (all sides unknown → early
return), so every existing movement/retaliation test holds untouched.

## Decision: guns only fire across team lines, splashes stay honest

- Core `pickHostilePair()`: uniform over ordered cross-team pairs in roster
  order, one rng draw (null when a side is empty — the skirmish goes quiet
  instead of turning on its own side).
- `CombatFx.pickLivePair` draws from live hulls across team lines; the
  unknown-shooter fallback in `resolveThreat` blames the nearest live
  *enemy*, never a same-team mate parked nearby.
- Blast splashes still damage every hull in radius (friendly fire is honest —
  only *targeting* is team-aware), and only cross-team hits ever threaten.
- Legacy fallback: headless groups with no placement at all keep the old
  free-for-all pairing, so white-box combat suites without teams hold.

## Decision: team rings, not hull tint

The no-tint policy stands (hulls keep their normal paint including damage
charring). Identity in 3D is a flat team-colored ground ring per body
(`buildTeamRing`, radii 24–28: outside the hull footprint, inside the
selection halo, lift 1.0 under the scorch layer). Rings carry
`userData.noHighlight` (damage charring skips them), the `team-ring` name
(the occlusion ghost skips them like selection markers — it mirrors hull
silhouettes, not markers), and ride the body group so motion and
exaggeration re-snaps come free. Raycast picking needs no change (a ring hit
resolves to the same body). Units box shows per-side alive/total chips;
minimap dots keep their kind-colored fill with a team-colored outline
(selection glow still wins when selected; wrecks stay dim grey).

## Nanolathe inspiration

From the sibling `nanolathe` repo (adapted — retail runs alliance bytes and
COB scripts; this is a deterministic rAF demo):

- `research/retail-executable-spec/06-weapons-projectiles-damage-and-effects.md`:
  hostility is the registry owner's alliance row (a unit of an allied player
  is neither hostile nor own and is skipped entirely); target acquisition only
  considers non-allied live units; the projectile side byte is compared
  against the unit owner byte (allied passes through). Mirrored by
  cross-team-only pairs, enemy-only blame, and honest splashes.
- Same spec: a team-colour LOGOS texture resolves the owning player's current
  color for rendering. Mirrored by `TEAM_DEFS` colors driving rings, HUD
  chips, and minimap outlines from one source of truth.
- `04-units-orders-scripts-and-movement.md` guard behavior (units hold a post
  and return to it — the patrol anchor here) plus the task-55 leash
  precedent: hunts range on a longer leash but never abandon their side.

## What changed

- `packages/core/src/units/types.ts`: `TeamId`, `TEAM_DEFS` (+ `TEAM_IDS`),
  `PlacedUnit.team`.
- `packages/core/src/units/place.ts`: `TEAM_COUNT`, `teamOf`, `teamSpan`,
  half-constrained strict/relaxed/fallback drops.
- `packages/core/src/units/combat.ts`: `pickHostilePair`.
- `packages/core/src/units/retaliation.ts`: `HUNT_ENGAGE_RADIUS`,
  `HUNT_LEASH_RADIUS`, `ThreatMemory.leash`, `acquireHunt`.
- `packages/core/src/units/movement.ts`: `pursueStep` honors the memory
  leash (retaliation memories behave exactly as before).
- `apps/web/src/renderer/units.ts`: `buildTeamRing` / `getTeamRing` /
  `teamRingColor` (+ radii/lift constants), rings built per body.
- `apps/web/src/renderer/occlusionFx.ts`: ghost skips `team-ring` children.
- `apps/web/src/renderer/combatFx.ts`: cross-team `pickLivePair` (legacy
  free-for-all when no placement exists), enemy-only threat fallback.
- `apps/web/src/renderer/movement.ts`: `teamAt`, `sweepHunt` (wreck-memory
  drop + hunt acquisition) wired into `update` before the drive.
- `apps/web/src/App.tsx`: team chips with alive counts in the Units box,
  team-colored minimap outlines, updated panel copy.
- `README.md`, `docs/architecture.md`: team battle documented.
- `.changeset/even-teams.md` (new) — **minor** for core + web.

## Tests

- Core `place.test.ts` (+8): `teamOf` halves/tail/invalid, `teamSpan` gap,
  even 3v3 halves on opposite sides of mid across all presets/seeds,
  determinism, custom counts.
- Core `combat.test.ts` (+5): hostile-only pairing, null cases, full ordered
  cross-team coverage, unknown-side skipping, determinism.
- Core `retaliation.test.ts` (+7): memory-leash override in `pursueStep`
  (hunt chases where retaliation gives up), `acquireHunt` gates (engage /
  leash / mates / wrecks / self / unknown / orders / live-memory / invalid).
- Web `units.test.ts` (+3, bbox helpers skip the marker): ring per body in
  side colors with no-highlight + low lift, standalone builder, re-snap ride.
- Web `retaliation.test.ts` (+7): same-side silence, cross-team fire,
  one-side-wiped silence, enemy-only blame with honest friendly splash;
  hunt acquisition + closing, same-team ignore, orders-win + wreck-memory
  drop.
- Web `App.layout.test.ts` (+1): team chips + minimap team colors pinned at
  source level.
- Existing suites untouched and green (movement, combatFx traverse/damage/
  death/tree/barrel/impact, waypoints rose mode, occlusion, selection).

## Verification

- `yarn test` — all pass (core 367 + web 315).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
