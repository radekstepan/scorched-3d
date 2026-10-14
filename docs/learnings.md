# Learnings

Distilled from per-task writeups in `docs/tasks/` across the initial 3-task run. Read this before touching the monorepo layout, branding, terrain, or units so we don't repeat the same mistakes.

Task index:
- 01 — Turborepo migration (`docs/tasks/01-turborepo-migration.md`)
- 02 — Rename to Scorched 3D (`docs/tasks/02-rename-scorched-3d.md`)
- 03 — Static demo units (`docs/tasks/03-units-demo.md`)

## 1. Monorepo layout (from 01)

- **Budget for stricter shared configs.** Adopting photomator's `tsconfig.base.json` enables `noUncheckedIndexedAccess`, which surfaced ~30 latent indexing errors in moved terrain/renderer code. Fix at read sites with `??` fallbacks rather than relaxing the config — the reads are in-bounds by construction and behavior stays unchanged.
- **Core must be built before dev.** `apps/web` resolves `@scorched-3d/core` through workspace `dist/`; run `yarn build` once before `yarn dev`. Turbo's `^build` ordering only covers scripted tasks (`build`, `test`, `typecheck`), not `dev`.
- **`git mv` needs destinations pre-created.** Move files first, then write new files — otherwise rename detection gets clobbered.
- **Keep task boundaries.** Repo/scope identity (`@scorched-3d/*`, `APP_NAME` constant) belongs to the migration; user-visible copy belongs to the rename. Don't bleed one into the other.
- **Only add workspaces you need.** `apps/web` + `packages/core` is enough for a single demo shell with client-side state; `packages/ui` / `apps/server` would be dead weight. The `apps/*` + `packages/*` globs leave room to grow in photomator shape.

## 2. Branding and rename (from 02)

- **Package IDs stay.** `@scorched-3d/*` already match the adopted name and photomator's `@<repo>/<workspace>` convention; renaming them churns imports and the changesets fixed group for no user-visible benefit.
- **Derive, don't duplicate.** HUD renders `APP_NAME.toUpperCase()` and `APP_DOCUMENT_TITLE` is derived as `` `${APP_NAME} · Terrain` `` — one source of truth, with tests pinning the literal tab title so an accidental `APP_NAME` edit fails loudly.
- **Leave sibling references alone.** Remaining `nanolathe` strings are intentional: the `docs/tasks.md` sibling-repo path, historical notes in writeups, changeset descriptions, and the test's own guard regex.
- **Sync-regex is narrow.** `scripts/sync-app-version.mjs` targets only the `APP_VERSION` line, and `syncAppVersion.test.ts` fixtures use synthetic branding source — adding constants near `APP_VERSION` is safe.

## 3. Units and terrain (from 03)

- **Nanolathe unit identity is retail ids.** Canonical names live in `internal/content/compile_unit.go` (`UnitDef.UnitName` like `ARMCOM` / `ARMSTUMP`); grepping quoted `"ARM*"` ids in `*_test.go` is the fastest confirmation.
- **New RNG streams get a fresh XOR constant.** Unit placement uses `seed ^ 0x9e37`, separate from terrain/feature streams, so new content never perturbs the existing heightfield and old determinism snapshots keep holding.
- **Hook regen via `generateMap()`.** Putting derived content (`units`) directly on `TNTMap` inside `generateMap()` means preset change + REGEN re-place units with zero App wiring — the existing `useMemo(generateMap)` picks it up.
- **Surface layers share three touchpoints.** Anything sitting on terrain (trees/rocks/units) needs: build per map, re-snap on exaggeration change, dispose on unmount. A future shared "surface attachment" helper could collapse this duplication.
- **Guarantee the roster with tiers.** Strict placement invariants (dry, gentle, empty, separated) hold on most seeds, but relaxed + scoring-fallback tiers are still needed to never ship a short roster; tests assert the relaxed bounds so the fallback can't silently regress.
- **Units are gameplay, not dressing.** They stay visible when the Features toggle is off.
