# Changesets

This folder manages the app's overall version with
[changesets](https://github.com/changesets/changesets).

Both workspaces (`@scorched-3d/core`, `@scorched-3d/web`) are in one
`fixed` group, so they always share a single version — the version shown in
the app shell (see `APP_VERSION` in
`packages/core/src/branding.ts`). Every package here is `private`, so
`privatePackages.version` is on (versions move) while `tag` stays off (no git
tags per release).

Workflow:

1. `yarn changeset` — describe a user-facing change (writes a markdown file
   in this folder; pick a bump: patch, minor, or major).
2. `yarn version-packages` — consume pending changesets, bump the two
   workspace versions in lockstep, and rewrite `APP_VERSION` to match.
3. Review the diff, then commit it.

The root `package.json` stays at `0.0.0`: changesets only versions the
workspaces. Run `yarn install` once with network access to fetch
`@changesets/cli` (added to the root `devDependencies`).
