---
"@scorched-3d/web": patch
---

Footprint-matched track trails: tanks stamp twin parallel treads flush with the hull flank footprint, the commander stamps alternating gapped footsteps; fade, pool, and emission gating unchanged.

## Task writeup (moved from docs/tasks/68-footprint-track-trails.md)

# Task 68 — Footprint-matched track trails

The old trail stamped one wide quad per stride for every kind, so a tank
lane read as a single center ribbon floating between its treads and the
walker left the same linked ribbon as armor. Driving hulls now stamp
their actual footprint: tracked hulls (Flash/Stump/Hammer) drop two
parallel treads per stride — one per flank, outer edges flush with the
hull footprint — while the commander stamps small alternating footsteps
with gaps between them.

## What changed

- Renderer `tracks.ts`: footprint-matched emission, same fade/pool
  architecture.
  - `TRACK_WIDTH` is now the single-tread width (flash 4, stump 5,
    hammer 4.5, commander 3.5 — tanks tread, the walker scuffs), down
    from the old full-lane widths (11–13).
  - `trackOffsetFor(kind)` — lateral tread-center distance: tanks sit at
    `halfWid − tread/2` from `HULL_FOOTPRINT`, so each tread's outer edge
    lands flush with the flank tap the grade seating uses; the walker
    reads 0 (its alternation is strided, not gauged).
  - `trackOffsetsFor(kind, step)` — one stamp's lateral offsets:
    tanks `[-offset, +offset]` every stride, the commander a single
    footstep alternating `-FOOTSTEP_OFFSET` / `+FOOTSTEP_OFFSET`
    (even/odd strides) at the ±4 leg spread from the body build.
  - `trackLengthFor(kind)` + `FOOTSTEP_LENGTH = 10` — tank treads keep
    the 22 u linked ribbon (overlapping the 16 u spacing); footsteps
    are shorter than the spacing, so they read as dashes with gaps.
  - `TrackTrails` keeps a per-unit stride counter (roster-sized, alongside
    the anchor arrays) and stamps each stride's offsets perpendicular to
    the hull yaw (local +X: `(cos yaw, −sin yaw)`, the same frame as the
    seating taps).
  - `MAX_TRACKS` 160 → 320: each tank stride now consumes two slots, so
    the pool holds the same lane length as before. Fade envelope
    (`TRACK_LIFETIME` 12, peak 0.42), lift 0.8, renderOrder 1, and the
    mover-state emission gate are untouched.
- `tracks.test.ts`: new footprint suites (outer-edge flush with
  `HULL_FOOTPRINT`, tank pair symmetry + stride-independence, walker
  alternation + gapped length) and an emission-shape test (one tank
  stride drops exactly 2 flank marks; two walker strides drop 2 opposite
  feet); the visibility suite pins the new tune (tread pair + gapped
  footsteps, still under scorch).
- `README.md`: patrol phrase notes twin treads + walker footsteps.
- Changeset: patch for `@scorched-3d/web`.

## Important decisions

- **Derive offsets from the footprint, don't hand-tune.** The seating
  taps already define each hull's flank (`halfWid`); anchoring the outer
  tread edge there keeps trails and pose in the same frame, so a future
  footprint rebalance moves the treads with it.
- **Alternate by stride count, not by clock.** Footstep left/right comes
  from the per-unit stamp counter, so gaps stay even at any speed and a
  held hull (no stamps) never drifts its phase.
- **Double the pool, not the spacing.** Two slots per tank stride would
  halve lane persistence under the old cap; 320 slots keep the task-58
  lane length bit-identical while the per-tick emission rate per hull
  is unchanged (still one stamp per spacing travelled).
- **Never touches simulation.** Trails still read mover snapshots and
  write only their own meshes; separation, pathing, and drive never see
  a mark.

## Verification

- `vitest run` — 362 web tests pass (11 in `tracks.test.ts`: fade band,
  tread widths, footprint-flush offsets, pair/alternation shapes,
  emission + seating, stun/wreck/hold silence, expiry + recycle cap,
  resnap + dispose, visibility tune).
- `yarn typecheck`, `yarn build` (web).
- Playwright not run (per task rules).
