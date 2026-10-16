---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Subtle procedural camo detail on unit hulls (shared per-kind grayscale textures; hull paint hue, damage charring, and the no-hull-tint policy preserved).

## Task writeup (moved from docs/tasks/60-camo-detail.md)

# Task 60 — Subtle procedural camo on unit hulls

Hulls carried their flat retail paint (one `color` per kind + accent) with no
surface variation — correct per the no-tint policy, but toy-smooth up close.
Every hull now wears a subtle procedural camo: a near-white grayscale
blotch+grain texture (one shared 64×64 `DataTexture` per kind) bound as
`map` on the hull-paint Lambert materials, so the paint gains disruptive
detail while its hue stays exact.

## Decision: grayscale multiply texture, per-kind cached (not per-team color)

- `apps/web/src/renderer/camo.ts` (new, mirrors the `craters.ts` baked-
  texture pattern): pure `bakeCamoBytes(kind, size)` (no DOM/canvas —
  node-testable) + cached `getCamoTexture(kind)` + `disposeCamoTextures()`
  + `applyCamo(body, kind)` dress step.
- The bake is luminance-only (R=G=B, opaque): the map multiplies the hull
  `color`, so hue is preserved exactly and no team color ever touches the
  hull — side identity stays on the ground rings / HUD chips / minimap per
  the task-43 policy. Base field 250/255 with blotch centers at most ~13%
  darker plus ±3.5 grain: readable paint with a felt pattern, never dirty.
- Per-kind variation via fixed bake seeds + blotch counts (flash 7, stump 9,
  hammer 8, commander 6); toroidal blotch distance so texels join seamlessly.
  Per-kind (not per-team) keeps the cache at 4 shared textures and avoids
  any "this hull IS blue/orange" read. Deterministic mulberry32 — no
  `Math.random`, replays match.
- `applyCamo` skips road wheels (rubber stays flat), `noHighlight` markers
  (team ring, selection furniture), and non-Lambert materials; idempotent;
  never touches `color` hexes, so the stashed-base char math is
  byte-identical.

## Preserved (pinned by tests, not just claimed)

- Damage charring lerp (`applyUnitDamageTint` → `charredColor`) and the
  exploded-husk char (`applyWreckChar` → `wreckCharredColor`) land on the
  exact same hexes with the camo map aboard (map rides along, colors lerp
  from the stashed base as before).
- Selection stays ring/beacon-only: no emissive/color tricks added, hull
  paint hexes untouched by the dress step.
- Occlusion ghost unaffected: it mirrors geometries under its own shared
  cyan x-ray materials, never hull materials, so it stays a clean cyan
  silhouette with no camo leaking in.
- Perf: 4 shared textures total, zero new materials, zero new draw calls
  (map binds onto the existing Lambert materials at build time).

## Files

- `apps/web/src/renderer/camo.ts` — bake/cache/dispose/dress.
- `apps/web/src/renderer/units.ts` — `buildUnits` dresses each body after
  `buildBody` (rides motion + exaggeration re-snaps: it's on the material,
  not the transform).
- `apps/web/src/renderer/camo.test.ts` — 6 tests: bake determinism +
  per-kind variance, subtlety bounds (min ≥ 200, mean ≥ 238, opaque
  grayscale with real pattern), per-kind texture sharing + SRGB + dispose
  rebake, built-body dress (hull mapped per kind, wheels/markers clean),
  no-tint + damage/wreck-char preservation with map aboard, plain-group
  no-op.
- `docs/architecture.md` — `camo.ts` key-file row.
- `.changeset/camo-detail.md` (patch).

## Test evidence

- `yarn test` — all pass (core 367 + web 321, incl. 6 new camo tests;
  existing damage/selection/occlusion/combat suites untouched and green).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — single-file bundle builds (renderer touched).
- Playwright not run (per task rules).
