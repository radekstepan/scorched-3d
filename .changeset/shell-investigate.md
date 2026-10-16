---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Shelled hulls now investigate the firing position: wounds from arcing shells record a threat past the bolt engage/leash gates (on the hunt leash, under the same timeout), so idle patrols turn and pursue the battery instead of ignoring it, turrets traverse onto the live shooter even before the scheduler draws the pair, and same-team shooters never draw retaliation. Player orders still win and all pursuit limits still apply.

## Task writeup (moved from docs/tasks/105-shell-investigate.md)

# Task 105 — Shelled hulls investigate the firing position

A tank under artillery fire used to take it with total indifference: hammer
shells outrange the bolt envelope (1000 vs the 900 retaliation engage gate),
so a hull shelled from beyond line-of-sight recorded no threat memory at all
— it kept walking its patrol loop while the shells landed, and its turret
sat on a stale aim. The same silence covered shell sources past the 650
patrol-anchor leash. Wounds from arcing shells now investigate: the victim
records the firing position on the hunt leash, turns hull and turret toward
the incoming direction, and pursues within the same bounds as every other
chase — then gives up and resumes patrol like one.

## Decision: extend the pursuit limits to shell sources, not a parallel system

The fix rides the existing threat pipeline end to end (record → drive →
guns), with wider gates only where shells ballistically differ from bolts:

- `SHELL_ENGAGE_RADIUS = 1100` (core `retaliation.ts`): sized past the
  hammer's reach (1000 + the scheduler's +50 admission margin + scatter) yet
  inside the 1250 disengage bound, so the hysteresis still holds — a fresh
  victim answers shells at 1100 while an engaged one tolerates 1250. The
  value deliberately equals the hunt-eyes scale: being shelled is as salient
  as spotting the enemy. Bolt hits resolve exactly as before (all existing
  engage/leash tests hold untouched).
- `notifyThreat` takes a trailing `shell` flag (default false — every
  existing caller replays byte-identically). Shells refused by the
  retaliation gates re-check against the shell gates (1100 engage, hunt
  leash) and record a hunt-leash memory instead of silence; close shell hits
  record a plain retaliation memory, bolt-identical. Same-attacker re-hits
  refresh inside disengage as usual and now keep the memory's carried leash
  (a ranging investigate never collapses to the tight anchor guard
  mid-chase — the same argument as the task-84 drive fix, applied to
  refreshes and consistent with `seekEngage`).
- The drive needs no branch: `pursueStep` already honors the carried leash,
  tracks the live attacker through the roster snapshot, holds at
  weapons-range stand-off, yields to `shouldHold` (an outnumbered shelled
  hull holds facing the battery instead of charging it — no suicide), and
  gives up on disengage/leash/expiry. HQ-assault challenger counting is
  untouched (distant chips still count nothing — self-defense design holds),
  and assaulting hulls still upgrade to hunts through the sweep when the
  battery sits inside hunt notice.
- Authority rules preserved: ordered/holding hulls refuse shells like bolts,
  wrecks stay silent, kills fire no hook, dead shooters blame nobody, and
  the 12 s timeout still releases every investigate.

## Decision: the turret answers even before the scheduler draws the pair

The hull turns through the drive, but the turret only ever slewed toward
scheduler-drawn pairs — a shelled victim kept its stale aim until (maybe)
drawn as the attacker. New `CombatFx.trackThreat(victim, attacker)`, called
by the canvas next to `threatenUnit` on every threat hook: it plants a
pending traverse goal on the live attacker, slewed every tick (turret-only
while hulls are externally driven). It never fires by itself (range/terrain
admission still gates every round in `launchShot`), never fights the
scheduler (drawn pairs overwrite the goal; the aim feeds squad focus and
the sticky preference like any traverse), and dies with either end. Because
an investigate is a live grudge (`attacker >= 0`), the task-95 machinery
just works: engaged guns hold HQ structure fire while answering the battery.

## Decision: friendly fire is excluded at both ends

Organic fire only ever crosses team lines, but the blame path never said so
for threaded shooters (only the unknown-shooter fallback excluded mates).
`resolveThreat` now refuses same-team shooter ids and `threatenUnit` refuses
same-team pairs (both no-ops for team-less headless groups, where any live
hull stays blameable). Friendly shells still deal honest splash damage —
only the grudge is withheld.

## What changed

- `packages/core/src/units/retaliation.ts` — `SHELL_ENGAGE_RADIUS`,
  `notifyThreat` shell gates + hunt-leash investigate memories + leash
  preservation on refresh, docstrings.
- `packages/core/src/units/retaliation.test.ts` — "shell investigate" suite
  (9 tests).
- `apps/web/src/renderer/combatFx.ts` — `onUnitThreatened` gains the `shell`
  flag (computed from kind profile + grenade lobs), `resolveThreat`
  same-team guard, new `trackThreat` traverse.
- `apps/web/src/renderer/movement.ts` — `threatenUnit` gains `shell` plus
  the same-team guard.
- `apps/web/src/renderer/TerrainCanvas.tsx` — wires `shell` through and
  calls `trackThreat` on every threat hook.
- `apps/web/src/renderer/retaliation.test.ts` — "CombatFx shell
  investigate" (5 tests) + "UnitMovement shell investigate" (4 tests).
- `README.md` (AI one-liner), `docs/architecture.md` (retaliation +
  movement rows).
- `.changeset/shell-investigate.md` (minor, core + web),
  `docs/tasks/105-shell-investigate.md` (this writeup).

## Tests

- Core `retaliation.test.ts` 58/58: distant shell records a hunt-leash
  memory; shells past 1100 / past the hunt leash stay silent; close shells
  record plain memories; bolt-past-leash silence vs shell investigate;
  re-hit refresh keeps the leash; close-hit refresh; order/hold refusal;
  investigate drive turns + closes on the firing position; expiry + leash
  give-ups.
- Web `retaliation.test.ts` 42/42: hook marks shells vs bolts; same-team
  shooter blamed by nobody (stun still fires); victim turret traverses onto
  the live attacker; `trackThreat` refusals; distant-shell investigate
  record (and bolt silence on the same geometry); hull turn + close; friendly
  vs enemy teams; end-to-end splash → investigate memory at the firing
  position.
- Full suites + typecheck green (see Verification).

## Verification

- Core: 502/502 pass (`packages/core`), incl. 9 new shell-investigate tests.
- Web targeted: `retaliation.test.ts` 42/42 (9 new).
- `yarn typecheck` — 3 tasks successful. `yarn build` — green.
- Full web suite: 500/501. The single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire",
  `shotCount` 1 vs 0) is pre-existing: verified failing on unmodified main
  via `git stash` + clean core rebuild (same failure recorded in task 95).
  Untouched by this change (no `trackThreat` call in that fixture, null
  threat hook, no scheduler/pair-picking changes).
- Playwright not run (per task rules).
