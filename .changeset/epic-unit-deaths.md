---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Epic unit death explosions: hulls that exhaust their health (damage reaching 1) die once in a scaled-up layered burst — longer staging, bigger fireball and shockwave footprint, double smoke puffs, 80 sparks, harder light kick — then persist as fully-charred smouldering wrecks that no longer fire, drive, select, or draw fire, with dimmed minimap dots

## Task writeup (moved from docs/tasks/28-epic-unit-deaths.md)

# Task 28 — Epic unit death explosions

Hulls used to shrug off everything forever: damage accumulated to a 0..1
fraction that charred paint and trailed smoke, then pinned at 1 with the unit
driving on. Exhausted hulls now die once, loudly — a scaled-up layered burst
at the hull — and stay on the field as fully-charred smouldering wrecks that
no longer fire, drive, select, or draw fire.

## What changed

- Core `units/unitDamage.ts`: new `UNIT_KILL_DAMAGE = 1` plus
  `isDestroyed(damage)` (`damage >= 1`). Exhaustion == reaching the existing
  accumulation clamp, so no balance or splash math changed: a hammer needs
  ~7 point-blank hits, a flash ~17. The kill transition derives from the
  before/after pair of one splash (`!isDestroyed(prev) && isDestroyed(next)`),
  so it fires exactly once per hull with no extra state and no rng.
- Renderer `combatFx.ts`:
  - Owns `destroyed[]` + `deathCount` (sized with the damage array,
    persistent like scorch — `clearTransients` never resets them) and an
    `onUnitKilled` hook for the canvas. New getters `isDestroyedAt` /
    `killCount` / `aliveCount`.
  - `explode(..., epic)` scale path: epic bursts stage 1.8 s (vs 1.0),
    1.6× fireball/flash/ring/glow footprint, 6 smoke puffs (vs 3), 80 sparks
    (vs 36), and a 5200-peak light kick (vs 2600) — inside the same
    8-explosion oldest-eviction pool, with per-explosion spark counts so the
    shared advance loop never overruns the smaller stacks.
  - `explodeDeath` scars hammer-sized scorch + dent through the shared path
    (the wreck gets the biggest footprint regardless of what killed it) and
    its splash can chain-kill neighbours — recursion depth is bounded by the
    roster since each hull dies once.
  - Targeting draws pairs from live hulls only (`pickLivePair`, same rng
    consumption shape as the core picker); fewer than two live hulls goes
    quiet. Pending traverse goals involving wrecks are dropped.
- Renderer `movement.ts`: `markDestroyed` (drop order, hold forever) +
  `isDestroyed`; `update` freezes wreck movers at their pre-tick state
  (core separation may have shoved them) while live hulls still
  spacing-avoid wreck positions, so nobody drives through a wreck;
  `orderUnit`/`orderGroup` refuse/skip wrecks.
- `TerrainCanvas.tsx`: `onUnitKilled` freezes the mover and deselects;
  `applySelection` filters wrecks (belt-and-braces for mid-gesture kills);
  raycast picking walks hits to the first live hull (wrecks never occlude);
  click/box picks project wreck-free with roster-index remap; the ~4 Hz
  minimap feed gains an `alive` flag.
- `App.tsx`: wreck minimap dots render dim grey (`#57534e`, 0.55 opacity)
  and can never carry the selection glow.
- `README.md`: one-phrase update (`never fatal` → death + wreck behavior).

## Important decisions

- **Fell, don't remove (extended to units).** The wreck instance is never
  removed from the roster buffers — same rule as toppled trunks/stumps/snags
  and sunk rubble. Its damage stays 1.0, so the existing damage views keep
  reading it as heavy smoke + blinking embers: the wreck smoulders for free.
- **Silence after annihilation is honest.** With one live hull left the
  skirmish goes quiet (nothing to shoot at). The demo stays lively for
  minutes first: kills need concentrated hits on one hull out of a spread
  roster. No respawns — out of scope.
- **One existing test needed a bigger roster.** The scorch-cap barrage used
  3 hulls, which now annihilate into silence at ~33 marks before the 48-mark
  cap; it runs 8 widely-spread hulls instead (still reaches the cap with
  room to spare). No production behavior was bent to suit the test.

## Verification

- `yarn test` — core 213 + web 156 pass: new core `unit death` suite
  (threshold, accumulate-to-exhaustion, once-only transition),
  `CombatFx unit death` suite (hook-once + wreck persistence + 11-layer
  epic stack with 80 sparks, fire/draw-fire silence with one hull left,
  kill persistence through `clearTransients`), and `UnitMovement wrecks`
  (freeze + order refusal + group fan skip + idempotence).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
