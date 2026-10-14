/** User-visible product identity for the app shell and dialogs. */
export const APP_NAME = "Scorched 3D";

/**
 * App-wide version shown in the app shell.
 *
 * Single source of truth is the workspace package.json versions, kept in
 * lockstep by the changesets `fixed` group in `.changeset/config.json`;
 * this mirrors them and `branding.test.ts` fails if they drift. The
 * `version-packages` root script rewrites this line automatically via
 * `scripts/sync-app-version.mjs` after `changeset version` runs.
 */
export const APP_VERSION = "0.1.0";

export const APP_TAGLINE = "Turn-based artillery tactics on deformable terrain.";

export const APP_DESCRIPTION =
  "A browser remake of the classic Scorched Earth artillery game. " +
  "Generate an island, aim across the terrain, and outlast your opponents.";
