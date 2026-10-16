---
"@scorched-3d/web": patch
---

The HQ red beacon wash travels further and disperses more widely: the PointLight reach grows from 560 to 900 world units and the physical-falloff decay softens from 1.8 to 1.5, so the red fades gently with distance instead of dropping off hard — while the near-field peak stays identical.

## Task writeup

# Task — HQ red light travels further, disperses wider, fades gentler

The HQ warning beacon's red PointLight wash (560 range, 1.8 decay — the
same hard curve as the combat pools) died out too close to the works: past
the staging apron the red was effectively gone, and what remained fell off
steeply. The request: the red HQ light should travel further, spread more
widely, and fade more gently with distance.

## What changed (web only — no core change)

- `hq.ts`: `HQ_BEACON_DISTANCE` 560 → 900 (~1.6x further reach) and
  `HQ_BEACON_DECAY` 1.8 → 1.5 (gentler physical falloff). The wash now
  reads clearly at the old 560 cutoff (0.24 vs 0.04 before) and still
  carries a faded 0.12 glow at the new 900 edge, where the renderer
  windows the cutoff smoothly to zero — a faded glow, not a hard disc.
- `hq.ts`: `HQ_BEACON_PEAK` stays 3200 — the near-field peak is
  identical; all of the dispersal comes from reach + falloff. The far/near
  fade ratio is ~2x gentler than the legacy curve (0.035 vs 0.018 over
  60 → 560), while far still reads dimmer than near (a fade, not a flood).
- `hq.test.ts`: the staging-wash suite pins the new curve (strong at the
  hall mouth, lit at the old 560 cutoff, faint but non-dark at the new
  edge), plus a new legacy-comparison test hardcoding the old 560/1.8
  curve to pin further reach, gentler fade, and identical peak.

## Decisions

- Distance + decay only, peak untouched: per repo learnings, light reach
  extends via distance/falloff params while the near-field peak stays
  identical, so the works themselves don't blow out while the surroundings
  gain the wash.
- Decay 1.5 rather than flatter: 1.8 → 1.5 roughly doubles the far/near
  hold without turning the wash into a flood — mid-field brightens ~4x at
  the hall mouth, which is the "dispersed" read the task asks for.
- No halo/beam/cone changes: the halo is the near-field glow around the
  lens and the cones are the circling sweep — both already diffused, and
  the task targets the travelling light (the PointLight falloff), so they
  sit out this change.
- Sibling `nanolathe` not consulted: a prior beacon task already
  established it is a Go lathe/CAM project with no analogous atmospheric
  rendering, and a two-constant falloff retune needs no inspiration.
