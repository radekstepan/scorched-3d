---
"@scorched-3d/web": patch
---

Shoreline caustic seam: underwater light webs now fade in over the first few units below the surface instead of switching on at full strength exactly at the waterline, removing the hard bright line along the shore and the lighter-looking last underwater tile.

## Task writeup

# Task — Water edge seam: lighter last tile + hard line

Looking at the water, the last tile by the edge rendered lighter than the
rest, with a visible hard line separating it from the rest of the ground.

## Diagnosis

The seam was the terrain shader's underwater caustic term
(`terrainFragment` in `apps/web/src/renderer/shaders.ts`):

```glsl
color += caustic * (1.0 - wet) * vec3(0.12, 0.28, 0.3);
```

`wet = clamp(depth * 0.025, 0, 0.82)` is continuous (0 at the waterline),
but `(1.0 - wet)` is therefore 1.0 exactly at the waterline — so the
caustic webs (which peak at 1.5, per the `waterCaustic` mirror) switched on
at full strength — up to +(0.18, 0.42, 0.45) — one fragment below the
waterline and added nothing one fragment above it. A brightness step of up
to ~0.45 in green/blue along the whole shoreline: the hard line. The
`(1 - wet)` falloff stays significant over depth 0–33 world units (~2
cells, i.e. about one tile), which is why the band read as "the very last
tile" being lighter.

Ruled out along the way (numeric probe over generated maps + shader audit):

- The water surface shader itself is entirely smooth in depth
  (`mix`/`smoothstep` only), so it cannot produce a hard line; a probe
  simulating its depth/foam/color across every map edge row/column showed
  uniform values with no discontinuity.
- The map-boundary "missing skirt" theory has no mechanism that lightens
  the last inside tile or draws a line one tile in from the boundary.
- `heightTex` does decode as sRGB (`imageDataTexture` sets
  `SRGBColorSpace`, so three.js uploads `SRGB8_ALPHA8`) — but that shifts
  water depth globally (deeper-looking water everywhere), with no
  edge-only feature. Left untouched as out of scope; flagged for a
  follow-up.

## What changed

- `apps/web/src/renderer/shaders.ts`: the caustic add is now gated by
  `smoothstep(0.0, 6.0, depth)` — zero exactly at the waterline, full
  strength a few units down, then decaying with `(1 - wet)` as before.
  The webs keep their peak brightness across the shallows; only the step
  at the line is gone. New `waterCausticMask(depth)` JS mirror of the
  combined `(1 - wet) * smoothstep(0, 6, depth)` factor, following the
  file's existing mirror pattern.
- `apps/web/src/renderer/shaders.test.ts`: regression tests — the mask is
  0 at depth 0 and continuous just below it, ramps to full by depth 6,
  then decays (0.85 → 0.5 → 0.18); the GLSL caustic-add line carries the
  ramp and the old un-ramped add is gone.

## Decisions

- Depth ramp (not a wider redesign): the smallest change that removes a
  true discontinuity while preserving the established caustic look.
  Ramp width 6 world units keeps the fade tight on steep shores and
  gradual on gentle ones.
- No changes to the wet tint (already continuous), foam, or `heightTex`
  color space — each verified smooth or unrelated to this artifact.
