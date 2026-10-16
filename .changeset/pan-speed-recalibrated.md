---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Pan speed 1x is now the old 0.3x feel: the base pan speed drops from 4.05 to 1.215 (4.05 x 0.3), slowing keyboard and right-drag panning to 30% at every slider position while the 0.2x-3x multiplier semantics stay intact.

## Task writeup

# Task 140 — Pan speed 1x should be old 0.3x

The camera pan speed slider's 1x setting was too fast. The base pan speed
is recalibrated so the new 1x position produces exactly what 0.3x used to
produce — every slider position now pans at 30% of its former speed.

## What changed

- Renderer (`apps/web/src/renderer/cameraPan.ts`): `PAN_BASE_SPEED`
  4.05 -> 1.215 (= 4.05 x 0.3), plus updated doc comments on the constant,
  `effectivePanSpeed`, and `panStepDistance`. No logic, bounds, or
  default changes.
- Tests (`apps/web/src/renderer/cameraPan.test.ts`): the base-speed case
  now pins pan 1.215x, and the recalibration case asserts new 1x equals
  the old 0.3x position (`effectivePanSpeed(1)` close to `4.05 * 0.3`;
  loose comparison because the float product is 1 ulp off the literal).

## Important decisions

- **One-constant change.** Both pan paths (keyboard via
  `panStepDistance`, right-drag via `controls.panSpeed`) already scale
  through `PAN_BASE_SPEED`, so changing that constant recalibrates them
  together with no wiring changes and no drift between inputs.
- **Literal 1.215, not `4.05 * 0.3`.** The product evaluates to
  1.2149999999999999 in float64, so the constant keeps a clean literal
  and the test uses `toBeCloseTo` for the old-0.3x relation.
- **Slider range and defaults untouched.** `DEFAULT_PAN_SPEED` stays 1
  and the 0.2x-3x bounds stay put; only the absolute feel behind 1x
  changes, so existing saved/1x states automatically get the slower feel.
- **No README change.** View-panel feel tweak like past speed changes;
  the slider UI is unchanged and self-documenting.

## Verification

- Focused `cameraPan.test.ts` run before the source change: new
  expectation failed as expected (77.76 vs 23.328).
- `yarn test` — all pass (574 core + 649 web).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — 2 tasks successful.
- Playwright not run (per task rules).
