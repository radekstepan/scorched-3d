# Task 56 — Cannon vs tree-trunk collision

A traversing turret sweeps its 14–32-unit gun tube far outside the
hull-flank trunk keepout (11–14), so a hull standing clear of the wood could
still rest its cannon straight through a bole. The tube is now part of the
vehicle for collision purposes (the task's bounding-box hint: hull
footprint + gun tube = full size), and contact resolves the hull-crush way —
the wood falls, never the barrel.

## What changed

- Core (`packages/core/src/units/combat.ts`): `BARREL_MOUNT` per tank kind
  (pivot height/offset + tube length, matching the web `units.ts` build
  poses), `BARREL_TUBE_RADIUS` 2, pure `barrelSegment()` (hull anchor + hull
  yaw + turret-relative yaw + elevation → pivot→tip world segment, null for
  the tube-less commander), `barrelTouchesTrunk()` (XZ approach within
  trunk + tube radius while tube height overlaps the 0–20 bole), and
  `trunksOnBarrel()` (ascending fid list, empty on open ground).
  Crowns are ignored (brushing leaves reads fine; a tube through a bole
  does not), as is felled wood (no bole left). A lobbed barrel climbing
  over the bole clears honestly via the height-at-closest-approach test.
- Renderer (`apps/web/src/renderer/combatFx.ts`): `CombatFx.update` runs a
  `crushBarrels()` pass after `slewPending` and before the firing solution —
  every live tube is tested against live stands each tick and contacted
  trunks fell through a new `CombatEnv.fellTree` hook, so the muzzle can
  never start inside wood it just entered. Wrecks (popped/slumped turrets)
  never fell; without stands or the hook it is a no-op.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): `fellTree` fells via
  the existing `crushTree` + `poseTree` + fallen-set + `dirtyStands` path —
  the same fell/pose/decay pipeline as hull crush and blasts, so view
  blocking, round blocking, and decay all agree. `README.md` one-liner.

## Important decisions

- **Fell, don't block.** Gating turret traverse on wood would silence guns
  in forests (a tube aimed through a trunk could never fire) and needs
  escape logic for poses that start clipped. Felling keeps traverse and
  fire untouched, mirrors the task-30 hull-crush precedent
  ("detour when possible, crush when necessary" — a turret cannot detour,
  it must point at its target), and reuses the proven fell-don't-remove
  pattern. Cost: woods near parked guns thin as turrets track — same as
  crushed lanes.
- **Trunk-only contact.** Crown spheres are excluded on purpose (task-42
  volumes stay projectile-only); only bole contact fells.
- **No drive changes.** Hull crush already handles hull steps; the
  barrel-crush pass covers the tube overhang stationary or moving, so
  `movement.ts` is untouched.
- **Commander untouched.** No tube — its torso turns inside the hull
  keepout, already covered.

## Verification

`yarn build`, `yarn typecheck`, `yarn test`: 347 core + 301 web pass,
including new `combat.test.ts` barrel cases (segment geometry, yaw +
elevation shaping, commander null, bole radius edge 5-hit/7-miss, felled
ignored, crown ignored, lob-clears vs flat-clips, ascending order) and new
`combatFx.test.ts` barrel-crush cases (parked tube fells the bole it rests
in, open ground / felled wood / canopy-only untouched, commander never
fells). Playwright not run (per task rules).
