---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Rebuilt the HQ warning beacon so the red light reads as emanating from the center and radiating outward: a clearer lens over a white-hot centered core, twin arc motes sweeping inside the glass, and a faint additive halo shell breathing past the lens — no more flat red disc pasted on top.

## Task writeup

# Task 137 — HQ beacon reads as centered light radiating outward

The HQ warning beacon read as a flat red circle sitting on top of the
light: the lens was a fairly opaque (0.55), hot-emissive (2.2)
hemisphere, and the bulb + PointLight orbited off-center inside it, so
from the usual camera angle the dome's silhouette was all you saw.

## What changed (web only — no core change)

- `hq.ts` (`buildHq`): the lens is now clear glass (opacity 0.3,
  level-1 emissive 1.2) over a white-hot core (`hq-beacon-bulb`) and the
  wash PointLight, both seated on the dome's center axis. Twin arc motes
  (`hq-beacon-mote-a/b`) ride the existing rotor at `HQ_BEACON_ORBIT`
  as the visible sweep inside the glass, and a faint additive halo shell
  (`hq-beacon-halo`, `HQ_BEACON_HALO_SCALE` 1.7× the lens) radiates past
  it — MeshBasicMaterial + AdditiveBlending + no depth write, per the
  combat/fire glow convention.
- `hq.ts` (drivers): new `hqBeaconPulseAt` pure phase (smooth 0..1
  cosine swell over `HQ_BEACON_PERIOD`, in time with the rotor) and
  `setHqBeaconPulse`, which breathes the stack around the stored level:
  the core swells, brightens, and bobs (`HQ_BEACON_BOB`) on the axis
  while the halo swells and brightens outward. `setHqBeaconLevel` keeps
  its exact level contract (lens + motes + light) and now also parks
  the core/halo; wrecks kill lens, core, motes, halo, and light, and
  never re-light.
- `hqFx.ts`: the tick drives `setHqBeaconPulse` from the shared clock
  alongside the existing angle write, so both forts sweep and breathe
  in sync.

## Decisions

- The wash PointLight deliberately does NOT pulse: it stays exactly
  level-driven, so the works never sit in a blink dark half and every
  existing intensity pin holds. The visible breath lives in the core,
  motes, and halo — the things the complaint was about.
- The rotor keeps spinning (same API, same sync test): it now carries
  the arc motes instead of the bulb, so the interior motion reads
  through the clearer lens while the light source itself stays centered.
- The factory-Lambert test exempts the halo like the team ring: it is a
  light effect in the codebase's glow material, not a factory surface.

## Verification

- `yarn test`: 574 core + 635 web tests pass (29 across the two HQ
  files, including 3 new: pulse purity, core+halo breath with steady
  wash, and HqFx sync breath). No browser automation per task scope.
- `yarn typecheck`: all 3 tasks pass. `yarn build`: succeeds.
