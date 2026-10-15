import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Minimap click-to-move wiring (source-level: the canvas needs WebGL, so
// the math itself lives in minimap.test.ts). The minimap box must issue a
// world-point request and the canvas must consume it by translating the
// orbit target + camera together — never by resetting yaw/pitch/zoom.

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("minimap click-to-move wiring", () => {
  it("issues a sequenced world-point jump from pointer clicks and drags", () => {
    expect(appSource).toContain("minimapPointToWorld");
    expect(appSource).toContain("onPointerDown={jumpFromMinimap}");
    expect(appSource).toContain("e.buttons");
    expect(appSource).toContain("jumpTo={jump}");
  });

  it("keeps the live overlay dots, HQ markers, and hover chip", () => {
    expect(appSource).toContain("liveUnits.map");
    expect(appSource).toContain("hqs.map");
    expect(appSource).toContain("hover");
  });

  it("consumes the jump in the canvas tick via an offset-preserving retarget", () => {
    expect(canvasSource).toContain("jumpTo");
    expect(canvasSource).toContain("jumpRef");
    expect(canvasSource).toContain("jumpCameraTo");
    expect(canvasSource).toContain("appliedJumpSeq");
  });
});
