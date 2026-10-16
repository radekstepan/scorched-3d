# Task — Hit recoil: splashed hulls slide away from the blast

Hit hulls used to freeze in place for the stun beat: the mover held X/Z
while the renderer-side rock played the visible jerk back, so a direct
hammer hit read as a pause, not a punch. Every splash now also recoils the
hull — the same side-biased, capped shove the renderer poses as the
transient jerk (`impactKick`) becomes gameplay displacement too, drained at
constant velocity over the existing damage-scaled beat (0.25–0.8 s), so the
unit physically slides away from the hit and resumes its drive from the new
spot. Flank hits push harder than frontal ones, heavies push further than
chips, and volleys stack under the shared 7 u cap.

## What changed

- Core `units/movement.ts`: the mover owns a `recoil` slide next to the beat.
  - `Mover.recoil?: { x, z }` — remaining knockback displacement, absent
    (not zero) when there is nothing left to slide, matching the `stun`
    convention. Dropped with the clock on expiry, and on kills.
  - `stunMover(mover, damageAdd, blast?)` takes the splash's world X/Z and
    stacks its `impactKick` shove onto the standing slide (new private
    `stackRecoil`, mirroring `accumulateImpact`'s magnitude pinning under
    `IMPACT_MAX_SHOVE`). Misses still return the mover untouched; hits
    without a blast — or a coincident overhead blast with no flank to push
    along — set the clock alone and hold through the beat exactly as before.
  - `tickStunned` drains the slide at constant velocity (fraction dt/clock
    per tick) while the hull still turns toward its frozen target, the
    order cursor stays frozen, no blocked time accrues, and the threat
    clock keeps ticking. Slides are terrain-gated like separation (full
    step, then axis slides, then absorbed), so a hull slammed against a
    cliff or the shoreline keeps the beat but loses the slide.
- Renderer `movement.ts`: `stunUnit(index, damageAdd, blastX?, blastZ?)`
  threads the blast pin through; `markDestroyed` drops the slide with the
  clock so wrecks hold forever. Recoil moves report through the existing
  `onShift` anchor, so the visual rock's base tracks the slide instead of
  snapping back over it.
- Renderer `combatFx.ts`: `onUnitStunned` now carries the blast's world X/Z
  (`damageUnits` passes the splash point); the visual nudge path is
  untouched. `TerrainCanvas.tsx` wires the pin through to `stunUnit`.
- `README.md`: one-phrase splice in the damage clause (hesitate → recoil).
- Tests: core `movement.test.ts` (7 new recoil cases — full-beat drain and
  resume, constant-velocity halves, miss/directionless hold, stack-under-cap
  plus opposing cancellation, frozen order cursor, wall absorption, diagonal
  axis degradation); web `movement.test.ts` (live recoil slide + body pose,
  miss no-op, wreck refusal); web `combatImpact.test.ts` (hook asserts the
  blast pin; kill/post-death silence kept).
- `.changeset/hit-recoil-slide.md` (new) — **patch** for core + web
  (visible battle feel; no API break).

## Important decisions

- **Slide over the beat, not a teleport.** An instant displacement would
  fight the visual snap (double jump) and read as a glitch; draining the
  shove over the existing beat keeps one timing shape, and re-hits refresh
  both under their caps exactly as the old hold did.
- **Gameplay shove equals the visual shove (1:1, shared shaping).** No new
  tuning constants: direction, side bias, and caps come from the one
  `impactKick` both systems already share, so what the eye sees as the jerk
  is what the drive slides. Peak combined offset doubles (transient + slide)
  but the transient decays onto the displaced seat, which reads as recoil
  with suspension rock rather than two kicks.
- **No new visual work.** The transient nudge already jerks away from the
  blast; this task only makes the mover follow it permanently. Track trails
  stay paused through the beat (`isDriving` still gates on `stun`) — an
  involuntary slide laying tread trails would read as driving.
- **Kept the `stun` names.** The clock now paces a recoil slide rather than
  a hold, but renaming the countdown, hook, and shapers would churn every
  call site and test for a behavior-only change; comments now say recoil
  throughout.

## Verification

- `yarn test` — all pass (core 522 incl. 7 new recoil cases; web 572 incl.
  1 new recoil case + hook pin assertions).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
