---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Artillery elevation realism: hammer mounts are capped at 70° so guns answer blocked canopy with flat fire and hold fire (asking for a reposition) when only a beyond-mount lob would clear a ridge, and every barrel cranks onto its firing solution at a limited elevation rate instead of snapping there in one frame

## Task writeup (moved from docs/tasks/114-artillery-elevation-realism.md)

# Task 114 — Artillery elevation realism

Artillery no longer points its cannon at the sky: the hammer mount is capped
at a realistic 70° (self-propelled-howitzer band), and every barrel cranks
onto its firing solution at a limited elevation rate — fire waits for the lay
the way it already waited for the yaw traverse.

## What changed

- `packages/core/src/units/combat.ts`
  - `ELEVATION_MAX` is now a per-kind table: hammer 70° (`7π/18`), every
    other mount keeps the legacy 1.45 ceiling (bolts aim near-flat anyway;
    the peewee's steep toss is a hand-thrown grenade, not a cannon lay).
  - `clampElevation(elevation, kind)` is kind-aware.
  - New `ELEVATION_SLEW_RATE` table (hammer 0.5 rad/s slowest, peewee 1.6
    fastest — elevating gears deliberately trail the turret yaw slew),
    `ELEVATION_AIM_TOLERANCE` (0.05 rad), and a linear `stepElevation`
    stepper (no angle wrap).
  - `solveShotClearing` admits shell roots by mount: a high root past the
    mount is refused (falls back to flat fire into the wood, where the
    interception roll may catch it); a low root past the mount (only extreme
    up-cliff shots) is no solution — the gun holds fire. Grenades bypass the
    mount (always lob, as before).
- `apps/web/src/renderer/combatFx.ts`
  - New per-attacker `elevGoal` map: the launch path records the solution's
    elevation and returns "still traversing" until the tube is on it;
    `slewPending` cranks every pending barrel toward its goal each frame.
    On the lay the tube seats exactly (≤tolerance, invisible) before the
    live muzzle is re-read, so the exact-muzzle logic is unchanged.
  - The terrain-admission high-root lob is mount-gated too: a ridge-blocked
    gun whose only clearing root is past the mount holds fire and reports
    the obstruction (reposition request) instead of mortar-lobbing.
  - Barrel-less bodies (commander, legacy headless fixtures) always read
    aimed, so non-visual tests are timing-identical.
- `README.md`: the "near-vertical barrels" clause now states the mount
  doctrine (flat fire into canopy, hold-fire on ridges, rate-limited lays).

## Decisions

- 70° for the hammer: splits the real SPG band (PzH 2000 +65°, M109 +75°)
  with margin over the steepest plausible doctrine shot (~67° up an extreme
  cliff), while rejecting every near-vertical high root at doctrine ranges
  (the 400-unit lob needs ~84°).
- No barrel restore-to-rest: out of scope — tubes hold their last lay, as
  before; only the path onto the lay is now rate-limited.
- Close-range canopy/ridge lobs are gone by physics, not by special case:
  a short-range high arc is inherently near-vertical, so any honest mount
  cap refuses it. The lob machinery stays for within-mount solutions.

## Test notes

- Rewrote the two lob tests to the new doctrine (flat fire into genuinely
  blocking canopy; hold-fire + obstruction on a genuinely blocking ridge)
  and added a no-snap test (per-tick barrel motion ≤ one slew step, first
  round waits out the visible crank). Fixed the legacy flat-fire loop,
  which early-exited on a cranking barrel before any shot left.
- Pre-existing HEAD state: `combatFx.test.ts` was already red at the base
  commit — both lob tests (their obstacles sat ~100 units under the real
  line of fire: seated hulls ride at y≈200, the ridge crest was 170 and the
  crown top ~131) plus `dead hulls stop firing and stop drawing fire`
  (barrel-less fixture, untouched by this change — still red, out of scope).
  The rewritten fixtures were re-seated onto the measured arc (crown center
  y≈226, ridge crest 260 over a 200 base).
- Core: 510/510 pass. Web: 538/539 pass (only the pre-existing failure).
  `yarn typecheck` clean in both packages (core rebuilt so web picks up the
  new exports).
