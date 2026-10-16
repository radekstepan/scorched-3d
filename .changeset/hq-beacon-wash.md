---
"@scorched-3d/web": patch
---

HQ warning beacon washes a wider staging area: double the falloff range with peak intensity scaled to match, so the works, hall, and nearby ground read in pulsing red instead of just the canopy and door apron

## Task writeup (moved from docs/tasks/130-hq-beacon-wash.md)

# Task 130 — Wider HQ beacon wash

The HQ red warning beacon now illuminates a real staging area around the
works instead of just kissing the canopy and door apron: falloff range
170 → 340 (double the radius) with peak intensity 900 → 3200 so the wider
radius is actually lit, not just a wider cutoff of darkness. Decay stays
1.8 (same curve as the combat light pools).

## What changed

- `apps/web/src/renderer/hq.ts` — `HQ_BEACON_DISTANCE` 170 → 340,
  `HQ_BEACON_PEAK` 900 → 3200; the decay magic number is now an exported
  `HQ_BEACON_DECAY = 1.8` used by the `PointLight` constructor. Comments
  updated (works + hall + staging apron, not canopy + apron).
- `apps/web/src/renderer/hq.test.ts` — new case "washes a wide staging
  area around the works, not just the canopy": range covers the full hall
  plus an apron past the mouth (> 2× beacon-to-mouth distance), and the
  physical-falloff curve (`peak / d^decay`) still reads strong at the
  hall mouth, visible at the old 170 edge, and non-dark at the new edge.
- `.changeset/hq-beacon-wash.md` (patch, web only).

## Decisions

- Peak scaled as 900 × 2^1.8 ≈ 3200: doubling the radius under decay-1.8
  falloff needs ~3.5× intensity to hold the same brightness at the old
  edge, so the area gain is honest light, not a dimmer spread.
- No ground-glow blob on the dirt: the terrain shader ignores scene
  lights (see task 99), so the wash lands on Lambert neighbors — the
  works itself, nearby hulls, trees, rocks. A terrain blob would be a
  bigger feature (pooled additive mesh, per-tick seat, wreck handling);
  out of scope for this tweak.
- No README change: small tuning tweak, no architecture or new feature.

## Test evidence

- Targeted: `hq.test.ts` + `hqFx.test.ts` — 26 tests pass (1 new).
- Full `yarn test` (web): 590/590 pass across 37 files.
- `yarn typecheck` (web) — clean.
- Playwright not run (per task rules).
