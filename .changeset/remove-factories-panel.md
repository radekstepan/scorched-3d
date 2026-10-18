---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Remove the unasked-for "Factories" panel from the battlefield inspector rail.

## Task writeup

An earlier economy-lite task added a "Factories" panel to the inspector rail
showing per-team ground-share and build-pace rows (`% ground · ×N builds`).
The user never asked for it, so it is removed. The underlying economy-lite
simulation is untouched: the HQ spawn clock still consumes the live territory
share every tick (`TerrainCanvas`), and HQ fort squares still render on the
minimap with destroyed-state greying (`minimapHq`).

## What changed

- `apps/web/src/App.tsx` — deleted the Factories panel block (per-team
  ground-share/build-pace rows plus the "Holding ground speeds up the
  factory" caption). The `hqs` state stays: it still feeds the minimap HQ
  fort markers.
- `apps/web/src/App.economy.test.ts` — replaced the two presence assertions
  with absence assertions (no `Factories` label, no `% ground`, no `builds`)
  plus a guard that the minimap HQ markers survive.
- `apps/web/src/renderer/hqFx.ts` — `HqStatus`/`status()` doc comments no
  longer mention Factories-box rows (minimap markers only now).
- `docs/architecture.md` — dropped the Factories panel from the `App.tsx`
  responsibility row.

## Decisions

- Kept `HqStatus.share`/`pace` fields and the `hqs` state rather than
  stripping the HUD status plumbing: they still serve the minimap markers
  (`alive`) and are pinned by `hqFx.test.ts`. Removing fields would widen
  the diff with no user-visible benefit.
- No README change: this removes a UI panel, not architecture or a feature.

## Verification

- `App.economy.test.ts` — 3 passed (1 spawn-clock + 2 rewritten panel tests).
- Full web suite — 1076 passed, 1 failed in `deployPages.test.ts`
  (expects branch `main`, workflow uses `master`); confirmed pre-existing by
  re-running on the stashed clean base.
- `yarn typecheck` (web) — clean.
- Playwright not run (per task rules).
