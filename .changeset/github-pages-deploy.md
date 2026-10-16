---
"@scorched-3d/web": patch
---

Publish the web app to GitHub Pages: pushes to main now build and deploy the single-file bundle via the official Pages Actions, with no publishing branch to maintain.

## Task writeup (moved from docs/tasks/133-github-pages-deploy.md)

# 133 — GitHub Pages deploy from main

Publishes the web app (for free) on GitHub Pages with no new branches,
so Netlify is not needed.

## What changed

- New workflow `.github/workflows/deploy-pages.yml`: on every push to
  `main` (plus manual `workflow_dispatch`) it installs with
  `yarn install --immutable`, runs `yarn build`, uploads `apps/web/dist`
  via `actions/upload-pages-artifact`, and deploys via
  `actions/deploy-pages`. The workflow only needs the standard Pages
  permissions (`pages: write`, `id-token: write`).
- `apps/web/vite.config.ts` now sets `base: "./"` so the bundle also
  works when served from a project subpath
  (`https://<owner>.github.io/<repo>/`). The build is already a single
  inlined HTML file with no `public/` assets, so the subpath just works.
- New test `apps/web/src/deployPages.test.ts` pins the contract: push to
  `main` trigger, no `gh-pages`/branch-push machinery, required token
  permissions, immutable install + build steps, dist artifact upload,
  `deploy-pages` deploy job, and the relative Vite base.
- README gained a short "Deploy" section with the one-time Pages setup.

## Decisions

- GitHub Actions source instead of branch-based publishing: with Pages
  set to "GitHub Actions", no `gh-pages` (or any other) branch is ever
  created — deploys happen straight from `main`, per the task.
- Task says "master" but the repo's default branch is `main`; the
  workflow triggers on `main`. (Unrelated: `.changeset/config.json`
  still says `baseBranch: "master"` — pre-existing, left untouched.)
- No remote is configured in this checkout, so the live Pages URL can't
  be verified here; the one-time step is Settings → Pages → Source:
  "GitHub Actions" once the repo is on GitHub.

## Verification

- `yarn test` (web + core suites, incl. the new deploy test) passes.
- `yarn typecheck` passes; `yarn build` produces `apps/web/dist`.
