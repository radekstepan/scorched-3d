# Task 132 — Unselected unit rings ~30% more visible

The unselected team ground ring (the unit's one ground circle, opacity 0.30
since task 67) was too quiet to read at a glance. It now renders at 0.39
opacity — exactly 30% over the old value — while the selected ring stays
at 0.90 with its widened band.

## Decisions

- Opacity-only change: `TEAM_RING_OPACITY` 0.30 → 0.39 in
  `apps/web/src/renderer/units.ts`. Geometry (thin 2-unit band), team
  colors, and the selected-state thicken + brighten behavior are untouched,
  so the selected/unselected contrast gap (0.9 vs 0.39) still reads clearly.
- Test update: the "subtle by default" ceiling in `units.test.ts` moves
  0.35 → 0.45, plus a new pin `TEAM_RING_OPACITY ≈ 0.3 * 1.3`.
- No README change: renderer-internal visual tweak, no architecture or
  user-facing control change.

## Files

- `apps/web/src/renderer/units.ts` — bumped `TEAM_RING_OPACITY`.
- `apps/web/src/renderer/units.test.ts` — raised subtle ceiling, pinned the
  ~30% boost.
- `.changeset/brighter-idle-unit-rings.md` (patch), `docs/tasks/132-*`
  (this writeup).

## Verification

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — core 24 files / 566 tests pass; web 39 files / 609 tests pass.
- Playwright not run (per task rules).
