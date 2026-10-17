# Development

How to extend Scorched 3D and how to verify a change. Start here after the README start steps.

## Add a map preset

1. Add a value to `MapPreset` and a `PRESET_META` entry in `packages/core/src/terrain/types.ts`.
2. Add a height-sampling branch in `sampleHeight()` in `packages/core/src/terrain/generate.ts`.
3. Cover it in `packages/core/src/terrain/generate.test.ts` (grid dimensions, determinism, byte range).
4. Add the preset to the `PRESETS` list in `apps/web/src/App.tsx` so it appears in the HUD.

## Change the visual system

The primary tokens are at the top of `apps/web/src/index.css`: `--font-display`, `--font-mono`, and the `.hud-panel` style. The terrain look itself lives in `apps/web/src/renderer/shaders.ts` (terrain/sky/water shaders) plus the tile ramps in `packages/core/src/terrain/palette.ts`.

For unit and structure modeling, follow [Art direction](art-direction.md). It defines the shared shape and material language, each reference model's role, animation contracts, rendering cost guidance and screenshot review process. Record why a design changed in its changeset; update the guide when introducing a durable extension to the theme.

## Versioning

The app has one overall version, shared by both workspaces
(`@scorched-3d/core`, `@scorched-3d/web`) through a changesets
`fixed` group in `.changeset/config.json`. The UI reads it from
`APP_VERSION` in `packages/core/src/branding.ts`.

1. `yarn changeset` — record a user-facing change as a patch, minor, or
   major bump (writes a markdown file in `.changeset/`).
2. `yarn version-packages` — consume the pending changesets, bump the two
   workspace versions in lockstep, and rewrite `APP_VERSION` to match via
   `scripts/sync-app-version.mjs`.
3. Review the diff, then commit it.

`branding.test.ts` fails if `APP_VERSION` drifts from any workspace
`package.json`, and the sync script refuses to run when the workspaces
disagree with each other. The root `package.json` stays at `0.0.0`:
changesets only versions the workspaces.

## Verification

The production build is verified with `yarn build` (Turborepo: `tsc` for the workspace packages, then Vite for the app), `yarn typecheck`, and `yarn test` (terrain pipeline, branding, and version-sync tests). A browser automation runner is not included. For a quick interactive smoke test, run `yarn build` once, then `yarn dev`, open the printed local URL, switch presets, press REGEN, toggle the view options, and hover the mesh to verify the probe readout.
