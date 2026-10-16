---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Raise the default height scale to 3.0x (1.5x the previous 2.0x): new maps open with more dramatic relief via a shared `DEFAULT_EXAGGERATION` constant. Slider range unchanged.

## Task writeup (moved from docs/tasks/93-height-scale.md)

# Task 93 — Default height scale 1.5x (2.0 → 3.0)

## What changed

- `packages/core/src/terrain/types.ts` — new exported
  `DEFAULT_EXAGGERATION = 3.0` (1.5x the previous 2.0x default for more
  dramatic relief). Slider range (1–6) unchanged.
- `apps/web/src/App.tsx` — initial `ViewOptions.exaggeration` now reads
  `DEFAULT_EXAGGERATION` instead of the hardcoded `2.0`, so the constant
  is the single source of truth.
- `packages/core/src/terrain/viewOptions.test.ts` — new: pins the default
  at 3.0x and asserts it stays inside the 1–6 slider range.
- `.changeset/taller-default-height-scale.md` — patch changeset (core + web).

## Decisions

**Multiply, don't set to 1.5.** The task title ("1.5x") is ambiguous, but
the brief says "1.5x current", and the live default was 2.0x — so the new
default is 3.0x, matching the slider's `×` units. A shared constant beats
another magic number in `App.tsx`.

**No README change.** README describes the default only as "gentle" with
no numeric value; 3.0x is still inside the existing slider range.

## Verification

- `yarn workspace @scorched-3d/core test` — 23 files / 474 tests pass
  (2 new).
- `yarn typecheck` — 3 tasks successful.
- `yarn test` (all) — one failure in
  `apps/web/src/renderer/combatFx.test.ts > dead hulls stop firing`,
  pre-existing (same failure on clean main via `git stash`; unrelated to
  height scale).
- Playwright not run (per task rules).
