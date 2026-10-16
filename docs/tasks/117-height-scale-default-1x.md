# Task 117 — Default height scale 1x

## What changed

- `packages/core/src/terrain/types.ts` — `DEFAULT_EXAGGERATION` 1.5 → 1.0,
  so new maps open at the 1x slider stop (the rebased old-2x view). Slider
  range (0.5–3), `BASE_HEIGHT_SCALE`, and the `worldHeight` /
  `effectiveExaggeration` mapping are untouched; `App.tsx` already reads
  the constant, so no web code changed.
- `packages/core/src/terrain/viewOptions.test.ts` — default pins updated:
  `DEFAULT_EXAGGERATION` is 1.0, `worldHeight(100, default)` is 200, and
  `effectiveExaggeration(default)` is 2.0.
- `.changeset/height-scale-default-1x.md` — patch changeset (core + web).

## Decisions

**Constant-only change.** The rebase (task 108) made `DEFAULT_EXAGGERATION`
the single source of truth consumed by `App.tsx` initial state, so moving
the default is a one-line change with no UI or shader edits.

**No README change.** README describes the default only as "gentle" with no
numeric value; 1x is still inside the existing slider range, and this is not
an architecture change.

## Verification

- `yarn workspace @scorched-3d/core test` — 23 files / 510 tests pass
  (6/6 in `viewOptions.test.ts`, updated pins).
- `yarn workspace @scorched-3d/web test` — 36 files / 544 tests pass.
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).
