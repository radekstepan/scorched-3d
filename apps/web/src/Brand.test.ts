import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@scorched-3d/core";
import Brand from "./Brand";

describe("workshop game logo", () => {
  it("renders the original hexagonal cube emblem and wordmark with one accessible name", () => {
    const markup = renderToStaticMarkup(createElement(Brand));
    expect(markup).toContain(`role="img" aria-label="${APP_NAME}"`);
    expect(markup).toContain('viewBox="0 0 36 40"');
    expect(markup).toContain('d="M18 1 34 10v19L18 39 2 29V10L18 1Z"');
    expect(markup).toContain('d="m18 7 10 6-10 6-10-6 10-6Zm-10 9 7 4v12l-7-4V16Zm20 0-7 4v12l7-4V16Z"');
    expect(markup).toContain('SCORCHED<span class="brand-3d">3D</span>');
    expect(markup).toContain("TACTICAL WARFARE. REFORGED.");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("uses the shared logo in the game header and retains its emblem on narrow screens", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    expect(app).toMatch(/<header className="command-header">\s*<Brand \/>/);
    expect(app).not.toContain("✣");
    expect(css).toMatch(/\.brand-mark\s*\{ width: 25px; height: 27px; \}/);
    expect(css).not.toMatch(/\.brand-mark\s*\{[^}]*display: none/);
  });
});
