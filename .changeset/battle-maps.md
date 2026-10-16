---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Two new battle-ready worlds: River Crossing (meandering river through forest and plains, held by two ford crossings) and Dust Plains (wide flat steppe built for armor battles).

## Task writeup (moved from docs/tasks/37-battle-maps.md)

# Task — Battle-ready maps: River Crossing + Dust Plains

The Worlds panel only offered islands, a pass, and a caldera — no open
ground suited to armor battles. Two new seeded presets join the roster:
a river split by ford crossings through forest and plains, and a wide
flat steppe.

## What changed

- Core (`packages/core/src/terrain/types.ts`): `MapPreset` gains
  `rivercross` and `dustplains`, with `PRESET_META` entries — River
  Crossing / Divided Forest ("meandering river through forest and open
  plains, held by two ford crossings") and Dust Plains / Open Steppe
  ("wide flat steppe … built for armor battles").
- Core (`packages/core/src/terrain/generate.ts`): two `sampleHeight()`
  branches. Rivercross lays flat plains (sea + 15, gentle FBM) split by
  a meandering north–south channel carved 36 units below the banks
  (below sea level), with two seeded ford rows lifting the bed back to
  sea + 6 plus small levees flanking the channel. Dustplains lays a
  broad island of dry steppe (sea + 13, low swells ±8, enclosing rim
  hills) with a single small western pond. `stampFeatures()` gives
  rivercross denser woods (0.50) and dustplains sparse copses (0.63),
  and keeps rivercross ground below sea + 8 treeless so banks and
  causeways stay open maneuver ground.
- App (`apps/web/src/App.tsx`): `PRESETS` lists all six worlds.
- Tests: `battleMaps.test.ts` (new, 8 cases) pins river water fraction
  (3–30% interior), west→east `findCellPath` connectivity across seeds
  1/7/0xa11ce, treeless causeway-height cells, rivercross forest volume,
  dustplains openness (>80% walkable, <8% water), sparser copses than
  rivercross, determinism/seed-variance, and full unit rosters on dry
  land. The shared preset lists in `generate`/`place`/`movement`/
  `pathfinding` tests now cover all six presets.
- `README.md` gains a Maps section enumerating the six worlds.
- `.changeset/battle-maps.md` (new) — **minor** for core + web (two
  new user-facing worlds).

## Important decisions

- **Fords are sills wider than the carve, not just shallower water.**
  The first cut lerped the channel bed up with the channel's own
  profile and produced islands: the mid-slope lerp sat below the
  waterline, leaving a moat on each side (caught by the ASCII
  walkability dump, fixed by a `smoothstep(0.15, 0.03)` sill under the
  `smoothstep(0.085, 0.02)` carve). Test connectivity with A*, not just
  cell counts — water fraction alone would have passed the broken map.
- **Causeways sit at sea + 6, not sea + 5.** Walkability needs
  sea + 4 with margin; ±1 detail noise on a +5 sill would leave
  borderline cells flickering at the waterline across seeds.
- **Tree line above the fords.** The existing `sea + 4` feature floor
  would have planted trunks on the +6 causeways; rivercross skips
  features below `sea + 8` so crossings and banks stay clear while
  woods cluster on higher soil.
- **Two maps, not one.** The task asks for both a river crossing and
  open plains; one map cannot be both a chokepoint battle and open
  tank country.

## Verification

- `yarn build` — 3 tasks successful.
- `yarn typecheck` — 3 tasks successful.
- `yarn test` — all pass (250 core + 198 web, 8 new).
- Playwright not run (per task rules).
