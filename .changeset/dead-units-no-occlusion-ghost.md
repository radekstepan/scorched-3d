---
"@scorched-3d/web": patch
---

Dead units no longer show the blue occlusion outline when hidden behind terrain or trees: only live units draw the x-ray silhouette ghost, matching the health-bar policy.

## Task writeup (moved from docs/tasks/80-no-dead-occlusion-ghost.md)

# Task 80 — No occlusion x-ray ghost for dead units

## What changed and why

Killed units keep a present (smouldering/sinking) husk on the field until
full decay, and the occlusion x-ray (tasks 44/45) treated "wreck state never
gates the signal" as policy — so a dead husk behind a ridge or canopy kept
drawing its blue silhouette outline. Dead units need no locating: the ghost
was visual noise on corpses the player can no longer command.

`OcclusionFx.update` (`apps/web/src/renderer/occlusionFx.ts`) now hides the
ghost for any destroyed index (`health.isDestroyedAt(i)`), in addition to
the existing fully-decayed (`isHuskGoneAt`) gate. Only live units ghost.
This matches the health-bar policy (`healthBars.ts` already skips destroyed
indices) and leaves the sampling math, silhouette mirror, layering, and
selection rings untouched — scope is the occlusion-outline pass only.

## Files

- `apps/web/src/renderer/occlusionFx.ts` — `update` gates on
  `isDestroyedAt`; doc comment updated to the live-only policy.
- `apps/web/src/renderer/occlusionFx.test.ts` — rewrote the
  wreck-ghosting test: alive-behind-ridge ghosts on, destroyed-but-present
  husks and fully-gone husks stay hidden.
- `docs/architecture.md` — `occlusionFx.ts` row: "live units only (dead
  husks never ghost)".
- `.changeset/dead-units-no-occlusion-ghost.md` (patch, web only).

## README

Not updated — renderer-only bugfix, no architecture or player-facing
feature change.

## Test evidence

- `yarn test` — all pass (web 387 tests, incl. rewritten occlusion ghost
  policy test).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — succeeds (renderer touched).
- Playwright not run (per task rules).
