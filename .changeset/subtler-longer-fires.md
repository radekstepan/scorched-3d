---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Forest fires now burn longer and read subtler: trees flame for 14 seconds before collapsing into a 22-second smoulder (36 seconds of fire history instead of 14), with smaller softer flame cones, dimmer embers, thinner smoke, and a weaker ground glow.

## Task writeup (moved from docs/tasks/31-subtler-longer-fires.md)

# Task — Subtler forest fires that burn/smoulder longer

Tree fires used to be loud and brief: big opaque cones (outer 11×34 at
0.55 opacity, core 6×24 at 0.85) with near-white-hot tints, and a fast
6 s flame + 8 s smoulder pipeline (14 s from ignition to terminal). Fires
now read as a softer, longer smoulder — smaller translucent flames over a
14 s burn collapsing into a 22 s smoulder (36 s of fire history).

## What changed

- Core pacing (`packages/core/src/units/destruction.ts`):
  - `BURN_DURATION` 6 → 14, `SMOULDER_DURATION` 8 → 22. No shape change:
    the same ignite → burning → smouldering → terminal pipeline runs on
    the same `treeAge` clocks, so crush/blast/decay interplay is untouched.
  - `SPREAD_MIN_AGE` 3 → 6 (fires must still mature to ~43% of the burn
    before seeding neighbours, about the old proportion) and
    `SPREAD_RATE` 0.08 → 0.05: longer-lived fires roll many more spread
    ticks, so the per-second rate drops to keep total fringe spread subtle.
- Renderer (`apps/web/src/renderer/fireFx.ts`, view only):
  - Smaller/softer draws: outer cone 11×34 → 8×26 at 0.38 opacity, core
    6×24 → 4.5×18 at 0.6, ember sphere 2.2 → 1.6 at 0.7, smoke sphere
    10 → 8 at 0.22, ground glow 0.32 → 0.2 opacity with 24 → 18 scale.
  - Lower seats (outer y+19 → y+15, core y+15 → y+12), gentler sway
    (±2.5 → ±1.8), flatter age curve (`0.85 − 0.35·p` instead of
    `1.1 − 0.5·p`), lifted smoke tones (burning 0.20 → 0.28 base,
    smoulder 0.55 → 0.6) so columns read grey, never near-black.
  - Dimmed tints: outer fresh green 0.42 → 0.36, core fresh green/blue
    0.82/0.42 → 0.70/0.36 — still warm, no longer white-hot.

## Important decisions

- **Longer life, same budget.** `MAX_FIRES`/`MAX_SMOKE` caps, the
  oldest-eviction rule, and per-layer instance counts are untouched —
  fires linger, they don't multiply. The lower spread rate compensates
  for the extra roll exposure so longer burns don't grow bigger scars.
- **Subtlety is view-only.** All size/opacity/tint tuning lives in the
  transient `FireFx` view; the core `DamageField` transition rules are
  unchanged apart from the four pacing constants, so determinism and the
  field-vs-view split hold.
- **Core stays hotter than shell.** The dimmed tints keep the invariant
  the tests pin (core green/blue above outer at every progress), so the
  flame heart still reads warmer than its shell, just less blinding.

## Verification

- `yarn test` — 229 core + 166 web pass: new core `longer subtle burns`
  suite (pinned 14/22 pacing, still-burning at 7 s, still-smouldering
  past the old 14 s total, spread-age proportion + rate cap) and new web
  `FireFx` tests (geometry/opacity caps per layer, longer-burn progress
  curve); updated the spread test to mature past the new spread age and
  the `burnProgress` pins to derive from `BURN_DURATION`.
- `yarn typecheck`, `yarn build` pass. Playwright not run (per task rules).
