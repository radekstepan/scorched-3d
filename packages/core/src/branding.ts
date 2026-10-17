/** User-visible product identity for the app shell and dialogs. */
export const APP_NAME = "Scorched 3D";

/**
 * Last released app version. The web shell derives its current build version
 * from the Changesets release plan, including pending changes.
 *
 * Single source of truth is the workspace package.json versions, kept in
 * lockstep by the changesets `fixed` group in `.changeset/config.json`;
 * this mirrors them and `branding.test.ts` fails if they drift. The
 * `version-packages` root script rewrites this line automatically via
 * `scripts/sync-app-version.mjs` after `changeset version` runs.
 */
export const APP_VERSION = "0.1.0";

export const APP_TAGLINE = "Turn-based artillery tactics on deformable terrain.";

/** Browser tab title for the web app. Derived so it cannot drift from APP_NAME. */
export const APP_DOCUMENT_TITLE = `${APP_NAME} · Terrain`;

export const APP_DESCRIPTION =
  "A browser remake of the classic Scorched Earth artillery game. " +
  "Generate an island, aim across the terrain, and outlast your opponents.";
