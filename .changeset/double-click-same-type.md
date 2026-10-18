---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Double-click a unit to select every on-screen unit of the same type and faction: the gesture resolves the clicked hull through the shared hit path and replaces the selection with all live roster mates matching its kind and team that project inside the viewport right now (HUD footer documents it as DOUBLE-CLICK same type)

## Task writeup

Task: "Double clicking a particular unit will select all units of the same type and faction visible on the screen right now."

## What changed

- `selection.ts`: new pure `doubleClickSelect(anchor, roster, visible, isDestroyedAt)` helper — returns ascending indices of live roster mates matching the anchor's kind AND team that are flagged on-screen. Null/unknown/off-roster anchor selects nothing; always replaces (no additive branch).
- `viewCull.ts`: new `computeOnScreen(camera, bodies)` predicate — strict NDC-box projection test per body world origin. Deliberately stricter than `computeUnitVisibility`, whose 70-unit view sphere keeps off-screen readouts (health bar, x-ray taps) alive; a hull just past the viewport edge counts for readouts but must not join a same-type group. Bodies behind the camera project with z > 1 and read off-screen.
- `TerrainCanvas.tsx`: new `dblclick` listener (`onDoubleClick`, left button only, suspended-aware, removed on cleanup). It resolves the anchor via a new shared `resolveClickHit` helper — extracted verbatim from the duplicated single-click/right-click resolution blocks so the anchor can never disagree with what the two preceding clicks saw — then applies `doubleClickSelect` over `computeOnScreen` with `combat.isDestroyedAt` excluding wrecks.
- `App.tsx`: HUD footer gains the `DOUBLE-CLICK same type` hint.
- Tests: `doubleClickSelect` cases (kind+team gating, off-screen skip, wreck exclusion, null/unknown/short-list edges) in `selection.test.ts`; `computeOnScreen` cases (in-view/behind/beside, strictly-tighter-than-view-sphere pin, live-camera, empty) in `viewCull.test.ts`; new `App.doubleselect.test.ts` pins the canvas wiring at source level (listener hook/unhook, shared resolver, no Shift branch, suspend/button guards, footer text) per the `App.panmode.test.ts` precedent.

## Decisions

- Nanolathe parallel: community-patch `ExternQuickKey::Message` / `SelectOnlyInScreenSameTypeUnit` (`community-patch-engine.md` §4) replaces selection with on-screen same-type units. Two deliberate deviations: the match key is the double-clicked unit's own kind + team (per the task text) rather than the definitions already selected, and any faction may anchor the gesture — single clicks already select enemy hulls here, so retail's own-unit gate would be inconsistent.
- No README update: the gesture is a small input addition documented in the HUD footer, not an architecture change.
- Pre-existing failure (verified on clean HEAD, untouched by this change): `deployPages.test.ts` expects `branches: ["main"]` while the workflow targets `master`.
