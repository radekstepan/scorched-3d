import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const SCRIPT = join(ROOT, "scripts", "sync-app-version.mjs");

const WORKSPACES = ["apps/web", "packages/core"];

const BRANDING_PREFIX = `/** Product identity. */\nexport const APP_NAME = "Scorched 3D";\n`;
const BRANDING_SUFFIX = `\nexport const APP_TAGLINE = "tag";\n`;

function brandingSource(version: string): string {
  return `${BRANDING_PREFIX}export const APP_VERSION = "${version}";${BRANDING_SUFFIX}`;
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

/**
 * The sync script derives the repo root from its own path, so a copy of
 * the real script placed at <fixture>/scripts/sync-app-version.mjs treats
 * the fixture as the repo. No production code changes are needed to test it.
 */
function makeFixture(versions: Record<string, string>, appVersion: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "scorched-version-sync-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(dir, "scripts", "sync-app-version.mjs"));
  for (const workspace of WORKSPACES) {
    mkdirSync(join(dir, workspace), { recursive: true });
    writeFileSync(
      join(dir, workspace, "package.json"),
      JSON.stringify({ name: workspace, version: versions[workspace] ?? "0.1.0" }),
    );
  }
  mkdirSync(join(dir, "packages", "core", "src"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "core", "src", "branding.ts"),
    appVersion === null ? `${BRANDING_PREFIX}${BRANDING_SUFFIX}` : brandingSource(appVersion),
  );
  return dir;
}

function brandingOf(dir: string): string {
  return readFileSync(join(dir, "packages", "core", "src", "branding.ts"), "utf8");
}

function run(dir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [join(dir, "scripts", "sync-app-version.mjs")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const { status, stdout, stderr } = error as {
      status: number;
      stdout: string;
      stderr: string;
    };
    return { status, stdout: stdout ?? "", stderr: stderr ?? "" };
  }
}

describe("sync-app-version.mjs", () => {
  it("exists at the path the version-packages script calls", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("rewrites a stale APP_VERSION to the agreed workspace version", () => {
    const dir = makeFixture({}, "0.0.0");
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/synced to 0\.1\.0/);
    const next = brandingOf(dir);
    expect(next).toContain('export const APP_VERSION = "0.1.0";');
    expect(next.startsWith(BRANDING_PREFIX)).toBe(true);
    expect(next.endsWith(BRANDING_SUFFIX)).toBe(true);
  });

  it("no-ops when APP_VERSION already matches", () => {
    const dir = makeFixture({}, "0.1.0");
    const before = brandingOf(dir);
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/already 0\.1\.0/);
    expect(brandingOf(dir)).toBe(before);
  });

  it("refuses to run when the workspaces disagree", () => {
    const dir = makeFixture({ "apps/web": "0.2.0" }, "0.1.0");
    const before = brandingOf(dir);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drifted/);
    expect(result.stderr).toContain("apps/web@0.2.0");
    expect(brandingOf(dir)).toBe(before);
  });

  it("refuses a non-semver agreed version", () => {
    const dir = makeFixture(
      Object.fromEntries(WORKSPACES.map((w) => [w, "next"])),
      "0.1.0",
    );
    const before = brandingOf(dir);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/non-semver/);
    expect(brandingOf(dir)).toBe(before);
  });

  it("refuses when the APP_VERSION declaration is missing", () => {
    const dir = makeFixture({}, null);
    const before = brandingOf(dir);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/No APP_VERSION declaration/);
    expect(brandingOf(dir)).toBe(before);
  });
});
