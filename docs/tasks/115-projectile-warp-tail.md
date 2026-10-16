# Task 115 — Projectile warp tail

Every round in flight now drags a tapered, more transparent "warp" tail
behind its head along the flight line. The tail is posed from the
instantaneous speed every tick, so fast flat bolts streak long and bright,
slow lobbed shells trail short and faint, and a shell's tail visibly
breathes along its arc — shrinking toward the apex as gravity bleeds its
speed, stretching again on the descent.

## What changed

- `apps/web/src/renderer/combatFx.ts`
  - New pure helpers (glow-falloff pattern): `projectileTailLength(speed)`
    (0.06 s of flight, clamped to `PROJECTILE_TAIL_MIN/MAX` = 12–90 world
    units — a flash bolt streaks 78, a hammer shell 31.2) and
    `projectileTailOpacity(speed)` (weak speed scaling inside
    `PROJECTILE_TAIL_OPACITY_MIN/MAX` = 0.18–0.42, always well under the
    opaque head). Gravity enters through the instantaneous speed: shells
    slow toward the apex and re-accelerate on the descent, bolts hold
    steady. Degenerate speeds (0/negative/NaN) read the minimums.
  - New shared `tailGeo` (`makeWarpTailGeometry`): a unit cone with its
    wide base at the local origin and tip at −Z, so `scale.z` stretches it
    behind the head. One cone per shot, parented to the head mesh at the
    local origin with no local rotation — position/orientation inherit the
    head's velocity `lookAt` for free; only stretch + opacity re-pose per
    tick in `advanceShots`. Per-shot additive material in the weapon tint
    (`transparent`, `AdditiveBlending`, no `depthWrite`, like the muzzle
    halos), disposed with the round.
  - `Shot` gains `tail`/`tailMat`; launch poses the tail from the muzzle
    speed so the first tick already reads. New `removeShotVisuals` funnels
    all four removal paths (tree stick, terrain hit, arrival, `clearTransients`)
    — head leaves the scene (child tail goes with it), both materials
    dispose, shared geos stay. `dispose` drops `tailGeo`. New test accessor
    `shotTailAt(i)` (length + opacity, null when absent).
  - Class doc's nanolathe bullet now notes the tail (head→tail beam-stroke
    read, adapted from 2D line strokes to a 3D additive cone).
- `apps/web/src/renderer/combatFx.test.ts` — new `CombatFx projectile warp
  tail` block (5 tests): pure length/opacity clamps + monotonicity, shell
  breathing vs bolt steadiness pinned through core `solveBallistic` /
  `solveDirect` + `ballisticVelocity` (apex tail strictly shorter/fainter
  than muzzle, impact symmetric with muzzle), one tinted cone per live
  round parented to its head with additive faint material, per-tick
  tails==shots invariant across 600 ticks of landings/refires, and
  clear/dispose dropping tails with zero sim impact (`totalFired` frozen,
  skirmish resumes).
- Pre-existing red fixed in the same file: `dead hulls stop firing and
  stop drawing fire` failed on the base commit (verified via `git stash`:
  task 114's barrel-lay gating shifted volley timing, so the seed now kills
  with a sibling round still airborne). Diagnosed with a throwaway probe
  (round lands ~100 ticks later, `totalFired` frozen — the sim contract
  holds, only the test's "nothing airborne at kill time" assumption is
  stale). The test now drains in-flight rounds (bounded 600 ticks) before
  asserting the quiet window; both assertions keep their meaning.
- `.changeset/projectile-warp-tail.md` (minor, web only).

## Decisions

- Tail as a *child* of the head mesh, not a scene-level object: orientation
  along the (curved, for shells) flight line is then exact by construction
  with zero per-tick position/quaternion copies, and removal/disposal rides
  the existing head paths. Cost is one cone + one material per live round
  (≤ `MAX_SHOTS` = 6), no pool needed.
- Length = speed × fixed time window (not a fixed length): this is what
  makes the tail "based on velocity and gravity" — the same formula yields
  long bolt streaks, short shell trails, and apex breathing with no
  per-kind special cases.
- Cone taper (wide at the head, tip trailing) rather than a second box: it
  reads as a warp streak behind both the elongated bolt and the spherical
  shell. Opacity band peaks at 0.42 so the tail never competes with the
  head or the muzzle/explosion flashes.
- No README update: a small visual effect, not an architecture change.
