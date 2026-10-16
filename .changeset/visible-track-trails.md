---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Vehicle track trails are more visible: higher peak opacity, wider treads, slightly longer quads, and longer-lived marks so driven lanes read as a dust ribbon — while staying below scorch in opacity, lift, and draw order, with emission spacing and pool caps unchanged.

## Task writeup (moved from docs/tasks/58-visible-tracks.md)

# Task 58 — More visible track trails

Patrol lanes read too faintly: at the task-50 tune (0.26 peak, 9 s life,
9–11 u treads) a driven lane dissolved into the dirt at a glance. Driving
hulls now stamp a clearly readable dust ribbon — higher peak opacity, wider
treads, slightly longer quads, longer-lived marks — while a blast scar still
wins everywhere the two overlap, and the pool/emission budget is untouched.

## What changed

- Renderer `tracks.ts`: visibility tune only, no structural change.
  - `TRACK_PEAK_OPACITY` 0.26 → 0.42 (readable, still well under scorch's
    0.62).
  - `TRACK_LIFETIME` 9 → 12 (lanes persist a third longer).
  - `TRACK_LENGTH` 20 → 22 (quads overlap the 16 u spacing by more, so lanes
    link up instead of dotting).
  - `TRACK_WIDTH` up ~2 u per kind (flash 9→11, stump 11→13, hammer 10→12,
    commander 4.5→6 — tanks tread, the walker still just scuffs).
  - Untouched: `TRACK_SPACING` 16, `MAX_TRACKS` 160, `TRACK_LIFT` 0.8,
    `renderOrder` 1, `polygonOffset -1`, `TRACK_COLOR`, the mover-state
    emission gate, first-sighting anchoring, oldest-recycle pooling.
- `tracks.test.ts`: the fade test now pins the visible-but-under-scorch band
  (peak > 0.3, < scorch 0.62; lift < scorch 1.2), plus a new suite asserting
  the tune (12 s lifetime, length > spacing, wider stump treads) and the
  ordering (every pooled mesh at `renderOrder` 1, quad scale = tread width ×
  length, opacity within the peak).
- `README.md`: patrol phrase drops "faint" — the trails no longer are.

## Important decisions

- **Tune, don't redesign.** The task-50 architecture (pooled quads, mover
  gate, fade envelope, caps) already works; only the four visibility
  constants move. Spacing and the 160 cap stay put, so the per-tick emission
  rate and the pool budget are bit-identical to before.
- **Headroom check against scorch, not vibes.** Every raised value keeps a
  margin below its scorch counterpart: opacity 0.42 < 0.62, lift 0.8 < 1.2,
  order 1 < 2, offset −1 above −2. The tests pin all four so a future tune
  can't silently promote tracks over scars.
- **Longer life over denser stamping.** Widening the spacing would thin lanes;
  tightening it would raise pool pressure under the longer lifetime. Keeping
  16 u with 22 u quads links the ribbon with zero extra marks.

## Verification

- `yarn test` — updated fade-band assertions + new wider/longer/under-scorch
  suite (lifetime, overlap, tread widths, renderOrder, quad scale, opacity);
  304 web tests pass.
- `yarn typecheck`, `yarn build`.
- Playwright not run (per task rules).
