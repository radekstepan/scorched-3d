import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_DESCRIPTION,
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
});
