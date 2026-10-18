import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Pan-mode camera wiring at the source level (the canvas needs WebGL;
// the binding math is covered headless in cameraPan.test.ts — including
// synthetic drags through real OrbitControls — and the follow-battle
// hold in followBattle.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("pan-mode toggle", () => {
  it("defaults panMode to false in the View options state", () => {
    expect(appSource).toMatch(/panMode:\s*false/);
  });

  it("keeps a working Pan mode toggle wired to the view options", () => {
    expect(appSource).toContain('label="Pan mode"');
    expect(appSource).toContain("options.panMode");
    expect(appSource).toContain("patch({ panMode:");
  });

  it("retitles the footer drag hint while pan mode is on", () => {
    // The HUD footer documents the live drag gesture, so orbiting vs
    // panning must read correctly without opening the View panel.
    expect(appSource).toContain("options.panMode ?");
    expect(appSource).toMatch(/DRAG \$\{options\.panMode \? "pan" : "orbit"\}/);
  });
});

describe("pan-mode tick wiring", () => {
  it("locks rotation and repoints the orbit gestures through the binding", () => {
    // The binding is the single source of truth for what pan mode means;
    // the tick translates it onto the live OrbitControls every frame (the
    // same ref path as the pan/zoom speed sliders).
    expect(canvasSource).toContain("panModeBinding(opt.panMode)");
    expect(canvasSource).toContain("controls.enableRotate = panBinding.enableRotate;");
    expect(canvasSource).toContain(
      'controls.mouseButtons.LEFT = panBinding.left === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;',
    );
    expect(canvasSource).toContain(
      'controls.touches.ONE = panBinding.oneFinger === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;',
    );
  });

  it("mirrors the toggle into the follow-battle hold", () => {
    // Pan-mode left-drags own the camera against the follow glide, like
    // right-drags do in the stock mapping.
    expect(canvasSource).toContain("followHold.setPanMode(opt.panMode);");
  });

  it("never stamps a pan-mode selection click as follow-battle input", () => {
    // A left click in pan mode holds the camera (it can start a pan), but
    // without a drag it is a selection, not a pan — like the right-button
    // order exclusion, it must not pause the glide.
    expect(canvasSource).toContain(
      "const panModeClick = optsRef.current.panMode && wasDown?.button === 0 && releaseMoved < CLICK_DRAG_PX;",
    );
    expect(canvasSource).toContain("&& !panModeClick");
  });
});
