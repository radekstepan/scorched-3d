import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_DESCRIPTION,
  APP_DOCUMENT_TITLE,
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
} from "./branding.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Workspaces versioned in lockstep by the changesets `fixed` group. */
const VERSIONED_PACKAGES = [
  "apps/web/package.json",
  "packages/core/package.json",
];

function packageVersion(relative: string): string {
  return (JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as { version: string }).version;
}

describe("branding", () => {
  it("uses the adopted product name", () => {
    expect(APP_NAME).toBe("Scorched 3D");
  });

  it("shows a semver app version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mirrors the workspace package versions (single source of truth)", () => {
    for (const relative of VERSIONED_PACKAGES) {
      expect(packageVersion(relative), relative).toBe(APP_VERSION);
    }
  });

  it("describes the game", () => {
    expect(APP_TAGLINE.length).toBeGreaterThan(0);
    expect(APP_DESCRIPTION).toMatch(/artillery/i);
  });

  it("derives the browser tab title from the product name", () => {
    expect(APP_DOCUMENT_TITLE).toBe(`${APP_NAME} · Terrain`);
    expect(APP_DOCUMENT_TITLE).toBe("Scorched 3D · Terrain");
  });

  it("sets the web index.html title from the branding constant", () => {
    const html = readFileSync(join(ROOT, "apps", "web", "index.html"), "utf8");
    const match = html.match(/<title>([^<]*)<\/title>/);
    expect(match?.[1]).toBe(APP_DOCUMENT_TITLE);
  });

  it("integrates the shared logo with an accessible name from the branding constant", () => {
    const appSource = readFileSync(join(ROOT, "apps", "web", "src", "App.tsx"), "utf8");
    const brandSource = readFileSync(join(ROOT, "apps", "web", "src", "Brand.tsx"), "utf8");
    expect(appSource).toMatch(/import Brand from ["']\.\/Brand["']/);
    expect(appSource).toMatch(/<header className="command-header">\s*<Brand \/>/);
    expect(brandSource).toMatch(/import\s*\{\s*APP_NAME\s*\}\s*from ["']@scorched-3d\/core["']/);
    expect(brandSource).toMatch(/role="img" aria-label=\{APP_NAME\}/);
    expect(appSource).not.toMatch(/nanolathe/i);
    expect(brandSource).not.toMatch(/nanolathe/i);
  });

  it("labels every package with the adopted product name", () => {
    for (const relative of ["package.json", ...VERSIONED_PACKAGES]) {
      const pkg = JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as {
        description?: string;
      };
      expect(pkg.description, relative).toMatch(/Scorched 3D/);
    }
  });
});
