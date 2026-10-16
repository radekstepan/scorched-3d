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

  it("seats the jump target onto the terrain so the clicked point centers", () => {
    // Without the ground-height seating the orbit target keeps its old
    // height and the clicked point renders off-center on oblique views.
    expect(canvasSource).toMatch(/jumpCameraTo\([\s\S]*?groundY/);
  });

  it("measures clicks and dots against the image content box (no strut gap, no border inset)", () => {
    // An inline img leaves a baseline strut gap (wrapper stands taller than
    // the terrain image, so every click/dot fraction stretches southward —
    // worst at the south edge) and a border insets the image content from
    // the box clicks/dots are measured against (corner miss). The minimap
    // img must be block-level with a layout-neutral (ring) frame.
    const imgTag = appSource.match(/<img[\s\S]*?alt="Minimap"[\s\S]*?\/>/)?.[0] ?? "";
    expect(imgTag).toContain("block");
    expect(imgTag).not.toContain("border");
    expect(imgTag).toContain("ring-1");
  });

  it("plots the hover chip in world coords like the dots and click handler", () => {
    // Cell-index math would sit up to half a cell off the point a click on
    // that spot addresses; the chip must share the dots/click mapping.
    expect(appSource).toContain("hover.worldX");
    expect(appSource).toContain("hover.worldZ");
    expect(appSource).not.toContain("hover.cellX / (map.width - 1)");
  });
});

describe("minimap jump exemption from the camera clamp (task 120)", () => {
  // The canvas needs WebGL, so the tick behavior is pinned at source level
  // while the mechanism (exemption ⟺ zoom/angle survival through real
  // OrbitControls) is proven headless in minimap.test.ts.

  it("flags jump-placed cameras when the tick applies a jump", () => {
    expect(canvasSource).toContain("jumpPlacedCamera = true");
  });

  it("holds the camera clamp at both sites while a jump-placed camera is out", () => {
    // Both clampCameraToWorld sites must be conditional on the exemption:
    // an unconditional clamp yanks the fresh teleport (zoom collapse +
    // angle swing + out-of-frame jump tick on far-view → HQ clicks).
    const conditional =
      canvasSource.match(/if \(!jumpPlacedCamera\) clampCameraToWorld\(camera\.position/g) ?? [];
    expect(conditional).toHaveLength(2);
  });

  it("clears the exemption through the re-entry check", () => {
    // The exemption must end when the camera drifts back inside (gradual
    // motion stays trimmed every tick — the task-118 protection), never
    // by yanking the jump itself.
    expect(canvasSource).toContain("isCameraOutsideWorld");
    expect(canvasSource).toMatch(/jumpPlacedCamera && !isCameraOutsideWorld\(camera\.position/);
  });
});
