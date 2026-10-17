import { readFileSync } from "node:fs";
import path from "node:path";
import getReleasePlan from "@changesets/get-release-plan";
import type { Plugin } from "vite";

const WORKSPACES = ["apps/web", "packages/core"];

/** Current game build: pending Changesets release, or the last released version. */
export async function getBuildVersion(root: string): Promise<string> {
  const packages = WORKSPACES.map((dir) => JSON.parse(
    readFileSync(path.join(root, dir, "package.json"), "utf8"),
  ) as { name: string; version: string });
  if (new Set(packages.map((pkg) => pkg.version)).size !== 1) {
    throw new Error("Cannot build game: workspace versions drifted");
  }
  // Use Changesets' own fixed-group, bump and prerelease rules rather than
  // inventing a second interpretation of the release metadata.
  const plan = await getReleasePlan(root);
  const versions = packages.map((pkg) =>
    plan.releases.find((release) => release.name === pkg.name)?.newVersion ?? pkg.version,
  );
  if (new Set(versions).size !== 1) {
    throw new Error("Cannot build game: planned workspace versions drifted");
  }
  const version = versions[0]!;
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
    throw new Error(`Cannot build game: invalid version ${version}`);
  }
  return version;
}

export async function appVersionPlugin(root: string): Promise<Plugin> {
  const version = await getBuildVersion(root);
  return {
    name: "game-build-version",
    config: () => ({ define: { __APP_BUILD_VERSION__: JSON.stringify(version) } }),
    configureServer(server) {
      const changesets = path.resolve(root, ".changeset");
      const manifests = WORKSPACES.map((dir) => path.resolve(root, dir, "package.json"));
      server.watcher.add([changesets, ...manifests]);
      const onChange = (_event: string, file: string) => {
        const relative = path.relative(changesets, path.resolve(file));
        const inChangesets = relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        if ((inChangesets && /\.(md|json)$/.test(file)) || manifests.includes(path.resolve(file))) {
          // Reload the config to recalculate the define, then Vite reloads clients.
          void server.restart();
        }
      };
      server.watcher.on("all", onChange);
      server.httpServer?.once("close", () => server.watcher.off("all", onChange));
    },
  };
}
