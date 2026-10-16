---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The View menu gains a Health toggle that overlays each live unit with a billboarded overhead health bar draining green to amber to red.

## Task writeup (moved from docs/tasks/34-overhead-health.md)

# Task — Overhead unit health toggle in the View menu

Units already accumulate damage (charring, smoke, embers, then death), but
there was no at-a-glance readout of remaining health. The View panel gains a
`Health` toggle (off by default) that floats a billboarded bar above every
live hull, draining and recoloring as it takes hits.

## What changed

- Core (`packages/core/src/terrain/types.ts`): `ViewOptions` gains
  `showHealth: boolean` (view-only flag, no sim logic).
- App (`apps/web/src/App.tsx`): default `showHealth: false` plus a
  `Health` toggle in the View panel, next to `Waypoints`.
- Renderer (`apps/web/src/renderer/healthBars.ts`, new): `HealthBars`
  owns one `THREE.Group` in the scene —
  - one bar per roster unit: dark background frame plus a left-aligned
    draining fill, billboarded per tick by copying the camera quaternion;
  - fill fraction is `1 - damage` (`healthFraction()`, clamped) with an
    RTS-standard green → amber → red ramp (`healthColorFor()`: green
    above 0.55, amber above 0.28, red at/below);
  - bars ride at body origin + `HEALTH_BAR_LIFT` (60, clearing the
    commander antenna and the selection chevron), at render order 13
    (above selection markers) with depth-test off so they read through
    smoke and trunks;
  - wrecks show nothing (destroyed or fully decayed husks), matching the
    waypoint overlay's policy that dead hulls promise no live state.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): builds `HealthBars`
  from the unit roster, ticks `setVisible(opt.showHealth)` +
  `update(combat, units.children, camera)` after the waypoint update, and
  disposes on unmount/regen. No re-snap hook needed: bars re-seat from
  live body origins every tick, so exaggeration changes ride for free.
- Tests (`apps/web/src/renderer/healthBars.test.ts`, new): 7 vitest cases
  driving the real class headless (no WebGL) — fraction clamping, color
  thresholds, full bars for live bodies, seating + billboarding, drain +
  recolor with damage, wreck/gone/toggle hiding, roster bounds + dispose.
- `.changeset/overhead-health.md` (new) — **patch** for core + web
  (view-only addition).

## Important decisions

- **Billboard via camera-quaternion copy, not sprites.** Sprites
  auto-face but make left-aligned drain fills awkward (center-anchored
  scaling); plain planes with a per-tick quaternion copy keep the fill
  math trivial and match how the codebase already mutates transforms.
- **Depth-test off at render order 13.** Waypoint lines stay depth-tested
  (hills occlude them naturally) but health is status chrome: it must
  read at glancing angles and through smoke, like the selection beacon.
- **Hide on wrecks, show on pristine.** A dead hull has no health to
  report, while a full green bar confirms "undamaged" versus "bar
  missing" — the distinction matters once skirmish damage starts landing.
- **No README change.** Small view toggle like waypoints; the View panel
  is self-documenting.

## Verification

- `yarn test` — all pass (229 core + 183 web, 7 new health tests).
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).
