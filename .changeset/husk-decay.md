---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Destroyed units now leave a husk that slowly decays: fresh wrecks smoulder as before, then the ember spark gutters out, smoke wisps thin, and the husk sinks into the ground over a minute before vanishing — leaving only its scorch scar behind.

## Task writeup (moved from docs/tasks/29-husk-decay.md)

# Task 29 — Husk decay

Destroyed units used to persist forever as smouldering wrecks: damage pinned
at 1.0 reads as heavy smoke + blinking embers through the existing damage
views, so every wreck smoked and sparked for the rest of the session. A
killed hull now leaves a husk that slowly decays — it smoulders fresh,
gutters out over a minute while sinking into the ground, and finally
vanishes, leaving only its scorch scar as battlefield history.

## What changed

- Core `units/unitDamage.ts`: a framework-free husk-decay model, all pure
  functions of seconds-since-kill (same convention as the tree burn
  pipeline, so replays and exaggeration re-snaps cannot disturb it):
  - `HUSK_DECAY_DURATION = 60` — a wreck smoulders for a full minute before
    it finishes sinking.
  - `huskDecay(age)` → 0..1 fraction (clamped), `isHuskGone(age)` at the
    duration, `huskSink(decay)` → linear sink to `HUSK_SINK_DEPTH = 9` world
    units.
  - `HUSK_EMBER_END = 0.2` / `HUSK_SMOKE_END = 0.6` with `huskEmbers()` /
    `huskSmokes()` gates: the spark dies first, smoke lingers, both end long
    before the husk is gone.
- Renderer `combatFx.ts`:
  - Owns a `killedAt[]` kill clock (deterministic `elapsed` timestamps, sized
    with the damage array, persistent like scorch — `clearTransients` never
    touches it) plus `huskAgeAt` / `huskDecayAt` / `isHuskGoneAt` /
    `goneCount` getters.
  - New `poseHusks()` runs last in `update()` (after movement re-seats bodies
    and recoil restores them, so the absolute sink offset wins without ever
    accumulating): wrecks lower by the core sink each tick, fully-decayed
    husks hide their body while keeping the roster slot (targeting, movement,
    selection, and the dim minimap dot already exclude wrecks — no canvas
    picking/selection changes needed).
  - Passes per-unit decay fractions into `UnitDamageFx.update`, so wreck
    smoke/embers gutter through the same core gates while riding the sunk
    hulls.
- Renderer `unitDamageFx.ts`: optional 4th `huskDecay` param (0 = live);
  husks past the smoke end skip puffs, gutters skip embers. Omitted param
  keeps the legacy read, so all existing callers/tests are unaffected.
- `TerrainCanvas.tsx`: one comment update (the death hook already freezes
  the mover and deselects — decay needs nothing more).
- `README.md`: wreck phrase updated (`staying on as smouldering wrecks` →
  husks that sink, gutter out, and vanish).

## Important decisions

- **Fell, sink, then remove — but never recycle the slot.** The body hides at
  full decay yet stays in the roster buffers, like every other terminal state
  in the codebase (toppled trunks, buried rubble, capped scorch). Index
  stability for damage/selection/minimap was worth more than freeing a slot.
- **TA parallel, minus the economy.** Retail leaves corpse features as
  reclaimable wrecks (nanolathe spec 05); this demo has no economy, so the
  husk decays into the ground instead of persisting as a payout. The minute
  duration keeps wrecks readable as battle history without cluttering a long
  skirmish.
- **No lean-over/fall animation.** Movement re-poses hull rotation every tick
  from the frozen mover, so a combat-side topple would fight the pose (or
  need mover surgery). Sink + gutter + hide reads clearly at this camera
  distance; revisit if husks ever need a more dramatic death.
- **Full-roster extinction can't happen organically.** Ambient fire goes
  quiet with one hull left, so the all-husks-silent test force-kills via the
  same white-box backdoor the file already uses (`primeDamage`) — the organic
  kill→decay path is covered by the other two tests instead.

## Verification

- `yarn test` — core 216 + web 160 pass: new core `husk decay` suite
  (duration floor, clamped linear decay, monotonic capped sink,
  embers-before-smoke-before-gone ordering), `UnitDamageFx` gutter test
  (fresh husk == live gutted hull, mid decay smokes without embers, late
  decay silent, omitted param keeps legacy), `CombatFx husk decay` suite
  (fresh wreck → mid-decay sink → hidden gone with scar retained, kill clock
  survives `clearTransients` with no seat snap-back, all-husk smoke silence).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
