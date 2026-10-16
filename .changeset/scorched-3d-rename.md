---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Rename user-visible copy from Nanolathe to Scorched 3D: HUD eyebrow renders from the `APP_NAME` branding constant, the browser tab uses the new `APP_DOCUMENT_TITLE`, and package descriptions carry the adopted product name.

## Task writeup (moved from docs/tasks/02-rename-scorched-3d.md)

# 02 — Rename to Scorched 3D

Completed the rename left open by task 1: every user-visible string now says
"Scorched 3D" and the HUD derives its copy from the branding module instead of
hardcoded text.

## What changed

- **HUD eyebrow** (`apps/web/src/App.tsx`): hardcoded `NANOLATHE` label replaced
  with `{APP_NAME.toUpperCase()}` imported from `@scorched-3d/core`, so the shell
  renders `SCORCHED 3D` from the single source of truth.
- **Browser tab** (`apps/web/index.html`): title is now `Scorched 3D · Terrain`.
- **Branding** (`packages/core/src/branding.ts`): new `APP_DOCUMENT_TITLE`
  constant, derived as `` `${APP_NAME} · Terrain` `` so the tab title cannot drift
  from `APP_NAME`. `APP_NAME` itself was already `"Scorched 3D"` (set in task 1).
- **Terrain comment** (`packages/core/src/terrain/types.ts`): doc comment now reads
  "TNT-shaped terrain (Total Annihilation map format) used by the Scorched 3D map
  pipeline" — the old text credited the sibling nanolathe repo's pipeline.
- **Package descriptions** (root, `apps/web`, `packages/core` `package.json`):
  each now carries a `description` mentioning Scorched 3D.
- **Tests** (`packages/core/src/branding.test.ts`, +4): `APP_DOCUMENT_TITLE` is
  derived from `APP_NAME`; `index.html` `<title>` matches the constant; `App.tsx`
  references `APP_NAME` and contains no `nanolathe` (case-insensitive); all three
  `package.json` descriptions mention Scorched 3D.
- **Changeset:** `.changeset/scorched-3d-rename.md` (minor bump, fixed group).
- **README:** unchanged — it already said Scorched 3D; no architecture change in
  this task, so no README update was needed.

## Decisions

- **Kept package IDs (`@scorched-3d/*`) unchanged.** They already use the adopted
  name and match the photomator workspace convention (`@<repo>/<workspace>`);
  renaming them would churn imports and the changesets fixed group for no
  user-visible benefit.
- **HUD renders `APP_NAME.toUpperCase()`** rather than a second constant, keeping
  one source of truth; the existing tracking-wide display style already uppercases
  visually, so the transform only guards plain-text readers.
- **`APP_DOCUMENT_TITLE` is derived, not duplicated**, for the same reason; the
  test pins the literal `"Scorched 3D · Terrain"` value as well so an accidental
  `APP_NAME` edit fails loudly.
- **Left the `docs/tasks.md` "nanolathe" mention alone** — it refers to the actual
  sibling repo path, not this project's identity.

## Verification

- `yarn build` — core `tsc -b` + web Vite single-file bundle. Pass.
- `yarn typecheck` — 3 tasks. Pass.
- `yarn test` — 19/19 vitest tests pass (`branding` 8, `syncAppVersion` 6,
  `terrain/generate` 5). No Playwright per task rules.
