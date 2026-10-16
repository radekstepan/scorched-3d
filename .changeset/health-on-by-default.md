---
"@scorched-3d/web": patch
---

Turn the View menu Health toggle on by default so overhead unit health bars show from the first frame; the toggle still opts out.

## Task writeup (moved from docs/tasks/76-health-on-by-default.md)

# Task — Health bars on by default

The View panel gained a `Health` toggle (see `docs/tasks/34-overhead-health.md`)
that floated a billboarded bar above every live hull, but it shipped off by
default — new players never saw the at-a-glance damage readout until they
found the toggle. Health bars now render from the first frame.

## What changed

- App (`apps/web/src/App.tsx`): default `showHealth` flips `false` → `true`.
  The `Health` toggle itself is untouched, so opting out still works, and the
  `TerrainCanvas` tick already feeds the flag into `health.setVisible()`, so
  no renderer change was needed.
- Tests (`apps/web/src/App.health.test.ts`, new): 3 source-level vitest cases
  pinning the default (`showHealth: true`), the toggle wiring
  (`label="Health"` + `patch({ showHealth:`), and the canvas visibility feed
  (`health.setVisible(` + `showHealth`). Follows the existing `App.controls`
  pattern of asserting App ↔ canvas wiring at the source level (canvas needs
  WebGL; bar rendering stays covered in `healthBars.test.ts`).
- `.changeset/health-on-by-default.md` (new) — **patch** for web (view-only
  default flip, no sim change).

## Important decisions

- **One-line flip, no renderer touch.** `TerrainCanvas` already honors the
  flag every tick, so the default is the whole feature.
- **No README change.** Small view default like waypoints/health toggles; the
  View panel is self-documenting.

## Verification

- `yarn test` — all pass.
- `yarn typecheck` — clean.
- Playwright not run (per task rules).
