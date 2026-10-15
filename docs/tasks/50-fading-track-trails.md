# Task 50 — Fading track trails

Vehicles used to glide over the terrain without leaving a trace: a patrol
lane read the same as untouched ground. Driving hulls now stamp a subtle
compressed-dust trail behind themselves — small flat quads dropped at fixed
travel intervals that fade to nothing over seconds and recycle, so a lane
reads as a faint dotted ribbon, never as scorch.

## What changed

- Renderer `tracks.ts` (new): a framework-free trail model plus a pooled view.
  - Pure helpers: `TRACK_LIFETIME = 9` (seconds per mark),
    `TRACK_SPACING = 16` (travel distance between marks),
    `MAX_TRACKS = 160` (bounded pool, oldest recycled first),
    `TRACK_PEAK_OPACITY = 0.26` with cool dark-grey `TRACK_COLOR`
    (compressed dust, never scorch-brown, never opaque).
  - `trackWidthFor(kind)` — per-kind tread width (stump 11, hammer 10,
    flash 9, commander 4.5: tanks wider, the walker just scuffs).
  - `trackAlpha(age)` — linear fade to zero at the lifetime.
  - `isDriving(mover, destroyed)` — the emission gate: stunned, held, or
    wreck-held movers never stamp.
  - `TrackTrails` — pooled flat quads (shared geometry, one material per
    slot, `polygonOffset -1`, `renderOrder 1` under the scorch layer at 2).
    `update(source, dt)` polls each hull's mover once per tick (first
    sighting anchors without stamping, so spawns never burst), drops a
    yaw-aligned mark past the spacing, and ages live marks toward expiry.
    `resnap()` re-seats heights on exaggeration change (X/Z never move),
    `dispose()` drops every pooled mesh.
- Renderer `movement.ts`: a `unitCount` getter so the trails (like the
  waypoint overlay) can poll the roster size with no adapter allocation.
- `TerrainCanvas.tsx`: owns one `TrackTrails` — `update(movement, dt)` after
  `movement.update`, `resnap()` with the terrain, `dispose()` with the
  canvas.
- `README.md`: patrol phrase notes the faint fading trails.

## Important decisions

- **Gate on mover state, not displacement.** Stunned hulls can still be
  jostled by separation shoves, so a distance check alone would stamp while
  held. The gate reads `stun` / `hold` / wreck flags — held hulls are
  silent even when the crowd shoves them.
- **Patrol lanes trail too.** "Only while actually driving" means the mover
  is under power, not that a player ordered it: seeded patrols stamp,
  arrived/held hulls don't. Idle breathing (zero travel) never
  accumulates spacing, so it stays silent for free.
- **Pooled quads, not instancing.** Per-mark fade needs per-mark opacity,
  which instanced color can't carry without a custom shader; 160 pooled
  meshes with one shared geometry is cheap, bounded, and fades exactly.
- **Below scorch in every sense.** Lift 0.8 (under scorch's 1.2),
  renderOrder 1 (under scorch's 2), opacity 0.26 (under scorch's 0.62) —
  a blast scar always wins where they overlap.
- **Never touches simulation.** Trails read mover snapshots and write only
  their own meshes; separation, pathing, and drive never see a mark.

## Verification

- `yarn test` — new `tracks.test.ts` suite (fade envelope + subtle peak,
  per-kind widths, driving gate, emission + ground seating, stun/wreck/hold
  silence with drive resumption, lifetime expiry, oldest-recycle cap,
  resnap heights, dispose clearing, mover-state untouched).
- `yarn typecheck`, `yarn build`.
- Playwright not run (per task rules).