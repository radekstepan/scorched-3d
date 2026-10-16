---
"@scorched-3d/web": patch
---

Rebuilt the HQ warning beacon as a soft diffused glow: the twin red light cones, rotor, and arc motes are gone, replaced by a single borderless additive halo sprite over the hot core, and the red wash light now travels farther onto the surrounding surfaces.

## Task writeup

# Task — HQ beacon reads as a diffused glow, not two cones

The HQ red light rendered as two visible cones with harsh borders (twin
additive cone meshes circling on a rotor, lighthouse-style). The request:
no cones — just a faded glow of light that reflects against the
surrounding surfaces, is diffused, and travels farther without a harsh
border.

## What changed (web only — no core change)

- `hq.ts` (`buildHq`): the rotor group, twin arc motes, and twin cone
  meshes (`hq-beacon-rotor`, `hq-beacon-mote-*`, `hq-beacon-beam-*`) are
  gone. In their place, one view-facing halo sprite (`hq-beacon-glow`)
  centered on the hot core, using a procedural radial-falloff DataTexture
  (same headless-safe approach as the day-fog banks): alpha is 1 at the
  core and exactly 0 at the rim, so the glow fades out with no edge. Dome,
  hot core, and PointLight are unchanged in role.
- `hq.ts` (light): `HQ_BEACON_DISTANCE` grows 340 → 560 while peak and
  decay stay on the combat-pool curve, so the faded red wash reaches past
  the works + hall + staging apron onto the surrounding ground. The
  renderer windows the cutoff smoothly, so the farther reach adds no hard
  border.
- `hq.ts` (API): removed the rotor vocabulary — `HQ_BEACON_PERIOD`,
  `HQ_BEACON_ORBIT`, `HQ_BEACON_BEAM_*`, `getHqBeaconRotor/Beams/Motes`,
  `hqBeaconAngleAt/Of`, `setHqBeaconAngle` — and added the halo vocabulary:
  `HQ_BEACON_GLOW_SIZE/OPACITY/TEX_SIZE`, `getHqBeaconGlow`,
  `hqBeaconGlowAlpha`, `makeHqBeaconGlowTextureData`. `setHqBeaconLevel`
  now drives lens + wash light + core + halo; wrecks still kill the whole
  stack and never re-light.
- `hqFx.ts`: the tick no longer spins a rotor phase — each live HQ just
  holds the steady level drive (night-boosted after dark). `dispose` now
  also releases halo sprite materials and their procedural textures.
- Tests (`hq.test.ts`, `hqFx.test.ts`): beacon suites rewritten for the
  halo — sprite seating/material/texture, zero cone geometry anywhere in
  the works, radial falloff shape (symmetric, monotonic, transparent
  rim/corners), level-driven halo opacity/visibility, steady burn across
  ticks with no breathing, farther wash coverage, and wreck-dark halos.

## Decisions

- A billboard sprite instead of 3D halo geometry: a sprite has no
  silhouette from any camera angle, which is exactly "diffused, no harsh
  border", and it reuses the repo's existing procedural-DataTexture idiom
  rather than adding canvas/DOM dependencies.
- Kept the burn steady (no pulse): the task asked for a faded glow, not a
  flashing one, and the previous no-breathing behavior stays intact.
- Extended reach via distance only (340 → 560), keeping peak/decay on the
  combat-pool curve: near-field brightness is unchanged, so the works does
  not blow out — the glow just fades farther.
