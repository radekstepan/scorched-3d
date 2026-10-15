# Task — Move View / Probe / Units panels clear of the header diagnostics

The right-hand rail (View, Probe, Units panels) was anchored at
`top-24` / `md:top-28` (96px / 112px), while the header diagnostics
panel (TNT, tileset, grid, world, tiles, sea) in the same top-right
corner extends to roughly 150px below the viewport top. The rail's
View panel therefore covered the diagnostics up.

## What changed

- App (`apps/web/src/App.tsx`): the right-rail aside moves from
  `top-24 md:top-28` to `top-44 md:top-48` (176px / 192px), leaving a
  ~26–42px gap below the diagnostics panel's bottom edge. It also
  gains `max-h-[calc(100vh-14rem)] overflow-y-auto` so the tall
  three-panel stack scrolls internally on short viewports instead of
  running off the bottom of the screen.
- Tests (`apps/web/src/App.layout.test.ts`, new): 4 vitest cases that
  read `App.tsx` and pin the layout contract — rail top offsets clear
  the ~150px header footprint on mobile and desktop, the rail scrolls
  rather than overflows, and all six panels/labels (View, Probe,
  Units, TNT, tileset, grid) are still present.
- `.changeset/right-rail-clearance.md` (new) — **patch** for web
  (layout-only change).

## Important decisions

- **Fixed offset, not a layout reflow.** The header and rail are both
  absolutely positioned overlays; anchoring the rail at a fixed offset
  below the diagnostics' measured footprint is the smallest change
  that resolves the overlap on every map/seed (the diagnostics panel
  has a fixed six-row height).
- **Internal scroll guard.** Pushing the rail down by ~80px eats into
  its vertical budget on short screens, so the `max-h` + scroll
  pairing keeps Probe/Units reachable rather than clipped.
- **Source-assertion tests.** The web vitest setup runs in node with
  no DOM testing library, so the regression tests assert on the
  `App.tsx` layout classes directly (offsets converted to px and
  compared against the header footprint) instead of rendered pixels.
- **No README change.** This is a pure HUD positioning fix, not an
  architecture or complex feature.

## Verification

- New `App.layout.test.ts` — 4 passed.
- Full web suite — 14 files, 176 tests, all pass.
- `yarn typecheck` (web) — clean.
- Playwright not run (per task rules).
