---
"@scorched-3d/web": patch
---

Unit Folio now opens on the Commander, and the little ↗ arrow is gone from the roster.

## Task writeup

The folio opened on the Stump with a decorative ↗ arrow on every roster row. It now opens on the Commander (the lead design, first in `UNIT_KINDS` order), and the arrow markup is removed.

## What changed

- Web (`apps/web/src/folio/UnitFolio.tsx`): folio `kind` state defaults to `"commander"` instead of `"stump"`; removed the `<span aria-hidden="true">↗</span>` from each roster button.
- Web (`apps/web/src/index.css`): removed the `.folio-unit-list button > span:last-child` accent rule — with the arrow gone that selector would have caught the unit-name span, pushing it right and tinting it accent green.
- Web (`apps/web/src/index.css`): dropped the same selector from the ≤600px responsive hide-list — there it would have hidden the unit name on narrow screens, leaving icon-only rows and contradicting the `strong { font-size: 16px }` rule directly below it.
- Tests (`apps/web/src/folio/UnitFolio.test.ts`): new case pins the Commander default, asserts no ↗/`aria-hidden` remains in the folio source, and asserts the stale `:last-child` selector is gone from the stylesheet (covers both occurrences).

## Important decisions

- **Nanolathe checked, no inspiration applicable.** The sibling repo has no unit-catalog/folio equivalent (only incidental word matches for "catalog"), so there was nothing to mirror; the change follows the folio's existing conventions.
- **No README update.** This is a small presentational default change, not an architecture or feature change.

## Verification

- Folio suite: 44/44 pass (UnitFolio 6, incl. the new case).
- Full web suite: 1116 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated (also noted in an earlier changeset). Typecheck clean. Playwright not run (per task rules).
