---
"@scorched-3d/web": patch
---

Projectile ground reflection: the glow blob under a flying round is now an oriented ellipse stretched along the head→tail flight line instead of a plain circle. Flat fast bolts streak a long reflection, steep climbs/dives stay near-circular, and a shell's blob breathes along its arc exactly like its warp tail.

## Task writeup

Task: "Can the reflection of a projectile flying against the ground match somewhat the actual projectile? Right now it's a circle."

### Root cause

`poseShotGlow` in `combatFx.ts` seated every in-flight glow blob with `blob.scale.setScalar(projectileGlowRadius(falloff))` — a uniform disc that knew nothing about the round above it, while the projectile itself is an oriented head→tail streak (elongated bolt box or shelled ball plus a speed-stretched warp tail, lookAt'd along its instantaneous velocity every tick).

### What changed (`apps/web` view only — no core change)

- `combatFx.ts`: new pure `projectileGlowFootprint(vx, vy, vz, falloff)` returning `{ yaw, width, length }` — yaw is the horizontal flight bearing (`atan2(vx, vz)`, three.js rotation.y), width is the legacy disc radius across the flight, and length adds the ground-projected warp-tail share (`projectileTailLength(speed) × flatness × SHOT_GLOW_TAIL_GAIN = 0.35`) along it. Hovering or straight-vertical flight falls back to the plain circle at yaw 0.
- `poseShotGlow` now feeds the same instantaneous `ballisticVelocity` the head mesh lookAts into the footprint and poses `blob.rotation.y` / `blob.scale.set(width, 1, length)`, so the dirt tracks the airframe every tick. Position, opacity, falloff, light pool, and pool bounds are untouched.
- New test accessors `shotVelocityAt(i)` (analytic instantaneous velocity) and `shotGlowFootprintAt(i)` (live blob yaw + across/along scale), matching the existing accessor style.

### Decisions

- Mirror the visible tail, not the head mesh: the eye reads the projectile as head + warp tail, so the blob stretches with `projectileTailLength(speed)` foreshortened by flight flatness (`horiz/speed`) — a shell's reflection breathes along its arc for free, and steep dives stay round. Width stays at the legacy radius, so the existing "small and subtle" caps still hold and no scorch-decal comparison changes.
- Gain 0.35 caps the tail share at ~31 units (≈ one disc width at full strength): the longest blob reads as a reflection of the round, not a cross-map streak. Blob stays centered under the head rather than shifted onto the head→tail midpoint — "match somewhat" asks for shape/orientation, and the centered seat keeps the light/blob registration obvious.
- Nanolathe inspiration (`internal/meshscene/battle_sprites_projectiles.go`): beams are head→tail oriented strokes with the light riding the line, and projectile shadows seat on the floor projection — adapted here as an oriented ellipse on `env.groundY` under each glowing round.

### Tests

- `combatFx.test.ts` (projectile glow block): pure footprint tests (flat bolt yaw + stretch math, diagonal bearing, steep-climb foreshortening, vertical/hover circle fallback, width-tracks-radius + length-never-undercuts sweep) and a 1200-tick integration test asserting every live blob yaws onto its round's bearing and stretches by exactly its ground-projected tail share, with at least one real bolt streaking past 1.25× circular.
- `combatFx.test.ts`: 99/99 pass. Full web suite: 688/689 — the single failure (`deployPages.test.ts`, GitHub Pages workflow) also fails on untouched HEAD, so it is pre-existing and unrelated. `yarn typecheck` clean. No Playwright, per task rules.
