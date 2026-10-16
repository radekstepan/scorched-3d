---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Make unit team rings subtle by default (lower opacity, thinner band) and brighten the selected unit's ring (opaque + slightly larger); team colors unchanged.

## Task writeup (moved from docs/tasks/67-subtle-unit-rings.md)

# Task 67 — Subtle unit rings that brighten on selection

Team ground rings ran at 0.85 opacity on a 4-unit band, competing with the
selection halo on every hull. They are now quiet side markers that brighten
only on the selected unit.

## Decisions

- Subtle by default: `buildTeamRing` drops to 0.30 opacity on a thinner
  2-unit band (`TEAM_RING_INNER` 25 / `TEAM_RING_OUTER` 27, was 24/28).
  Team colors unchanged.
- Selection boost: `setTeamRingSelected(body, selected)` sets the ring to
  0.90 opacity at 1.1× scale on select, restores the subtle marker on
  deselect. Pure helpers `teamRingOpacity` / `teamRingScale` pin the split.
- Wiring: `TerrainCanvas.applySelection` calls `setTeamRingSelected` per
  body alongside the select-marker pose; spawns start subtle (hidden
  marker, default ring). No hull tint — the no-tint policy stands.

## Files

- `apps/web/src/renderer/units.ts` — thinner ring, `TEAM_RING_OPACITY` /
  `TEAM_RING_OPACITY_SELECTED` / `TEAM_RING_SCALE_SELECTED`,
  `teamRingOpacity` / `teamRingScale` / `setTeamRingSelected`.
- `apps/web/src/renderer/TerrainCanvas.tsx` — `applySelection` brightens
  the selected bodies' rings.
- `apps/web/src/renderer/units.test.ts` — "team ring selection emphasis":
  subtle default, pure-helper split, boost/restore keeping team color,
  plain-group no-op.
- `README.md` — "subtle team rings … (brightening on selection)".
- `.changeset/subtle-unit-rings.md` (patch), `docs/tasks/67-*.md` (this writeup).

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — core pass; web 29 files / 359 tests pass (356 before + 3 new).
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
