---
"@scorched-3d/web": patch
---

Fireflies drift slightly faster: drift angular speed 0.42 → 0.48 rad/s (~1.14x), with orbit shape, radius, pools, brightness, and pulse untouched — livelier motes, same gentle look.

## Task writeup

# Task — Fireflies need to move slightly faster

The night swarm read a touch static after the last tune, so this bumps
wander speed alone: `FIREFLY_DRIFT_SPEED` 0.42 → 0.48 rad/s in
`fireflies.ts` (~14% faster, well inside the "slightly" band).

## What changed (web only — no core change)

- `fireflies.ts`: `FIREFLY_DRIFT_SPEED` 0.42 → 0.48. The lissajous orbit
  shape, drift radius, pool radius/distance/peak/decay, glow floor/amp,
  pulse rates, and budget share are all untouched — speed only.
- `fireflies.test.ts`: the legacy-hardcoded drift comparison now pins
  against 0.42 (the previous tune, itself up from the original 0.35
  amble), keeping the <1.3x "slightly" bound and the travel-ratio guard.
  The updated test was observed failing before the constant change
  (`expected 0.42 to be greater than 0.42`) and passes after.

## Decisions

- No shader mirror update: drift is CPU-side only — `fireflyDrift`
  positions flow into the shaders through the per-tick uniform field, so
  `shaders.ts` holds no drift literal (unlike the pool-radius term,
  which does need a manual mirror on pool changes).
- Nanolathe offered no drift-speed precedent (its fire-flicker recipe
  covers pulse, not wander rate), so the step size follows the repo's
  own history: the prior 0.35 → 0.42 (+20%) bump proved safe, and this
  +14% step is the smaller follow-on the task asks for.
- No README update: constants-only visual retune, no architecture change.
