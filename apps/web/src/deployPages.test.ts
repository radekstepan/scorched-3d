import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "deploy-pages.yml");
const VITE_CONFIG = join(ROOT, "apps", "web", "vite.config.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("GitHub Pages deploy", () => {
  it("has a Pages workflow (no branch-based deploys)", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
  });

  it("deploys from pushes to the default branch, plus manual runs", () => {
    const yaml = read(WORKFLOW);
    expect(yaml).toMatch(/branches:\s*\["main"\]/);
    expect(yaml).toContain("workflow_dispatch");
  });

  it("never creates or pushes to a publishing branch", () => {
    const yaml = read(WORKFLOW);
    expect(yaml).not.toMatch(/gh-pages/);
    expect(yaml).not.toMatch(/peaceiris|ghaction-github-pages|github-pages-deploy-action/);
    expect(yaml).not.toMatch(/git\s+(push|checkout)/);
  });

  it("grants the token permissions the Pages actions need", () => {
    const yaml = read(WORKFLOW);
    expect(yaml).toMatch(/pages:\s*write/);
    expect(yaml).toMatch(/id-token:\s*write/);
  });

  it("builds the workspace and uploads the web dist as the Pages artifact", () => {
    const yaml = read(WORKFLOW);
    expect(yaml).toMatch(/run:\s*yarn install --immutable/);
    expect(yaml).toMatch(/run:\s*yarn build/);
    expect(yaml).toMatch(/uses:\s*actions\/upload-pages-artifact@v3/);
    expect(yaml).toMatch(/path:\s*apps\/web\/dist/);
  });

  it("deploys through the official deploy-pages action", () => {
    const yaml = read(WORKFLOW);
    expect(yaml).toMatch(/uses:\s*actions\/deploy-pages@v4/);
    expect(yaml).toMatch(/needs:\s*build/);
  });

  it("builds the bundle with a relative base so subpath hosting works", () => {
    expect(read(VITE_CONFIG)).toMatch(/base:\s*"\.\/"/);
  });
});
