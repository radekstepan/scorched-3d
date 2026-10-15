# Task 61 — Static selection markers + bottom selection tray

Selecting a unit no longer flashes, spins, or bobs: the white-halo +
cyan-core double ring and the chevron beacon are static outlines. And a
selection now reads back in the HUD: a bottom-center tray shows one box per
selected (kind, team) group with a pre-rendered unit icon, a count badge in
the corner, and a team-colored top border from the same `TEAM_DEFS` source
as the Units-box chips.

## Decision: static markers, same contrast policy

`updateSelectionMarker` now poses unit scale, the chevron rest height
(`SELECTION_CHEVRON_HEIGHT`, still clearing the commander antenna), and a
fixed yaw (`SELECTION_CHEVRON_YAW`) — the `t` argument is kept for call-site
compatibility but ignored. Colors, `depthTest: false` compositing above the
scorch layer (`SELECTION_RENDER_ORDER > SCORCH_RENDER_ORDER`), shared
geometries/materials, `noHighlight` tags, the wreck filter, and the no-hull-
tint policy are all untouched, so the task-16 contrast numbers still hold
and task-43 stays pinned.

`TerrainCanvas` poses markers once in `applySelection` instead of advancing
a shared `selTime` clock every tick (that loop is gone). The
`selectionPulseScale` / `selectionBeaconBob` helpers stay exported as
documented legacy math — tests pin them — but nothing consumes them.

## Decision: tray groups by (kind, team), icons pre-rendered once

New `selectionIcons.ts`:

- `getUnitIconDataUrl(kind)` renders a 44px top-down glyph (hull rect +
  turret disc + barrel line in the kind's `UNIT_DEFS` body/accent paint;
  commander gets its kbot disc) once onto an offscreen 2D canvas and
  memoizes the data URL per kind in a module-level cache — N selected
  hulls of one kind share one `<img>` source. Under node/vitest (no DOM
  canvas) it falls back to a deterministic inline-SVG data URL in the same
  colors, so the memoization contract is testable headless.
- `groupSelection(units, selection)` folds roster indices into one box per
  (kind, team) pair with counts, in `UNIT_KINDS` then team order; unknown
  indices are skipped, missing teams default to 0.
- `selectionGroupColor(team)` returns the `TEAM_DEFS` CSS color — the same
  source the Units-box chips and minimap outlines use.

`App.tsx` renders the tray bottom-center (`bottom-12`, above the footer
hints) only while the selection is non-empty. Each box carries the team
color as a top border, the memoized icon, and a `×N` badge in the
bottom-right corner. Kills already drop from selection, so the tray never
shows wrecks.

## What changed

- `apps/web/src/renderer/selectionFx.ts`: static marker pose
  (`SELECTION_CHEVRON_YAW`), legacy pulse/bob docs; contrast + layering +
  no-tint policy unchanged.
- `apps/web/src/renderer/selectionIcons.ts` (new) + `selectionIcons.test.ts`
  (new, 5 cases): memoized icons, distinct per kind, grouping order/counts,
  team-color source.
- `apps/web/src/renderer/TerrainCanvas.tsx`: markers posed once in
  `applySelection`; per-tick animation loop removed.
- `apps/web/src/App.tsx`: bottom selection tray; Units copy now says
  "static white/cyan ring + beacon".
- `apps/web/src/renderer/selectionFx.test.ts`: marker test asserts static
  pose + time-invariance; pulse math kept as legacy.
- `apps/web/src/App.layout.test.ts` (+3): tray markup pinned at source
  level (grouping, icon, team border, count, placement); canvas tick pinned
  static (no `selTime`).
- `README.md`, `docs/architecture.md`: HUD/selection rows updated.
- `.changeset/selection-tray.md` (new) — **minor** for core + web
  (visible HUD feature; no core code changed, but the fixed changeset
  group rides along).

## Tests

- `yarn test` — all pass (core 367 + web 328, incl. 5 new icon tests).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
