# Task 101 — Hover hot loop

Hovering (or just parking) the cursor over the canvas dropped the frame rate
from ~120 fps to ~70 fps. Two hot loops in the render tick fed it: a
full-mesh raycast against the 320×256 terrain (~163k triangles, no BVH) every
frame while the pointer was over the canvas, plus a React `setHover` → full
App re-render on every one of those frames — even with the cursor parked.

## What changed

- `apps/web/src/renderer/hoverProbe.ts` (new) — pure, three-free hover gate
  (`createHoverGate`) plus a stable cell key (`hoverInfoKey`), mirroring the
  `fps.ts` / `minimap.ts` testability pattern:
  - `move` records the latest client coords and dirties the probe (last move
    wins, so any number of pointermoves between ticks collapse into one
    raycast); non-finite positions are ignored.
  - `takeProbe` returns the pending point once, then goes quiet until the
    pointer moves again or `cameraMoved` fires — a parked cursor costs zero
    raycasts.
  - The key is `cellX,cellZ` (every displayed probe field derives from the
    sampled cell), so the tick skips `onHover` entirely when the cell is
    unchanged — React re-renders only when the readout actually changes.
- `apps/web/src/renderer/TerrainCanvas.tsx` — the tick probes through the
  gate: at most one raycast per frame, only when dirty, with one
  `getBoundingClientRect` per consumed probe. The `pointermove` handler no
  longer reads layout or touches the raycaster (the drag-box overlay keeps
  its own wrap-rect read mid-gesture only). Camera motion under a parked
  cursor re-dirties the gate via an OrbitControls `change` listener (fires
  only while the camera actually moves) plus explicit marks after keyboard
  pan, minimap jump, and exaggeration re-snap. `pointerleave` clears without
  a redundant `setState(null)` when no cell was showing. Listener added and
  removed in effect setup/teardown.
- `apps/web/src/App.tsx` — minimap overlays (`minimapDots`, `minimapHq`,
  `minimapHoverChip`) are `useMemo`'d on their own inputs, so the remaining
  probe-cell updates keep referential identity and React bails out of those
  subtrees instead of reconciling dozens of spans per hover change.
- `.changeset/hot-loop-hover.md` (new) — patch changeset for web.

## Decisions

- **Event-driven dirty flag, not time throttle.** Probing only on
  pointer/camera motion is exact (no staleness window to tune) and the
  parked-cursor case — the worst offender at 120 raycasts/sec doing nothing —
  goes to zero. Behavior is identical: same cell under the cursor still
  yields the same readout, just without re-emitting it.
- **Dedupe on cell, not on full object.** Same-cell frames previously built
  a fresh `HoverInfo` and re-rendered App for an identical readout; the key
  makes that a no-op while cell transitions still update immediately (no
  added latency while sweeping).
- **No BVH / math raycast rewrite.** The single on-demand raycast per
  pointer motion is the same code path as before; the win comes from not
  running it 120×/sec. Kept the change small and behavior-identical.
- **No deterministic wall-clock FPS test** (headless can't measure frames);
  tests pin the hot-loop guards instead — coalescing, parked silence,
  single-emission dedupe — per the task brief.

## Test evidence

- New `hoverProbe.test.ts` — 18 tests pass: gate coalescing (3 moves → 1
  probe, last wins, consumed after), 120 parked ticks probe nothing,
  leave/re-arm, non-finite guard, `cameraMoved` silent without a pointer and
  re-probing a parked cursor at its stored position, key equality across
  sub-cell positions vs inequality across cells, 120 same-cell frames
  emitting once, plus source-wiring pins (gate in the tick, no canvas rect
  read in the hover handler, controls change listener added/removed,
  leave dedupe, memoized minimap overlays).
- Full web suite: 478/479 pass; the single failure
  (`combatFx.test.ts` > "dead hulls stop firing and stop drawing fire") is
  pre-existing — verified failing on the clean tree via `git stash`, same
  failure documented in task 99.
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).

README untouched: no workflow or visual change, purely fewer wasted frames.
