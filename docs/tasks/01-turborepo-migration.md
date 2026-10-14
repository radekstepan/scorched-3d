# 01 — Turborepo migration

Migrated the single-package Vite app into a yarn v4 + Turborepo + changesets monorepo shaped like the sibling photomator repo.

## What changed

- **Root:** `package.json` is now private workspace root `scorched-3d` (`packageManager: yarn@4.9.1`, workspaces `apps/*` + `packages/*`) with `dev/build/test/typecheck/lint/changeset/version-packages/clean` scripts; added `turbo.json`, `tsconfig.base.json`, `.yarnrc.yml` (`nodeLinker: node-modules`), `.nvmrc` (24.15.0), `.gitignore`, `.changeset/` (config + README). Removed `package-lock.json` (replaced by `yarn.lock`) and the root `tsconfig.json` (replaced by per-workspace configs extending the base).
- **Split:** single `src/` divided into two workspaces —
  - `packages/core` (`@scorched-3d/core`): framework-free logic — `terrain/` (generate, noise, palette, texture, types) plus new `branding.ts` and barrel `index.ts`. Built with `tsc -b` (composite) to `dist/`, tested with vitest.
  - `apps/web` (`@scorched-3d/web`): React + Three.js shell — `App.tsx`, `main.tsx`, `index.css`, `renderer/`, `utils/cn.ts`, `index.html`, `vite.config.ts`. Imports terrain code via `@scorched-3d/core`.
- **Versioning:** changesets `fixed` group over the two workspaces; `APP_VERSION` in `packages/core/src/branding.ts` mirrors workspace versions via `scripts/sync-app-version.mjs` (2-workspace adaptation of photomator's script).
- **Strictness fixes:** the photomator base config enables `noUncheckedIndexedAccess`, which the old lax config did not. Fixed ~30 resulting errors in `terrain/*.ts` and `TerrainCanvas.tsx` with `??` fallbacks at typed-array/palette/uniform read sites. All are in-bounds by construction, so behavior is unchanged.
- **Docs:** new `README.md`, `docs/development.md` (with Versioning workflow), `docs/architecture.md`.
- **Changeset:** `.changeset/turborepo-migration.md` (minor bump).

## Decisions

- **Only `apps/web` + `packages/core`, no `packages/ui` / `apps/server`.** The app is a single demo shell with client-side generated state; a shared-component package and a library server would be dead weight. The `apps/*` + `packages/*` workspace globs already allow adding them later in photomator shape.
- **No Playwright/e2e.** Per task rules (unit/integration only); the web `test` script is a no-op so `turbo run test` stays green.
- **`APP_NAME` set to "Scorched 3D"** in the new branding module as the repo identity, but HUD copy (`NANOLATHE` label, page title) intentionally left untouched for task 2 (rename).
- **Kept photomator's turbo task graph** (`build` with `^build` deps and `dist/**` outputs; `dev` persistent/uncached) minus the `e2e` task.

## Verification

- `yarn build` — core `tsc -b` + web Vite single-file bundle (817 kB inlined `dist/index.html`). Pass.
- `yarn typecheck` — 3 tasks. Pass.
- `yarn test` — 15/15 vitest tests pass (`branding` 4, `syncAppVersion` 6, `terrain/generate` 5). No Playwright per task rules.
