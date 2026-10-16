---
"@scorched-3d/web": patch
---

High-contrast selection visuals: white-halo + cyan-core double ring, chevron beacon, and hull highlight replace the amber ring so selected units read on scorch-burnt ground, plus white/cyan minimap dots and a HUD note naming blast scorch.

## Task writeup (moved from docs/tasks/16-selection-contrast.md)

# Task 16 — Selection that survives scorch (white/cyan rings + beacon)

## What the "brown mud" is

It is the persistent blast-scorch decal from tasks 09/14/15 — confirmed in
`apps/web/src/renderer/combatFx.ts:595-615` (`syncScorch`). Every impact
stamps one instanced disc (`CircleGeometry`, one draw call, capped at
`MAX_SCORCH_MARKS = 48` oldest-eviction in core `destruction.ts`), seated at
`groundY + 1.2` with `renderOrder = 2` and `polygonOffset -2`. Task 15 warmed
the tint toward ember brown: `tone = 0.17 - intensity * 0.12` with
`setRGB(tone, tone * 0.72, tone * 0.58)` — hammer impacts (intensity 0.8) land
near-black ember, flash impacts (0.55) a touch lighter. Radius 24–46 ≈ the
task-13 spacing-stop diameter, so a unit sitting in a fresh impact zone stands
in a brown disc wider than its own hull, ringed by charred/toppled features,
smoke, and fire glow. Session-lifetime, never fades — the battlefield
accumulates it.

## Why amber-on-brown failed (numbers)

Measured with the WCAG helpers now in `selectionFx.ts` (sRGB, pre-tonemap —
approximate past ACES, exact enough to pin policy):

| Pair | Contrast | Hue distance |
| --- | --- | --- |
| amber `#fbbf24` vs darkest scorch | **11.5:1** | 19° from ember `#ff7a22` |
| white vs darkest scorch | 19.2:1 | — |
| cyan `#22d3ee` vs darkest scorch | 10.6:1 | **164° from ember** |
| white vs mid-green grass | 4.9:1 | — |
| cyan vs mid-green grass | 2.7:1 | — |
| cyan vs deep water | 4.9:1 | — |

So the old ring did **not** fail on luminance — 11.5:1 clears AAA. It failed
on four other axes, which is why the fix is a system, not a color swap:

1. **Hue camouflage.** Amber sits 19° from ember orange — the ring dissolved
   into amber bolts/flashes/sparks, explosion lights, ignition glows, the
   ember-brown disc itself, and warm HUD chrome. Cyan sits 164° opposite.
2. **Flat ring, edge-on cameras.** A ground disc vanishes at glancing angles.
3. **Occlusion.** Smoke puffs, flame cones, and toppled trunks buried it; it
   was depth-tested under everything.
4. **Minimap.** A 1px amber outline on a 5px dot is invisible at a glance.

## New selection visual design

- **Double ground ring** (`selectionFx.ts`, shared geo/mat): white outer halo
  (14–22u) + cyan core (16.5–20u), `depthTest: false`, `depthWrite: false`,
  `renderOrder 10/11` — above scorch (2), water (1), smoke, and fire. White
  carries light ground (4.9:1 on grass, where cyan alone is 2.7:1); cyan
  carries dark ground (10.6:1) plus hue separation from all warm FX.
- **Chevron beacon**: cyan cone (point-down diamond) at y=52 — clears the
  commander antenna (~47) — bobbing ±4 and spinning 2.2 rad/s at 1.5 Hz in
  quadrature with the ring pulse (±7%). Motion + altitude read at glancing
  angles and through smoke; `depthTest: false` so fire glow never washes it.
- **Hull emissive lift** (`0x0a3540` cyan-black on Lambert bodies): the hull
  itself reads "selected" even when the ring is behind a trunk. Marker meshes
  are tagged `noHighlight` so the lift never touches them.
- **Single click, box multi, minimap**: `markerVisibility(count, selection)`
  maps every `clickSelect`/`boxSelect` output to per-body visibility;
  minimap dots get a 2px white outline + cyan double glow (never amber).
- **Consistency**: order pings and the shift-drag box go cyan too (same
  scorch-contrast argument); the amber hover dot stays (hover ≠ selection).
- **"Brown mud" clarified, non-invasively**: one Units-panel sentence —
  "Dark-brown patches are blast scorch — old impact scars, not mud."
  No probe/scorch lookup, no combat/damage changes.
- **Perf**: one shared geometry/material set per canvas, markers ride body
  groups through motion and exaggeration re-snaps for free, tick mutates only
  visible markers (scale/rotation/position, zero allocations). 6 units max —
  the animated set is tiny.

## Nanolathe inspiration

None directly borrowable: the sibling is headless/replay tooling plus retail
HUD DOM — it has no 3D selection-outline visuals (grep over `*.go` for
select-ring/outline visuals came back empty; its scorch parallel,
`gpurender/scorch*`, was already cited in task 09/15). The double-ring +
beacon design follows local constraints instead (instanced scorch layer,
depth-tested smoke/fire, Lambert hulls), and says so.

## Decisions

**White + cyan, not a brighter amber.** Luminance was never the problem; a
hotter amber would still sit inside the ember hue family and the fire-glow
wash. Blue/orange opposition is also the most color-blind-safe warm/cool
split (avoids red/green entirely).

**Beacon instead of a light pillar.** A tall additive pillar would fight the
2-light pool budget and bloom against smoke; a small spinning chevron gives
the same altitude cue for one shared cone mesh.

**Emissive lift, not outline post.** No post pipeline exists (single-file
Vite bundle, `MeshBasicMaterial` rings); Lambert emissive is a two-line
in-place mutation with a clean restore.

**Patch changeset.** Visible but strictly a readability fix — no API, no
model, no behavior change.

## Files

- `apps/web/src/renderer/selectionFx.ts` (new) — colors, WCAG
  luminance/contrast/hue helpers, scorch-tone mirror, pulse/bob math,
  `markerVisibility`, shared-asset `buildSelectionMarker` /
  `updateSelectionMarker` / `setBodyHighlight`, minimap style consts,
  `disposeSelectionAssets`.
- `apps/web/src/renderer/selectionFx.test.ts` (new) — 13 cases: AA contrast
  on darkest/lightest scorch + grass + water, amber-hue-camouflage vs
  cyan-opposition, depth/layering policy + coplanar offset + asset sharing,
  chevron clearance, pulse determinism/bounds, in-place marker update,
  click/toggle/box → visibility mapping, emissive lift/restore, minimap
  never-amber.
- `apps/web/src/renderer/TerrainCanvas.tsx` — marker build/apply/animate
  (shared `selTime` clock), cyan pings + drag box, dispose new assets.
- `apps/web/src/App.tsx` — minimap white-outline + cyan-glow selected dots,
  Units-panel scorch legend sentence.
- `.changeset/selection-contrast.md` (patch), `README.md` (amber → white/cyan
  blurb), `docs/architecture.md` (selectionFx.ts key-file row).

## Test evidence

- `yarn typecheck` — 3 tasks successful.
- `yarn test` — all pass: 107 web (13 new) + core suites.
- `yarn build` — single-file bundle builds (renderer touched).
- Playwright not run (per task rules).
