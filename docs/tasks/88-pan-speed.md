# Task 88 — 3x default pan speed

Keyboard (WASD/arrows) and right-drag panning felt sluggish at the stock
1x default — cross-map travel on the doubled 320×256 field took forever.
The default pan multiplier is now 3x: one constant change each in the
renderer and the View-options state, everything else untouched.

## What changed

- `cameraPan.ts`: `DEFAULT_PAN_SPEED` 1 → 3 (slider range stays 0.2–3, so
  the new default sits at the existing max; non-finite input still falls
  back to the default via `clampPanSpeed`). `PAN_SPEED_FACTOR` stays 1.2 —
  the whole 3x gain comes from the default multiplier, so keyboard and
  right-drag panning scale together exactly 3x with no base-speed fork.
- `App.tsx`: View-options default `panSpeed` 1 → 3, so the Pan speed slider
  opens at 3.0x. Slider bounds unchanged (0.2 min / 3 max / 0.1 step).
  Zoom default stays 2x (a separate task owns zoom speed).
- `TerrainCanvas.tsx`: untouched — it already seeds `controls.panSpeed`
  from `clampPanSpeed(options.panSpeed)` and routes the keyboard step
  through `panStepDistance`, so the new default flows through with no
  canvas edit.
- Tests: `cameraPan.test.ts` pins the new default/range (3x default at the
  3.0 max, base factor untouched at 1.2) plus a new case asserting the
  default keyboard step is exactly 3x the old 1x feel;
  `App.controls.test.ts` pins the `panSpeed: 3` default state.
- `.changeset/fast-default-pan.md` (new) — **patch** for web (view-only
  change; core untouched since the constants live in the renderer).

## Important decisions

- **Default up, range unchanged.** Widening the slider (e.g. max 6x/9x)
  would move two variables at once; 3x already sits at the 0.2–3 max, so
  only the default moves and anyone who hates it can still dial back down
  (the slider stays usable — it just has headroom below, not above).
  Mirrors task 87, which likewise moved only the zoom default.
- **One multiplier, both pan paths.** Per task 36, `panSpeed` scales
  keyboard panning (`panStepDistance`) and right-drag panning
  (`controls.panSpeed`) together — the default bump triples both with a
  single constant, no `PAN_SPEED_FACTOR` fork that would affect only the
  keyboard path.
- **No README change.** Same call as tasks 36/51/82/87: a view-panel
  default plus no architectural change, self-documenting in the slider
  readout.

## Verification

- `yarn test` — all pass (core + web: 34 web files / 413 web tests,
  including the new 3x-default pan-step case).
- `yarn typecheck` — 3 tasks successful; `yarn build` succeeds (renderer
  constants touched).
- Playwright not run (per task rules).
