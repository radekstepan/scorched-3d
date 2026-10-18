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
    const imgTag = appSource.match(/<img\b[^>]*alt="Minimap"[^>]*\/>/)?.[0] ?? "";
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

  it("holds the camera clamp at every site while a jump-placed camera is out", () => {
    // Every camera-clamp site (keyboard pan + follow-battle glide +
    // post-controls.update) must be conditional on the exemption: an
    // unconditional clamp yanks the fresh teleport (zoom collapse + angle
    // swing + out-of-frame jump tick on far-view → HQ clicks). The
    // keyboard and follow sites carry the target (the pan-back wall); the
    // post-update site branches rigid-pan vs orbit/zoom inside a single
    // exemption block.
    const conditionals = canvasSource.match(/if \(!jumpPlacedCamera\)/g) ?? [];
    expect(conditionals).toHaveLength(3);
    const carrying =
      canvasSource.match(/if \(!jumpPlacedCamera\)\s+clampCameraToWorldWithTarget\(camera\.position/g) ??
      [];
    expect(carrying).toHaveLength(2);
    expect(canvasSource).toMatch(
      /if \(!jumpPlacedCamera\) \{\s+if \(rigidPan\) clampCameraToWorldWithTarget\(camera\.position/,
    );
    expect(canvasSource).toMatch(/else clampCameraToWorld\(camera\.position/);
  });

  it("clears the exemption through the re-entry check", () => {
    // The exemption must end when the camera drifts back inside (gradual
    // motion stays trimmed every tick — the task-118 protection), never
    // by yanking the jump itself.
    expect(canvasSource).toContain("isCameraOutsideWorld");
    expect(canvasSource).toMatch(/jumpPlacedCamera && !isCameraOutsideWorld\(camera\.position/);
  });
});

describe("canvas CSS box tracks the wrap (task 121)", () => {
  // The jump pipeline is proven centered headless (minimap.test.ts drives
  // real OrbitControls through the tick order to NDC ≈ 0), so a centered
  // jump that renders at the visible bottom-right corner can only be a DOM
  // box failure — the same bug class as the task-112 minimap img, one
  // level up. Pure math tests cannot see it; pin the box at source level.

  it("lets setSize style the canvas so NDC center lands at viewport center", () => {
    // setSize(w, h, false) leaves the canvas CSS box at its pixel-ratio
    // backing size (2x the wrap on retina): it overflows the wrap, the
    // root's overflow-hidden clips it to the top-left quadrant, and the
    // orbit target at NDC (0,0) renders at the visible bottom-right
    // corner. Nothing in CSS constrains the canvas (preflight max-width
    // covers img/video only), so three.js must style it here.
    expect(canvasSource).not.toMatch(/setSize\(\s*w\s*,\s*h\s*,\s*false\s*\)/);
    expect(canvasSource).toMatch(/renderer\.setSize\(\s*w\s*,\s*h\s*\)/);
  });

  it("keeps the wrap/viewport clipping that makes the canvas box load-bearing", () => {
    // The quadrant-crop mechanism needs the wrap at viewport size and the
    // root clipping overflow; pin both so the setSize pin keeps its
    // meaning (without clipping the failure would be spill, not crop).
    expect(canvasSource).toContain("absolute inset-0");
    expect(appSource).toContain("overflow-hidden");
  });
});
