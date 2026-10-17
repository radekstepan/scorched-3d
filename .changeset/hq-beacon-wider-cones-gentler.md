---
"@scorched-3d/web": patch
---

The HQ red beacon cones spread wider, travel further, and melt away gently: beam length grows from 60 to 90 world units, cone base radius from 6 to 12 (half-angle ~5.7° → ~7.6°), the axial fade ramp spans half the beam instead of a third, and the silhouette-fade exponent softens from 1.5 to 1.2 so the flanks hold glow longer — while the peak opacity stays identical.

## Task writeup

# Task — HQ red light: wider cones, further travel, gentler fade into the distance and onto the sides

The HQ warning beacon's light-tower cones (60 long, 6 base radius, axial
fade span 0.35, silhouette exponent 1.5) read narrow and short: they died
out quickly along the beam and edged off hard at grazing view angles. The
request: wider cones that travel further and fade more gently both into
the distance and onto the sides.

## What changed (web only — no core change)

`apps/web/src/renderer/hq.ts` — beacon beam constants only (the shader
bakes them as literals, so no GLSL edits; geometry, level drive, rotor,
and wreck behavior untouched):

- `HQ_BEACON_BEAM_LEN` 60 → 90: the cones travel 1.5x further, reaching
  well past the works without touching the PointLight wash edge.
- `HQ_BEACON_BEAM_RADIUS` 6 → 12: wider cones even at the longer range —
  the opening half-angle grows from ~5.7° to ~7.6° (a uniform scale-up
  would have held the angle), and the far disc now covers the hall-mouth
  apron as it sweeps.
- `HQ_BEACON_BEAM_FADE` 0.35 → 0.5: the axial ramp spans half the beam, a
  long gentle melt into the distance instead of a quicker step to full.
- `HQ_BEACON_BEAM_EDGE` 1.5 → 1.2: the silhouette exponent drops toward
  linear, so the flanks hold more glow at grazing angles and ease off
  softly onto the sides. Kept just above 1 so the existing "real edge
  falloff" bound still holds.
- Peak opacity untouched at 0.22, and the PointLight wash (distance 900,
  decay 1.5 from the earlier dispersal retune) untouched — this task is
  the cone layer of the 3-layer beacon stack, and dispersal again comes
  from shape + falloff, not brightness.

## Decisions

- Scoped to the beam cones, not the wash: the task's "wider cones" plus
  "onto the sides" (the silhouette term) names the cone-shader layer;
  the wash layer was already dispersed in an earlier task.
- Sibling nanolathe repo has no beacon/beam/cone precedent (Go codebase,
  no matches) — nothing carried over; followed the repo's own
  legacy-hardcoded comparison test pattern from the wash retune instead.

## Tests

- New `hq.test.ts` case "spreads wider cones that travel further and melt
  gently outward and sideways": hardcodes the legacy shape (60/6/0.35/1.5)
  and pins longer + wider-angle beams, a still-ramping axial value where
  the legacy curve already burned full, lifted flank factors at facings
  0.25/0.5/0.75, untouched peak opacity, built geometry following the
  retune, and GLSL literal parity for both fade constants (a stale baked
  literal would silently render the legacy look). Observed failing before
  the change (`expected 60 to be greater than 60`), passing after.
- `hq.test.ts` + `hqFx.test.ts`: 39/39 pass. Full web suite: 752/753 —
  the single failure is the known pre-existing `deployPages.test.ts`
  workflow-yaml assertion on the untouched tree. `typecheck` exits 0.
