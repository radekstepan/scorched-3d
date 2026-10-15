# Task 17 — Tanks driving sideways (fixed)

Root cause was not the steering code: core `driveToward` already turns the
hull toward the target at the kind's turn rate and then displaces the mover
along the hull forward vector `(sin(hull), cos(hull))` — travel always equals
hull yaw (locked by `movement.test.ts` "never snaps the hull"). The sideways
read came from the meshes and their seating footprints:

- Tank hull boxes in `apps/web/src/renderer/units.ts` were wider (X) than
  deep (Z, the travel axis): flash 18×13, stump 26×18, hammer 24×16. A hull
  wider than long reads as strafing even with a correct yaw.
- `HULL_FOOTPRINT` in `packages/core/src/units/terrain.ts` matched the
  sideways boxes (`halfWid > halfLen` for all three tanks), so grade
  pitch/roll leaned across the hull instead of nose/tail along it.

Fix: swapped tank hull/trim/turret boxes lengthwise (flash 13×18, stump
18×26 + 19×27 trim + 12×14 turret, hammer 16×24; turret Z offsets and barrel
pivots unchanged — they still sit inside the longer hulls with the muzzle
overhanging the nose) and swapped the footprints to `halfLen > halfWid`
(flash 10/8, stump 14/10, hammer 13/9). Commander untouched — a biped is
correctly shoulder-wide. Muzzle forward throws already cleared the new noses,
so no weapon math changed.

Tests: `terrain.test.ts` asserts tank footprints run long along travel;
`units.test.ts` asserts tank hull bounding boxes are deeper (Z) than wide
(commander asserted opposite) and that every muzzle tip throws ahead of its
hull nose in the model frame. `yarn typecheck` and `yarn test` pass
(152 core + 109 web tests).
