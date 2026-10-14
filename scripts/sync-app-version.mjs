// Rewrites APP_VERSION in packages/core/src/branding.ts from the workspace
// package.json versions (kept in lockstep by the changesets `fixed` group).
// Runs as the second half of the root `version-packages` script, after
// `changeset version` consumes the pending changesets.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = ["apps/web", "packages/core"];
const BRANDING = "packages/core/src/branding.ts";

const versions = new Map();
for (const workspace of WORKSPACES) {
  const pkg = JSON.parse(readFileSync(join(ROOT, workspace, "package.json"), "utf8"));
  versions.set(workspace, pkg.version);
}
const unique = new Set(versions.values());
if (unique.size !== 1) {
  console.error(
    `Workspace versions drifted: ${[...versions].map(([w, v]) => `${w}@${v}`).join(", ")}`,
  );
  process.exit(1);
}
const [version] = unique;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Refusing to sync non-semver version "${version}".`);
  process.exit(1);
}
const path = join(ROOT, BRANDING);
const source = readFileSync(path, "utf8");
const pattern = /export const APP_VERSION = "([^"]*)";/;
const match = source.match(pattern);
if (!match) {
  console.error(`No APP_VERSION declaration found in ${BRANDING}; is it missing?`);
  process.exit(1);
}
if (match[1] === version) {
  console.log(`APP_VERSION already ${version} in ${BRANDING}`);
  process.exit(0);
}
const next = source.replace(pattern, `export const APP_VERSION = "${version}";`);
writeFileSync(path, next);
console.log(`APP_VERSION synced to ${version} in ${BRANDING}`);
