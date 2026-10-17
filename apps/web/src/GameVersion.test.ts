import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getBuildVersion } from "../appVersion";
import GameVersion, { BUILD_VERSION } from "./GameVersion";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("game version badge", () => {
  it("renders the real current release plan through Vite's build define", async () => {
    expect(BUILD_VERSION).toBe(await getBuildVersion(root));
    const markup = renderToStaticMarkup(createElement(GameVersion));
    expect(markup).toContain(`>v${BUILD_VERSION}</span>`);
    expect(markup).toContain(`aria-label="Game version ${BUILD_VERSION}"`);
  });

  it("keeps the badge in the top-right header and visible on narrow screens", () => {
    const app = readFileSync(path.join(root, "apps/web/src/App.tsx"), "utf8");
    const css = readFileSync(path.join(root, "apps/web/src/index.css"), "utf8");
    const header = app.slice(app.indexOf('<header className="command-header">'), app.indexOf('</header>'));
    expect(header).toContain('<GameVersion />');
    expect(header.indexOf('<GameVersion />')).toBeGreaterThan(header.indexOf('</nav>'));
    expect(css).not.toMatch(/\.command-status\s*\{[^}]*display: none/);
    expect(css).not.toMatch(/\.game-version\s*\{[^}]*display: none/);
    expect(css).toContain('.command-brand small, .simulation-status { display: none; }');
  });
});
