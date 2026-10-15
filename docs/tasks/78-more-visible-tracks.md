# Task 78 — More visible track trails

Driving lanes still dissolved into the dirt at a glance: at the
task-58/68 tune (0.42 peak, 12 s life, 4–5 u treads, 2.5 u scout scuffs)
a driven lane read only when you looked for it. Driving hulls now stamp
a clearly readable dust ribbon — higher peak opacity, slightly darker
dust, wider treads and footsteps, longer overlapping quads, longer-lived
marks — while a blast scar still wins everywhere the two overlap, and
the pool/emission budget is untouched.

## What changed

- Renderer `tracks.ts`: visibility tune only, no structural change.
  - `TRACK_PEAK_OPACITY` 0.42 → 0.5 (readable, still well under scorch's
    0.62).
  - `TRACK_COLOR` 0x33302b → 0x2b2823 (a touch darker for contrast,
    still cool grey — never scorch-brown).
  - `TRACK_LIFETIME` 12 → 14 (lanes persist a little longer).
  - `TRACK_LENGTH` 22 → 24 (tank quads overlap the 16 u spacing by more,
    so lanes link up instead of dotting).
  - `FOOTSTEP_LENGTH` 10 → 12 (walkers read better, still shorter than
    the 16 u spacing, so footsteps stay gapped dashes).
  - `TRACK_WIDTH` up ~1 u per kind (flash 4→5, stump 5→6, hammer
    4.5→5.5, commander 3.5→4, peewee 2.5→3 — tanks tread, walkers still
    just scuff, and the scout stays narrower than any tank tread).
  - Untouched: `TRACK_SPACING` 16, `MAX_TRACKS` 320, `TRACK_LIFT` 0.8,
    `renderOrder` 1, `polygonOffset -1`, the mover-state emission gate,
    first-sighting anchoring, oldest-recycle pooling, linear fade shape,
    footprint-flush offsets, tank-pair vs walker-alternation emission.
- `tracks.test.ts`: the visibility suite pins the new tune (14 s life,
  0.5 peak under scorch, 24 u treads, 12 u gapped footsteps, absolute
  tread widths) and asserts emitted marks carry the dust color at the
  fresh peak.
- Changeset: patch for `@scorched-3d/web`.

## Important decisions

- **Tune, don't redesign.** The task-50/68 architecture (pooled quads,
  mover gate, fade envelope, footprint-matched emission, caps) already
  works; only the visibility constants move. Spacing and the 320 cap
  stay put, so the per-tick emission rate and the pool budget are
  bit-identical to before — no extra draw calls per frame.
- **Headroom check against scorch, not vibes.** Every raised value keeps
  a margin below its scorch counterpart: opacity 0.5 < 0.62, lift 0.8 <
  1.2, order 1 < 2, offset −1 above −2. The tests pin peak, color, and
  order so a future tune can't silently promote tracks over scars.
- **Keep the tread/footstep distinction legible.** Tank quads stay longer
  than the spacing (linked ribbon) while footsteps stay shorter (gapped
  dashes); widening both without touching that inequality makes walkers
  more visible without turning them into tanks.
- **No README change.** The patrol phrase ("fading twin tread trails …
  alternating gapped footsteps") describes the mechanism, which is
  unchanged — only the tune moved.

## Verification

- `yarn test` — 387 web tests pass (visibility suite pins the new tune
  + dust-color emission; fade band, footprint-flush, pair/alternation,
  silence, expiry/recycle, resnap/dispose suites untouched in behavior).
- `yarn typecheck` passes.
- Playwright not run (per task rules).
