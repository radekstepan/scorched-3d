# Task 79 — More visible unit tracks

Driving lanes still read only when you looked for them: at the
task-78 tune (0.5 peak, 14 s life, 5–6 u treads, 4 u commander
footsteps) a driven lane dissolved into the dirt at a glance. Driving
hulls now stamp a clearly readable dust ribbon — higher peak opacity,
slightly darker dust, wider treads and footsteps, longer overlapping
quads, longer-lived marks — while a blast scar still wins everywhere
the two overlap, and the pool/emission budget is untouched.

## What changed

- Renderer `tracks.ts`: visibility tune only, no structural change.
  - `TRACK_PEAK_OPACITY` 0.5 → 0.55 (readable, still under scorch's
    0.62).
  - `TRACK_COLOR` 0x2b2823 → 0x24211c (a touch darker for contrast,
    still cool grey — never scorch-brown).
  - `TRACK_LIFETIME` 14 → 16 (lanes persist a little longer).
  - `TRACK_LENGTH` 24 → 26 (tank quads overlap the 16 u spacing by more,
    so lanes link up instead of dotting).
  - `FOOTSTEP_LENGTH` 12 → 13 (walkers read better, still shorter than
    the 16 u spacing, so footsteps stay gapped dashes).
  - `TRACK_WIDTH` up ~0.5 u per kind (flash 5→5.5, stump 6→6.5, hammer
    5.5→6, commander 4→4.5, peewee 3→3.5 — tanks tread, walkers still
    just scuff, and the scout stays narrower than any tank tread).
  - Untouched: `TRACK_SPACING` 16, `MAX_TRACKS` 320, `TRACK_LIFT` 0.8,
    `renderOrder` 1, `polygonOffset -1`, the mover-state emission gate,
    first-sighting anchoring, oldest-recycle pooling, linear fade shape,
    footprint-flush offsets, tank-pair vs walker-alternation emission.
- `tracks.test.ts`: the visibility suite pins the new tune (16 s life,
  0.55 peak under scorch, 26 u treads, 13 u gapped footsteps, absolute
  tread widths).
- Changeset: patch for `@scorched-3d/web`.

## Important decisions

- **Tune, don't redesign.** The task-50/68 architecture (pooled quads,
  mover gate, fade envelope, footprint-matched emission, caps) already
  works; only the visibility constants move. Spacing and the 320 cap
  stay put, so the per-tick emission rate and the pool budget are
  bit-identical to before — no extra draw calls per frame.
- **Headroom check against scorch, not vibes.** Every raised value keeps
  a margin below its scorch counterpart: opacity 0.55 < 0.62, lift 0.8 <
  1.2, order 1 < 2, offset −1 above −2. The tests pin peak and order so
  a future tune can't silently promote tracks over scars.
- **Keep the tread/footstep distinction legible.** Tank quads stay longer
  than the spacing (linked ribbon) while footsteps stay shorter (gapped
  dashes); widening both without touching that inequality makes walkers
  more visible without turning them into tanks.
- **No README change.** The patrol phrase describes the mechanism, which
  is unchanged — only the tune moved (same call as task 78).

## Verification

- `yarn test` — 387 web tests pass (visibility suite pins the new tune;
  fade band, footprint-flush, pair/alternation, silence, expiry/recycle,
  resnap/dispose suites untouched in behavior).
- `yarn typecheck` passes.
- `yarn build` passes (renderer changed).
- Playwright not run (per task rules).
