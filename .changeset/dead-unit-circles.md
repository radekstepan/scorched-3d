---
"@scorched-3d/web": patch
---

Dead units no longer keep a ground circle: the team ring and selection beacon hide immediately on death while the smouldering husk itself still renders until decay, matching the health-bar policy.

## Task writeup (moved from docs/tasks/94-dead-circle.md)

# Task 94 — Dead units drop their circle immediately

## What changed and why

A killed unit kept its team ground ring (and, when selected, its selection
emphasis state) on the smouldering husk until full decay: the death path
dressed the wreck, settled the nudge, fired the epic burst, and dropped the
kill from the selection — but nothing hid the hull's one ground circle. Dead
hulls report no live state anywhere else (health bars gate on
`isDestroyedAt`, the occlusion ghost gates on it too since task 80), so the
lingering ring was the odd one out.

- `apps/web/src/renderer/units.ts` — new `hideUnitCircles(body)`: hides the
  `team-ring` mesh plus the `select-marker` beacon when attached. Idempotent,
  safe on plain test groups. Later `setTeamRingSelected` calls only retint
  the hidden mesh in place, so a stale selection update can never resurrect
  a dead ring.
- `apps/web/src/renderer/combatFx.ts` — `poseWreck` hides the circles first.
  This runs on the kill transition (not just the canvas hook), so white-box
  kills that dress via the `poseHusks` fallback lose their circles too.
- `apps/web/src/renderer/TerrainCanvas.tsx` — `onUnitKilled` also hides the
  dead body's circles (belt-and-braces for hook order) before dropping it
  from the selection. The husk body itself still renders, sinks, and decays
  exactly as before.
- `README.md` — team rings now described as circling live hulls, gone on
  wrecks.
- `.changeset/dead-unit-circles.md` (patch, web only).

## Files

- `apps/web/src/renderer/units.ts` — `hideUnitCircles` helper.
- `apps/web/src/renderer/combatFx.ts` — `poseWreck` calls it; import updated.
- `apps/web/src/renderer/TerrainCanvas.tsx` — kill hook calls it; import
  updated.
- `apps/web/src/renderer/units.test.ts` — death drops ring + beacon while the
  husk stays; stale retints never resurrect; plain-group no-op.
- `apps/web/src/renderer/combatFx.test.ts` — organic kill hides the ring +
  beacon at once while the fresh husk still renders.
- `README.md` — one-clause touch.
- `.changeset/dead-unit-circles.md` (patch), `docs/tasks/94-*.md` (this
  writeup).

## README

Updated — one clause: team rings circle live hulls and vanish on wrecks.

## Test evidence

- Targeted: `units.test.ts` + `combatFx.test.ts` circle/ring tests pass
  (6 + 1 new).
- `yarn test` — web 423/424 pass; the single failure (`combatFx.test.ts`
  > "dead hulls stop firing and stop drawing fire", `shotCount` 1 vs 0) is
  pre-existing, verified failing on unmodified main via `git stash` and
  untouched by this change.
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).
