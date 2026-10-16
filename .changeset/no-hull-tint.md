---
"@scorched-3d/web": patch
---

Selected units no longer tint blue: the hull keeps its normal paint (including battle-damage charring) and selection reads from the white/cyan ring + beacon and minimap dot alone.

## Task writeup (moved from docs/tasks/43-no-hull-tint.md)

# Task 43 — Selection without the hull tint (ring/beacon-only highlight)

## What changed and why

Task 16 gave selected units a three-part signal: white-halo + cyan-core
double ground ring, spinning/bobbing chevron beacon, and a subtle hull
emissive lift (`SELECTION_BODY_GLOW = 0x0a3540` cyan-black on Lambert
bodies). The lift was meant as a backup cue for when the ring hides behind a
trunk — but it tinted the hull itself blue, painting over the unit's normal
paint (including progressive damage charring from `applyUnitDamageTint`) and
reading as "this unit IS blue" rather than "this unit is SELECTED".

This task removes the hull tint entirely:

- `setBodyHighlight` (`apps/web/src/renderer/selectionFx.ts`) is now an
  intentional no-op: highlight is conveyed by the ring/beacon marker (plus
  the minimap dot) only. It is kept as a named function so call sites and
  tests pin the no-tint policy instead of drifting back to emissive tricks.
- `SELECTION_BODY_GLOW` is deleted (no remaining references).
- `TerrainCanvas.applySelection` no longer calls `setBodyHighlight` — it
  toggles marker visibility only. The wreck filter
  (`next.filter((i) => !combat.isDestroyedAt(i))`) and the
  kill-drops-selection hook are untouched: dead husks stay unselectable.
- Marker `userData.noHighlight` tags are kept: they now document that damage
  charring skips markers, so the selection furniture never chars with the
  hull.

## Contrast / accessibility (preserved, not re-argued)

The rings, beacon, layering, and minimap policy are byte-for-byte unchanged,
so the task-16 contrast numbers still hold: white halo ≥ 4.5:1 on darkest
scorch/grass/water, cyan core ≥ 4.5:1 on darkest+lightest scorch, cyan 164°
hue-opposite ember orange, `depthTest: false` compositing at render order
10/11/12 above scorch (2). Removing the emissive lift cannot reduce
readability — the two surviving legs (ground ring for plan view, beacon for
glancing angles/occlusion) were already the load-bearing ones, and hull
paint staying put actually helps: a charred hull under a cyan ring reads as
"damaged AND selected" instead of two signals fighting in one material.

## HUD legend

One Units-panel sentence updated (`App.tsx`): "Selected units carry a
white/cyan ring + beacon; hulls keep their normal paint — selection never
tints the hull."

## Nanolathe inspiration

None — same finding as task 16 (headless/replay tooling, no 3D selection
visuals to borrow). Removal follows local constraints: Lambert hulls carry
damage state in `color`, so any emissive highlight fights charring in the
same material.

## Files

- `apps/web/src/renderer/selectionFx.ts` — `SELECTION_BODY_GLOW` removed,
  `setBodyHighlight` → documented no-op, header + marker comments updated.
- `apps/web/src/renderer/TerrainCanvas.tsx` — highlight call dropped,
  selection comment rewritten (ring/beacon-only, wreck filter preserved).
- `apps/web/src/renderer/selectionFx.test.ts` — "hull emissive lift" case
  replaced with "hull paint preserved" cases: highlight touches neither
  color nor emissive on pristine or charred hulls (charring via
  `applyUnitDamageTint` still applies), markers keep `noHighlight` tags.
- `apps/web/src/App.tsx` — Units-panel legend sentence.
- `docs/architecture.md` — selectionFx.ts key-file row ("hull highlight" →
  "ring/beacon-only highlight").
- `.changeset/no-hull-tint.md` (patch).

## Test evidence

- `yarn test` — all pass (selectionFx 14 tests, incl. 2 new no-tint cases).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — single-file bundle builds (renderer touched).
- Playwright not run (per task rules).
