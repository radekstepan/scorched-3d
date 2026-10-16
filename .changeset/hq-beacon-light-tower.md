---
"@scorched-3d/web": patch
---

The HQ red beacon is a circling light tower again: twin red cones sweep the works on a slow 6-second rotor, rendered through a diffused additive shader that melts away along the beam and across the silhouette, so the sweep reads as volumeless glow with no harsh borders.

## Task writeup

# Task — HQ beacon reads as a circling diffused light tower, not a static glow

The HQ red light had become a steady halo + static point wash: correct as a
"working building" signal, but lifeless — nothing circled, nothing swept. The
request: light up the surroundings like a "light tower", with 2 circling red
cones, diffused. The catch from history: the old twin cones (removed in
`b34d5d2`) were flat-opacity additive meshes with harsh silhouette borders,
which is why they were cut. So this is not a revert — the cones come back as
a genuinely diffused effect.

## What changed (web only — no core change)

- `hq.ts` (`buildHq`): the rotor group is back (`hq-beacon-rotor` on the
  dome seat) carrying twin opposed open cones (`hq-beacon-beam-a/b`) with
  apexes at the hot core, sweeping horizontally past the lens like a
  lighthouse. The halo sprite, hot core, dome, and PointLight wash are
  unchanged in role — the cones are the visible sweep on top of them.
- `hq.ts` (beam look): each cone wears a small additive `ShaderMaterial`
  instead of flat opacity. Alpha melts two ways: an axial smoothstep along
  the cone UVs (bright at the v=1 apex, exactly 0 at the v=0 far rim, over
  a 0.35 fade span) and a silhouette fade (`|dot(N, V)|^1.5`) that dissolves
  the flanks at grazing view angles. Peak alpha 0.22, depth-write off,
  double-sided, depth-tested so chimneys correctly occlude the sweep.
- `hq.ts` (reach): beams run 60 units with a 6-unit base radius — the far
  ends clear the slab and fade out over the surroundings rather than ending
  inside the glass. The fade direction is pinned by a geometry test (apex
  verts carry v≈1, rim verts v≈0).
- `hq.ts` (API): rotor vocabulary restored — `HQ_BEACON_PERIOD` (6 s, a
  slow stately sweep rather than the old 1.4 s flicker),
  `HQ_BEACON_BEAM_LEN/RADIUS/OPACITY/FADE/EDGE`, `getHqBeaconRotor/Beams`,
  `hqBeaconAngleAt/Of`, `setHqBeaconAngle` — plus `hqBeaconBeamAxial`, a
  pure mirror of the GLSL smoothstep for headless tests. `setHqBeaconLevel`
  drives beams through a `uLevel` uniform (never the rotor angle); wrecks
  park beams at 0 + hidden and never re-light.
- `hqFx.ts`: the tick advances a shared beacon clock and circles each live
  HQ's rotor off it, with odd forts leading by half a turn so the two
  sweeps never march in lockstep. Wrecked HQs are skipped, so a dead rotor
  freezes where it died. No new real lights — still 2 no-shadow
  PointLights total; the sweep is purely the emissive cones.
- Tests (`hq.test.ts`, `hqFx.test.ts`): beacon mount suite extended for
  rotor seating, opposed cones, shader flags/uniforms, UV fade direction,
  and tower reach; new suites for the axial curve (gone rim, full core,
  soft midrange, monotonic) and the rotor-angle loop (quarter/half turns,
  wrap, bad-time parking, missing-rotor nulls); level/wreck suites now pin
  beam `uLevel` + visibility (level never steers the rotor); the HqFx sweep
  test pins both forts' clock angles + half-turn offset with steady
  halos/wash, and the wreck test pins rotor freeze + dark beams.

## Decisions

- A fresnel-style shader instead of reusing the old flat cones or a
  gradient texture: only the view-angle term dissolves the silhouette edge
  that got the old cones cut, and the axial term dissolves the far rim —
  together they are what "diffused" means here. The pure-JS axial mirror
  keeps the curve headless-testable without a GPU.
- Kept the halo + static point wash underneath: the halo is the near-field
  glow around the lens, the wash is the real light on the ground, the cones
  are the visible sweep — three layers, one signal.
- No SpotLights for the sweep: rotating real lights per beam would make the
  ground wash itself circle, but at 4 extra forward-rendered lights right
  after a perf-sweep task, the cost/benefit is wrong — the static wash
  already covers the surroundings, and the cones sell the motion.
- No arc motes (the old orbiting dots): the task asked for two diffused
  cones, and hard dots inside the glass would fight the diffusion story.
- Sibling `nanolathe` repo checked for beacon/rotor/beam inspiration — it
  is a Go lathe/CAM project with no matching rendering material, so the
  beam shader is original to this repo's glow conventions.
