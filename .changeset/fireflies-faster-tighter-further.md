---
"@scorched-3d/web": patch
---

Fireflies drift slightly faster and pool their light tighter per mote while the roaming glow travels further: drift angular speed 0.35 → 0.42 rad/s, per-mote ground-pool falloff radius 38 → 34, roaming PointLight reach 150 → 175 — with peak, decay, pulse, and budget share untouched, so the gentle near-field look is preserved.

## Task writeup

# Task — Fireflies: slightly faster, slightly smaller pools, further light travel

The night firefly swarm read a touch static, and each mote's ground halo
pooled a little wide while the roaming light died out close in. The
request, three legs: motes move slightly faster, each firefly illuminates
a slightly smaller area, but the light radius travels further.

## What changed (web only — no core change)

- `fireflies.ts`: drift angular speed was a hardcoded `0.35` inside
  `fireflyDrift` — now the named `FIREFLY_DRIFT_SPEED = 0.42` (~1.2x).
  Same lissajous orbit shape and radius, just a livelier wander.
- `fireflies.ts`: `FIREFLY_POOL_RADIUS` 38 → 34 — each mote's halo pools
  slightly tighter (half-glow point pulls in ~10%, patch area ~20%
  smaller). The tree-splice pool loop derives from the constant; the
  terrain shader's hand-authored term moves with it (see below).
- `fireflies.ts`: `FIREFLY_POOL_DISTANCE` 150 → 175 (~1.17x further
  throw for the roaming PointLights). `FIREFLY_POOL_PEAK` (320) and
  `FIREFLY_POOL_DECAY` (2) untouched — the near-field halo reads the
  same, only the reach extends.
- `shaders.ts`: terrain fragment's firefly pool term `38.0` → `34.0`
  (plus the `d/38` comment), so terrain and tree surfaces stay mirrored
  on the tighter radius.
- `fireflies.test.ts`: two legacy-comparison tests hardcoding the old
  0.35 / 38 / 150 tune — one pins slightly-faster drift (named-speed
  constant, drift runs at it, more ground covered per second, ratio
  bounded), the other pins tighter pools (old half-glow distance now
  below half) + further travel (peak/decay identical, terrain carries
  the new radius with no stale `38.0`).

## Decisions

- Slight means ~1.2x: 0.35 → 0.42, 38 → 34, 150 → 175 — each leg
  perceptible but bounded (tests cap the drift/distance ratios at 1.3x
  and the radius ratio above 0.8x), preserving the gentle-pulse look.
- Reach via distance only, peak and decay untouched: per repo learnings,
  light reach extends via distance/falloff params while the near-field
  peak stays identical, so the motes themselves don't blow out.
- Budget share untouched: `FIREFLY_POOL_SHARE` (6/90) still holds the
  swarm's total ground light at the tuned lamplight level — the tighter
  radius only shrinks each mote's own patch, never multiplies the total.
- No pulse change: glow floor/amp and the pure-sine blink (no flash duty
  cycle) sit out — the task targets motion and footprint, not the
  breathing recipe.
- Sibling `nanolathe` not consulted: a prior beacon task already
  established it is a Go lathe/CAM project with no analogous atmospheric
  rendering, and its fire-flicker bounded-sine precedent is already
  baked into the pulse this task preserves — a three-constant retune
  needs no further inspiration.
