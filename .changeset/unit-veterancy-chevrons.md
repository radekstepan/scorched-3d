---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Unit veterancy: hulls that land kills earn ranks (Veteran → Elite → Ace) with small damage/range bonuses, gold chevron badges above their health bars, and a spinning chevron flourish on promotion. Selected veterans show their chevrons in the tray.

## Task writeup

Kills used to vanish into the wreck count. Now the shooter that lands a killing splash banks a confirmed kill, and at 1/3/6 kills the hull promotes — fighting a little harder and further per pip while wearing its rank where everyone can see it.

## What changed

- Core (`packages/core/src/units/veterancy.ts`, new): pure rank math — thresholds `[0, 1, 3, 6]`, names Rookie/Veteran/Elite/Ace, damage ×1.00/×1.10/×1.20/×1.30, range ×1.00/×1.05/×1.10/×1.15. Rank 0 reads exactly ×1.0, so legacy balance is byte-identical.
- Core (`packages/core/src/units/combat.ts`): `inRange` takes an optional `rangeScale` stretching the doctrine cap (floor never scales — veterans shoot further, not closer). The ace hammer reaches 1150, still under half a map width.
- Core (`packages/core/src/units/unitDamage.ts`): `applyBlastToUnits` takes an optional `damageScale` on the point-blank hit (radius/falloff untouched — harder, not wider).
- Web (`apps/web/src/renderer/combatFx.ts`): per-roster `kills` (sized in `ensureDamage`, persistent like damage) with `killsAt`/`rankAt` readouts; `creditKill` on the kill transition (live enemy shooters only — dead/self/same-team/cold/unknown credit nobody, teamless headless groups keep the legacy credit rule); `onUnitPromoted` hook on rank crossings; veteran damage scale in `damageUnits`; per-gunner range scale in `launchShot` and every `admissionFor` gate (doctrine cap stretches, +50 scheduler slack never scales).
- Web (`apps/web/src/renderer/veterancyFx.ts`, new): gold chevron badges (one ∧ per pip) billboarded just above the overhead health bar behind the same Health toggle, hidden for rookies/wrecks/off-screen hulls; `promote` plays the 1.5 s flourish (rank-many 1.6× chevrons, world-space spin, rise + fade). Shared badge geometry/material, per-flourish fade materials.
- Web (`apps/web/src/renderer/TerrainCanvas.tsx`): builds/ticks/disposes the layer, resizes it on reinforcement, clears flourishes on re-snap, wires `onUnitPromoted`, and broadcasts `rank` with the ~4 Hz positions.
- Web (`apps/web/src/App.tsx`): the live-units state carries `rank`; each tray box shows the group's highest rank as gold ▲ pips + the rank name in its tooltip.
- Tests: `veterancy.test.ts` (7: thresholds, cap, names, multipliers, rookie parity), combat `ranges` + `applyBlastToUnits` scale cases, `combatFx.test.ts` veterancy block (5: credit + promotion events, refusal matrix, damage scaling, admission stretch), `veterancyFx.test.ts` (7: pips, seating/billboard, hide matrix, toggle/resize, hue policy, flourish lifecycle, skip/clear), `App.veterancy.test.ts` (5: canvas + tray source pins).
- Docs (`docs/architecture.md`): veterancy rows. README gains one veterancy line.

## Important decisions

- **First kill promotes.** Nanolathe retail paces at level = kills/5, cap 5 (`internal/combat/rules.go` StrictRules.VeteranLevel, level-scaled damage in `damage.go`, 6%-per-tier reload in `slots.go`) — too slow for small skirmish rosters that rarely bank five kills per hull. The borrowed shape is threshold ranks + bounded combat bonus; the curve (1/3/6, cap 3) pays off the first kill for attachment while the ace ceiling (+30% damage, +15% range) keeps one ace from snowballing.
- **Multipliers live in core math, visuals are view-only.** Damage and range scale inside the deterministic splash/gate functions; badges, flourish, and tray pips only read `rankAt`. No new systems — kill attribution rides the existing before/after kill transition plus the threaded shooter id.
- **Strict credit, honest refusals.** Same-team kills earn no medals, dead/self/unknown/cold kills credit nobody — mirroring the `resolveThreat` blame guards so credit and retaliation can never disagree about who shot whom. Fort kills stay uncredited (hull ranks only).
- **Gold chevrons, selection-cyan kept sacred.** The badge uses medal brass at 90°+ hue from the selection beacon, renders above the health fill, and hides with the Health toggle — rank reads as information, never as selection.

## Verification

`yarn build`, `yarn typecheck`, `yarn test` — full suite green except the known pre-existing `deployPages` branch-name failure. No Playwright.
