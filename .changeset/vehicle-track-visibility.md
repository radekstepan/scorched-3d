---
"@scorched-3d/web": patch
---

Vehicle track trails are a bit more visible: wider treads and commander footsteps, longer tank ribbons, and a longer commander step so armor lanes read heavier than infantry dashes — with peewee scuffs, peak opacity, lifetime, dust color, emission spacing, and pool caps unchanged, and blast scars still winning everywhere the two overlap.

## Task writeup (moved from docs/tasks/85-vehicle-track-visibility.md)

# Task 85 — More visible vehicle tracks

Armor lanes still read only a touch heavier than scout dashes: at the
task-79 tune every vehicle mark shared its fade envelope with infantry,
and the commander walker stamped the exact same 13 u scuff as a peewee.
Vehicle hulls now stamp clearly heavier prints — wider treads and
commander footsteps, longer tank ribbons, a longer commander step —
while peewee scuffs stay bit-identical, a blast scar still wins
everywhere the two overlap, and the pool/emission budget is untouched.

## What changed

- Renderer `tracks.ts`: vehicle-only visibility tune, no structural change.
  - `TRACK_WIDTH` up 0.5 u per vehicle kind (flash 5.5→6, stump 6.5→7,
    hammer 6→6.5, commander 5) — the same increment as task 79, so the
    bump reads as a continuation, not a redesign. Peewee stays 3.5.
  - `TRACK_LENGTH` 26 → 28 (tracked hulls only: more quad overlap on the
    16 u spacing, so tank lanes link up harder).
  - New `COMMANDER_FOOTSTEP_LENGTH = 14`: the commander walker steps a
    touch longer than the 13 u infantry scuff, still shorter than the
    16 u spacing so its prints stay gapped dashes. `trackLengthFor`
    returns it for `commander`; peewee and future legged kinds keep
    `FOOTSTEP_LENGTH` (the `WHEEL_RADIUS` keying is preserved, so new
    walkers still read correctly without touching this file).
  - Untouched: `TRACK_PEAK_OPACITY` 0.55, `TRACK_LIFETIME` 16,
    `TRACK_COLOR`, `TRACK_SPACING` 16, `MAX_TRACKS` 320, `TRACK_LIFT`
    0.8, `renderOrder` 1, `polygonOffset -1`, the mover-state emission
    gate, first-sighting anchoring, oldest-recycle pooling, linear fade
    shape, footprint-flush offsets, tank-pair vs walker-alternation
    emission.
- `tracks.test.ts`: the visibility suite pins the new tune (28 u treads,
  14 u commander steps, 13 u peewee scuffs, absolute vehicle widths,
  peewee pinned at 3.5); a new vehicle-only suite asserts every vehicle
  width/length exceeds its task-79 value while every vehicle quad area
  (width × length) beats the scout scuff, with peewee still the
  narrowest mark on the field.
- Changeset: patch for `@scorched-3d/web`.

## Important decisions

- **Per-kind knobs, not global ones.** Raising the shared peak opacity or
  lifetime would brighten infantry too, violating the leave-peewee-alone
  brief. Widths and lengths are already per-kind, so the whole bump lands
  there and the globals stay pinned.
- **Commander steps out of the shared footstep constant.** Commander and
  peewee are both walkers under `isWalker`, so they shared
  `FOOTSTEP_LENGTH`. A dedicated commander constant splits them with one
  branch in `trackLengthFor` and keeps the fallback path identical for
  future legged kinds.
- **Headroom check against scorch, not vibes.** Opacity, lift, and order
  are untouched (still 0.55 < 0.62, 0.8 < 1.2, 1 < 2); wider treads stay
  inside their flanks (stump offset 6.5 > 0, outer edges still flush by
  construction) and the 14 u commander step stays gapped under the 16 u
  spacing.
- **No README change.** The patrol phrase describes the mechanism, which
  is unchanged — only the vehicle tune moved (same call as tasks 78/79).

## Verification

- `yarn test` — 410 web tests pass (updated visibility pins, new
  vehicle-only prominence suite; fade band, footprint-flush,
  pair/alternation, silence, expiry/recycle, resnap/dispose, and the
  peewee footprint suites untouched in behavior).
- `yarn typecheck` passes.
- `yarn build` passes (renderer changed).
- Playwright not run (per task rules).
