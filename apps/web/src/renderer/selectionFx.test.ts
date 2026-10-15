import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  EMBER_ORANGE,
  LEGACY_AMBER,
  MINIMAP_SELECTED_GLOW,
  MINIMAP_SELECTED_OUTLINE,
  SCORCH_RENDER_ORDER,
  SELECTION_CHEVRON_HEIGHT,
  SELECTION_CHEVRON_YAW,
  SELECTION_CORE,
  SELECTION_OUTER,
  SELECTION_PULSE_AMP,
  SELECTION_PULSE_HZ,
  SELECTION_RENDER_ORDER,
  buildSelectionMarker,
  contrastRatio,
  disposeSelectionAssets,
  hueDistance,
  markerVisibility,
  rgbToHex,
  scorchToneRGB,
  selectionBeaconBob,
  selectionPulseScale,
  setBodyHighlight,
  updateSelectionMarker,
} from "./selectionFx";
import { boxSelect, clickSelect } from "./selection";
import { applyUnitDamageTint } from "./unitDamageFx";

/** Darkest scorch on the field: hammer impacts at intensity 0.8. */
const SCORCH_DARKEST = rgbToHex(scorchToneRGB(0.8));
/** Lightest scorch on the field: flash impacts at intensity 0.55. */
const SCORCH_LIGHTEST = rgbToHex(scorchToneRGB(0.55));
/** Representative mid-green grass for the light-ground leg of the policy. */
const GRASS_MID = 0x5a7a3a;
/** Deep water blue for the water leg. */
const WATER_DEEP = 0x1d4e6b;

describe("selection contrast on scorch (the brown mud)", () => {
  it("white halo and cyan core clear AA (4.5:1) on the darkest scorch", () => {
    expect(contrastRatio(SELECTION_OUTER, SCORCH_DARKEST)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SELECTION_CORE, SCORCH_DARKEST)).toBeGreaterThanOrEqual(4.5);
  });

  it("cyan core holds AA on the lightest scorch too", () => {
    expect(contrastRatio(SELECTION_CORE, SCORCH_LIGHTEST)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SELECTION_OUTER, SCORCH_LIGHTEST)).toBeGreaterThanOrEqual(4.5);
  });

  it("white halo carries light ground (grass) where cyan alone is weaker", () => {
    // Double-ring strategy: at least one ring must clear AA on grass.
    const best = Math.max(
      contrastRatio(SELECTION_OUTER, GRASS_MID),
      contrastRatio(SELECTION_CORE, GRASS_MID),
    );
    expect(best).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SELECTION_OUTER, GRASS_MID)).toBeGreaterThanOrEqual(4.5);
  });

  it("both rings read on deep water", () => {
    expect(contrastRatio(SELECTION_OUTER, WATER_DEEP)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SELECTION_CORE, WATER_DEEP)).toBeGreaterThanOrEqual(3);
  });
});

describe("hue separation from fire (why amber failed)", () => {
  it("legacy amber sits inside the ember hue family; cyan sits opposite", () => {
    // Amber-on-ember is a hue camouflage failure, not a luminance one:
    // amber clears luminance contrast on dark scorch but vanishes among
    // amber bolts/flashes/sparks and ember-brown ground.
    expect(contrastRatio(LEGACY_AMBER, SCORCH_DARKEST)).toBeGreaterThanOrEqual(4.5);
    expect(hueDistance(LEGACY_AMBER, EMBER_ORANGE)).toBeLessThan(50);
    expect(hueDistance(SELECTION_CORE, EMBER_ORANGE)).toBeGreaterThan(90);
  });
});

describe("marker layering policy (composites over scorch/smoke/fire)", () => {
  it("rings + chevron ignore depth and render above the scorch layer", () => {
    const marker = buildSelectionMarker();
    try {
      expect(SELECTION_RENDER_ORDER).toBeGreaterThan(SCORCH_RENDER_ORDER);
      for (const name of ["select-outer", "select-core", "select-chevron"]) {
        const mesh = marker.getObjectByName(name) as THREE.Mesh;
        expect(mesh).toBeTruthy();
        const mat = mesh.material as THREE.MeshBasicMaterial;
        expect(mat.depthTest).toBe(false);
        expect(mat.depthWrite).toBe(false);
        expect(mesh.renderOrder).toBeGreaterThanOrEqual(SELECTION_RENDER_ORDER);
      }
      // Core floats just above the halo so the coplanar pair never z-fights.
      const outer = marker.getObjectByName("select-outer")!;
      const core = marker.getObjectByName("select-core")!;
      expect(core.position.y).toBeGreaterThan(outer.position.y);
      expect((core as THREE.Mesh).renderOrder).toBeGreaterThan(
        (outer as THREE.Mesh).renderOrder,
      );
    } finally {
      disposeSelectionAssets();
    }
  });

  it("chevron rides above the tallest hull (commander antenna)", () => {
    const marker = buildSelectionMarker();
    try {
      const chev = marker.getObjectByName("select-chevron")!;
      // Commander antenna tops out near y=47; the beacon must clear it.
      expect(chev.position.y - SELECTION_CHEVRON_HEIGHT).toBe(0);
      expect(SELECTION_CHEVRON_HEIGHT).toBeGreaterThan(47);
    } finally {
      disposeSelectionAssets();
    }
  });

  it("marker shares one geometry/material set (no per-unit duplication)", () => {
    const a = buildSelectionMarker();
    const b = buildSelectionMarker();
    try {
      const geoA = (a.getObjectByName("select-outer") as THREE.Mesh).geometry;
      const geoB = (b.getObjectByName("select-outer") as THREE.Mesh).geometry;
      expect(geoA).toBe(geoB);
    } finally {
      disposeSelectionAssets();
    }
  });
});

