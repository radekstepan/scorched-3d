---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The HQ red beacon cones open to a 45-degree half-angle and melt away with no visible edge: cone base radius grows from 12 to 90 world units (matching the 90-unit beam length), the axial fade ramp spans 80% of the beam instead of half, and the silhouette exponent drops from 1.2 to a sublinear 0.7 so the flanks hold glow and the dark fringe outlining the cone is gone — while the peak opacity stays identical.

## Task writeup

# Task — HQ red light: 45-degree cones, gentle fade into the distance and onto the sides, no visible "line"

The HQ warning beacon's light-tower cones (90 long, 12 base radius,
axial fade span 0.5, silhouette exponent 1.2) still read as narrow laser
lines (~7.6-degree half-angle): bright at facing-center with a dark
fringe toward the silhouette that drew a visible "line" of the angle,
and a ramp that burned full halfway down the beam. The request: wider
cones, like 45 degrees each, fading gently both into the distance and
onto the sides, with that line gone.

## What changed (web only — no core change)

`apps/web/src/renderer/hq.ts` — beacon beam constants only (the shader
bakes them as literals, so no GLSL edits; geometry, level drive, rotor,
and wreck behavior untouched):

- `HQ_BEACON_BEAM_RADIUS` 12 → 90: radius now equals the 90-unit beam
  length, so each cone opens to exactly a 45-degree half-angle (up from
  ~7.6°) — a broad wash of red rather than a narrow sliver, its far
  disc spanning the works and surroundings as it sweeps.
- `HQ_BEACON_BEAM_FADE` 0.5 → 0.8: the axial ramp spans most of the
  beam, so where the legacy curve already burned full the new one is
  still ramping (0.68 at the legacy span end) — a longer melt into the
  distance instead of a quicker step to full.
- `HQ_BEACON_BEAM_EDGE` 1.2 → 0.7: the silhouette exponent crosses
  below linear, so the flanks hold far more glow at grazing angles
  (0.38 vs 0.19 at facing 0.25, 0.62 vs 0.44 at 0.5, 0.82 vs 0.71 at
  0.75) and ease off softly onto the sides.
- Peak opacity untouched at 0.22, and the PointLight wash (distance 900,
  decay 1.5) untouched — this task is the cone layer of the 3-layer
  beacon stack, and dispersal again comes from shape + falloff, never
  brightness.

## Decisions

- Deliberately retired the "exponent stays above 1" bound from the two
  prior cone retunes: exponents above 1 concentrate glow at
  facing-center and leave a dark fringe toward the silhouette — that
  fringe IS the visible line this task removes. Below 1 the whole cone
  reads as one soft wash, and alpha still reaches exactly 0 at the
  silhouette (0 ^ 0.7 = 0), so there is no hard clip, just no fringe.
  The axial test now pins 0 < EDGE < 1 plus the exact-zero silhouette
  instead of the old > 1 bound.
- Length stays at 90 (no further-travel ask this time): 45° falls out
  of radius == length, pinned as `atan(radius / length) ≈ π/4` plus the
  radius-equals-length identity so a future edit to either constant
  must consciously re-tune the angle.
- Sibling nanolathe repo has no reusable atmospheric-rendering pattern
  (only incidental mentions: targeting-facility beacons in a weapons
  spec and a narrowed-target-box "cone" in a design doc) — nothing
  carried over; followed the repo's own legacy-hardcoded comparison
  test pattern from the prior cone retunes instead.

## Tests

- Reworked `hq.test.ts` "spreads 45-degree cones that melt gently
  outward and sideways": hardcodes the legacy shape (90/12/0.5/1.2)
  and pins the 45° half-angle, a still-ramping axial value where the
  legacy curve already burned full, lifted flank factors at facings
  0.25/0.5/0.75, the sublinear edge bound, untouched peak opacity,
  built geometry following the retune, and GLSL literal parity for
  both fade constants (a stale baked literal would silently render the
  legacy look). Confirmed failing on the old production code (2 tests
  fail with `hq.ts` stashed), passing after.
- `hq.test.ts` + `hqFx.test.ts`: 39/39 pass. Full suite: 772/773 —
  the single failure is the known pre-existing `deployPages.test.ts`
  workflow-yaml assertion, verified failing on the untouched tree via
  `git stash`. `typecheck` exits 0.