describe("pulse math (legacy: markers no longer consume it)", () => {
  it("pulse is deterministic, bounded, and completes a period", () => {
    const period = 1 / SELECTION_PULSE_HZ;
    expect(selectionPulseScale(0.37)).toBe(selectionPulseScale(0.37));
    expect(selectionPulseScale(0)).toBeCloseTo(1, 10);
    expect(selectionPulseScale(period)).toBeCloseTo(1, 10);
    for (const t of [0, 0.1, 0.25, 0.5, 1.3]) {
      const s = selectionPulseScale(t);
      expect(s).toBeGreaterThanOrEqual(1 - SELECTION_PULSE_AMP - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + SELECTION_PULSE_AMP + 1e-9);
    }
    // Beacon bob stays exported + deterministic even though markers hold
    // the rest height now.
    expect(selectionBeaconBob(0.5)).toBe(selectionBeaconBob(0.5));
  });

  it("updateSelectionMarker is static: unit scale, rest height, fixed yaw at any t", () => {
    const marker = buildSelectionMarker();
    try {
      updateSelectionMarker(marker, 1.25, true);
      expect(marker.visible).toBe(true);
      const outer = marker.getObjectByName("select-outer")!;
      expect(outer.scale.x).toBe(1);
      expect(outer.scale.z).toBe(1);
      const chev = marker.getObjectByName("select-chevron")!;
      expect(chev.position.y).toBe(SELECTION_CHEVRON_HEIGHT);
      expect(chev.rotation.y).toBeCloseTo(SELECTION_CHEVRON_YAW, 10);
      // No motion over time: a later tick poses identically.
      const before = { y: chev.position.y, ry: chev.rotation.y, sx: outer.scale.x };
      updateSelectionMarker(marker, 2.5, true);
      expect(marker.visible).toBe(true);
      expect(chev.position.y).toBe(before.y);
      expect(chev.rotation.y).toBe(before.ry);
      expect(outer.scale.x).toBe(before.sx);
      updateSelectionMarker(marker, 3.75, false);
      expect(marker.visible).toBe(false);
      // Same objects, no per-frame allocation: child count never grows.
      expect(marker.children.length).toBe(3);
    } finally {
      disposeSelectionAssets();
    }
  });
});

describe("selection-state to style mapping (single, toggle, box multi)", () => {
  it("maps click / shift-toggle / box outputs to per-body visibility", () => {
    // Single click: exactly one marker.
    expect(markerVisibility(6, clickSelect([], 2, false))).toEqual([
      false, false, true, false, false, false,
    ]);
    // Shift-toggle adds, second toggle removes.
    const added = clickSelect([2], 4, true);
    expect(markerVisibility(6, added)).toEqual([false, false, true, false, true, false]);
    expect(markerVisibility(6, clickSelect(added, 2, true))).toEqual([
      false, false, false, false, true, false,
    ]);
    // Box multi-select lights every hit; empty click clears.
    expect(markerVisibility(6, boxSelect([], [0, 3, 5], false))).toEqual([
      true, false, false, true, false, true,
    ]);
    expect(markerVisibility(6, clickSelect([0, 3], null, false))).toEqual([
      false, false, false, false, false, false,
    ]);
  });
});

describe("hull paint preserved (highlight never tints the hull blue)", () => {
  it("setBodyHighlight touches neither hull color nor emissive, pristine or charred", () => {
    const body = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2, 3),
      new THREE.MeshLambertMaterial({ color: 0x5a6b46 }),
    );
    body.add(hull);
    const marker = buildSelectionMarker();
    body.add(marker);
    try {
      const mat = hull.material as THREE.MeshLambertMaterial;
      const pristineColor = mat.color.getHex();
      const pristineEmissive = mat.emissive.getHex();
      setBodyHighlight(body, true);
      expect(mat.color.getHex()).toBe(pristineColor);
      expect(mat.emissive.getHex()).toBe(pristineEmissive);
      // Charred hulls keep their charring under highlight too.
      applyUnitDamageTint(body, 0.8);
      const charred = mat.color.getHex();
      expect(charred).not.toBe(pristineColor);
      setBodyHighlight(body, true);
      expect(mat.color.getHex()).toBe(charred);
      expect(mat.emissive.getHex()).toBe(pristineEmissive);
      setBodyHighlight(body, false);
      expect(mat.color.getHex()).toBe(charred);
      expect(mat.emissive.getHex()).toBe(pristineEmissive);
    } finally {
      disposeSelectionAssets();
    }
  });

  it("selection markers stay tagged so damage charring skips them", () => {
    const marker = buildSelectionMarker();
    try {
      for (const name of ["select-outer", "select-core", "select-chevron"]) {
        expect(marker.getObjectByName(name)!.userData.noHighlight).toBe(true);
      }
    } finally {
      disposeSelectionAssets();
    }
  });
});

describe("minimap selected-dot policy", () => {
  it("selected dots carry a white outline + cyan glow (never amber)", () => {
    expect(MINIMAP_SELECTED_OUTLINE).toContain("#ffffff");
    expect(MINIMAP_SELECTED_GLOW).toContain("#22d3ee");
    expect(MINIMAP_SELECTED_OUTLINE.toLowerCase()).not.toContain("amber");
    expect(MINIMAP_SELECTED_GLOW.toLowerCase()).not.toContain("amber");
  });
});
