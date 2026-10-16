import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import { CAMERA_SURFACE_CLEARANCE, DEFAULT_ZOOM_SPEED, MAX_ZOOM_DISTANCE, MIN_ZOOM_DISTANCE, ZOOM_BASE_SPEED, clampCameraAboveSurface, clampCameraToWorld, clampPanTargetWithCamera, clampTargetAboveSurface, effectiveZoomSpeed } from "./cameraPan";

// Cursor-anchored scroll zoom: rolling the wheel must dolly toward the ground
// point under the cursor (that point stays pixel-pinned), not toward the
// screen center. The canvas gets this from OrbitControls' built-in
// `zoomToCursor` mode, which moves the camera along the cursor ray and
// migrates the orbit target with it — wheel and two-finger pinch share the
// same code path, and min/max distance + zoomSpeed still apply.
//
// OrbitControls' matrix math is pure JS, so these tests drive a real control
// instance headless (stub DOM element, no WebGL) through its actual `wheel`
// listener and assert on the resulting camera pose.

const WIDTH = 800;
const HEIGHT = 600;

interface StubDom {
  el: unknown;
  listeners: Map<string, (ev: unknown) => void>;
}

function makeStubDom(): StubDom {
  const listeners = new Map<string, (ev: unknown) => void>();
  const doc = { addEventListener() {}, removeEventListener() {} };
  const el = {
    style: {},
    clientWidth: WIDTH,
    clientHeight: HEIGHT,
    ownerDocument: doc,
    getRootNode: () => doc,
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      listeners.set(type, fn);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: WIDTH,
      height: HEIGHT,
      right: WIDTH,
      bottom: HEIGHT,
      x: 0,
      y: 0,
    }),
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() {
      return false;
    },
  };
  return { el, listeners };
}

interface ZoomRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  fireWheel: (clientX: number, clientY: number, deltaY: number) => void;
}

/** Opening-frame-like pose: elevated camera south of the map looking in. */
function makeRig(zoomToCursor: boolean): ZoomRig {
  const { el, listeners } = makeStubDom();
  const camera = new THREE.PerspectiveCamera(48, WIDTH / HEIGHT, 2, 14000);
  camera.position.set(0, 636, 2200);
  const controls = new OrbitControls(camera, el as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = MIN_ZOOM_DISTANCE;
  controls.maxDistance = MAX_ZOOM_DISTANCE;
  controls.zoomToCursor = zoomToCursor;
  controls.target.set(0, 0, 0);
  controls.update();
  const wheel = listeners.get("wheel");
  if (!wheel) throw new Error("OrbitControls did not subscribe to wheel events");
  return {
    camera,
    controls,
    fireWheel: (clientX, clientY, deltaY) =>
      wheel({ clientX, clientY, deltaY, preventDefault() {} }),
  };
}

function ndc(clientX: number, clientY: number): [number, number] {
  // Same mapping as TerrainCanvas: NDC y is +1 at the top of the frame.
  return [(clientX / WIDTH) * 2 - 1, 1 - (clientY / HEIGHT) * 2];
}

/** Where the cursor ray meets a horizontal ground plane (null = sky). */
function groundHit(
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  planeY: number,
): THREE.Vector3 | null {
  const [nx, ny] = ndc(clientX, clientY);
  camera.updateMatrixWorld();
  const dir = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  if (Math.abs(dir.y) < 1e-9) return null;
  const t = (planeY - camera.position.y) / dir.y;
  if (!(t > 0)) return null;
  return camera.position.clone().addScaledVector(dir, t);
}

function distanceOf(camera: THREE.PerspectiveCamera, target: THREE.Vector3): number {
  return camera.position.distanceTo(target);
}

describe("cursor-anchored wheel zoom", () => {
  // Off-center cursor: well away from the screen center so center-zoom and
  // cursor-zoom visibly disagree.
  const CX = 600;
  const CY = 200;

  it("pins the ground point under an off-center cursor when zooming in", () => {
    const { camera, controls, fireWheel } = makeRig(true);
    // Fixed terrain plane: the anchored mode migrates the orbit target, so
    // both hits must be measured against the pre-zoom plane.
    const planeY = controls.target.y;
    const before = groundHit(camera, CX, CY, planeY);
    expect(before).not.toBeNull();
    fireWheel(CX, CY, -120);
    const after = groundHit(camera, CX, CY, planeY);
    expect(after).not.toBeNull();
    expect(before!.distanceTo(after!)).toBeLessThan(0.01);
  });

  it("pins the ground point under an off-center cursor when zooming out", () => {
    const { camera, controls, fireWheel } = makeRig(true);
    const planeY = controls.target.y;
    const before = groundHit(camera, CX, CY, planeY);
    expect(before).not.toBeNull();
    fireWheel(CX, CY, 240);
    const after = groundHit(camera, CX, CY, planeY);
    expect(after).not.toBeNull();
    expect(distanceOf(camera, controls.target)).toBeGreaterThan(2200);
    expect(before!.distanceTo(after!)).toBeLessThan(0.01);
  });

  it("keeps the anchor pinned across repeated wheel ticks", () => {
    const { camera, fireWheel } = makeRig(true);
    const before = groundHit(camera, CX, CY, 0);
    expect(before).not.toBeNull();
    for (let i = 0; i < 10; i++) fireWheel(CX, CY, -30);
    const after = groundHit(camera, CX, CY, 0);
    expect(after).not.toBeNull();
    expect(before!.distanceTo(after!)).toBeLessThan(0.01);
  });

  it("migrates the orbit target toward the cursor when zooming in", () => {
    const { camera, controls, fireWheel } = makeRig(true);
    const anchor = groundHit(camera, CX, CY, 0);
    expect(anchor).not.toBeNull();
    expect(anchor!.x).toBeGreaterThan(0);
    const gapBefore = Math.hypot(anchor!.x - controls.target.x, anchor!.z - controls.target.z);
    for (let i = 0; i < 10; i++) fireWheel(CX, CY, -120);
    const gapAfter = Math.hypot(anchor!.x - controls.target.x, anchor!.z - controls.target.z);
    // The view leans into the cursor: the orbit target travels toward the
    // cursor's ground point instead of staying at the screen center (the
    // pinned-cursor tests above are the exact guarantee; this is the drift).
    expect(controls.target.x).toBeGreaterThan(0);
    expect(gapAfter).toBeLessThan(gapBefore);
  });

  it("slides the cursor anchor away without anchoring (documents the old feel)", () => {
    const { camera, controls, fireWheel } = makeRig(false);
    const planeY = controls.target.y;
    expect(controls.zoomToCursor).toBe(false);
    const before = groundHit(camera, CX, CY, planeY);
    expect(before).not.toBeNull();
    fireWheel(CX, CY, -120);
    const after = groundHit(camera, CX, CY, planeY);
    expect(after).not.toBeNull();
    // Center-zoom: the ground point under the cursor jumps tens of units per
    // tick — the "unintuitive" behavior cursor anchoring replaces.
    expect(before!.distanceTo(after!)).toBeGreaterThan(10);
  });

  it("defaults the zoom slider to 1x with a 4x absolute speed", () => {
    // 1x on the slider reads as 4x stock OrbitControls speed: twice the
    // old 2x default, inside the unchanged 0.2x–3x slider range.
    expect(DEFAULT_ZOOM_SPEED).toBe(1);
    expect(ZOOM_BASE_SPEED).toBe(4);
    expect(effectiveZoomSpeed(DEFAULT_ZOOM_SPEED)).toBe(4);
    expect(DEFAULT_ZOOM_SPEED).toBeGreaterThanOrEqual(0.2);
    expect(DEFAULT_ZOOM_SPEED).toBeLessThanOrEqual(3);
  });

  it("dollies roughly twice as far per wheel tick at the new default than at the old 2x", () => {
    const startDist = (rig: ZoomRig): number => distanceOf(rig.camera, rig.controls.target);
    const slow = makeRig(true);
    slow.controls.zoomSpeed = 2;
    const fast = makeRig(true);
    fast.controls.zoomSpeed = effectiveZoomSpeed(DEFAULT_ZOOM_SPEED);
    const d0 = startDist(slow);
    expect(startDist(fast)).toBeCloseTo(d0, 6);
    slow.fireWheel(CX, CY, -120);
    fast.fireWheel(CX, CY, -120);
    const slowStep = d0 - startDist(slow);
    const fastStep = d0 - startDist(fast);
    expect(slowStep).toBeGreaterThan(0);
    expect(fastStep).toBeGreaterThan(0);
    // OrbitControls scales the dolly exponentially per tick, so 2x speed
    // lands well clear of 1x without asserting an exact ratio.
    expect(fastStep / slowStep).toBeGreaterThan(1.5);
  });

  it("respects min/max distance at the extremes", () => {
    const { camera, controls, fireWheel } = makeRig(true);
    for (let i = 0; i < 80; i++) fireWheel(CX, CY, -400);
    const minDist = distanceOf(camera, controls.target);
    expect(minDist).toBeGreaterThanOrEqual(MIN_ZOOM_DISTANCE - 1e-6);
    expect(minDist).toBeLessThan(MIN_ZOOM_DISTANCE + 1);
    for (let i = 0; i < 80; i++) fireWheel(CX, CY, 400);
    const maxDist = distanceOf(camera, controls.target);
    expect(maxDist).toBeLessThanOrEqual(MAX_ZOOM_DISTANCE + 1e-6);
    expect(maxDist).toBeGreaterThan(MAX_ZOOM_DISTANCE - 1);
    for (const v of [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      controls.target.x,
      controls.target.y,
      controls.target.z,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("stays finite when the cursor points at the sky", () => {
    const { camera, controls, fireWheel } = makeRig(true);
    // Top edge of the frame looks above the horizon from this pose.
    expect(groundHit(camera, WIDTH / 2, 0, controls.target.y)).toBeNull();
    fireWheel(WIDTH / 2, 0, -120);
    const dist = distanceOf(camera, controls.target);
    expect(dist).toBeGreaterThanOrEqual(MIN_ZOOM_DISTANCE - 1e-6);
    expect(dist).toBeLessThanOrEqual(MAX_ZOOM_DISTANCE + 1e-6);
    for (const v of [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      controls.target.x,
      controls.target.y,
      controls.target.z,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("surface collision on zoom", () => {
  // OrbitControls' guardrails are target-relative: cursor-anchored zoom
  // flies the camera down the pointer ray toward the dirt, and the polar
  // clamp only holds the eye above the target's horizontal plane — so
  // zooming into a slope or skimming low over a rise buries the camera.
  // The canvas tick answers with clampCameraAboveSurface on the final
  // column (ground, or the water sheet when shown and higher). These
  // tests drive a real control instance through the wheel path against
  // analytic surfaces, first without the clamp (the fly-through) and
  // then with it applied per tick exactly like the canvas does.

  /** Low close-up pose: 12 units up, ~61 out — already leaning in. */
  function makeLowRig(): ZoomRig {
    const { el, listeners } = makeStubDom();
    const camera = new THREE.PerspectiveCamera(48, WIDTH / HEIGHT, 2, 14000);
    camera.position.set(0, 12, 60);
    const controls = new OrbitControls(camera, el as unknown as HTMLElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.zoomToCursor = true;
    controls.target.set(0, 0, 0);
    controls.update();
    const wheel = listeners.get("wheel");
    if (!wheel) throw new Error("OrbitControls did not subscribe to wheel events");
    return {
      camera,
      controls,
      fireWheel: (clientX, clientY, deltaY) =>
        wheel({ clientX, clientY, deltaY, preventDefault() {} }),
    };
  }

  /** Gentle hill (peak 25) sitting under the zoom flight path. */
  const hill = (x: number, z: number): number =>
    25 * Math.exp(-(x * x + (z - 35) * (z - 35)) / (2 * 15 * 15));
  /** Flat lake: still water 4 units over a flat lakebed, like the canvas' max(ground, water). */
  const lake = (_x: number, _z: number): number => Math.max(0, 4);

  function zoomFlight(
    surface: (x: number, z: number) => number,
    clamped: boolean,
  ): { minClearance: number; finalClearance: number; rig: ZoomRig } {
    const rig = makeLowRig();
    let minClearance = Infinity;
    for (let i = 0; i < 60; i++) {
      rig.fireWheel(400, 450, -120);
      rig.controls.update();
      if (clamped) {
        clampCameraAboveSurface(
          rig.camera.position,
          surface(rig.camera.position.x, rig.camera.position.z),
        );
      }
      minClearance = Math.min(
        minClearance,
        rig.camera.position.y - surface(rig.camera.position.x, rig.camera.position.z),
      );
    }
    const finalClearance =
      rig.camera.position.y - surface(rig.camera.position.x, rig.camera.position.z);
    return { minClearance, finalClearance, rig };
  }

  function expectFinitePose(rig: ZoomRig): void {
    for (const v of [
      rig.camera.position.x,
      rig.camera.position.y,
      rig.camera.position.z,
      rig.controls.target.x,
      rig.controls.target.y,
      rig.controls.target.z,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  }

  it("dives into a hillside when zooming without the surface clamp (the bug)", () => {
    const { minClearance, rig } = zoomFlight(hill, false);
    // Tens of units inside the hill — min/max distance never saw it.
    expect(minClearance).toBeLessThan(-10);
    expect(distanceOf(rig.camera, rig.controls.target)).toBeGreaterThanOrEqual(
      MIN_ZOOM_DISTANCE - 1e-6,
    );
  });

  it("dives under the water sheet when zooming without the surface clamp (the bug)", () => {
    const { minClearance, rig } = zoomFlight(lake, false);
    expect(minClearance).toBeLessThan(0);
    expect(rig.camera.position.y).toBeLessThan(4);
  });

  it("rides above the hillside when the tick clamps the eye", () => {
    const { minClearance, finalClearance, rig } = zoomFlight(hill, true);
    expect(minClearance).toBeGreaterThanOrEqual(CAMERA_SURFACE_CLEARANCE - 1e-9);
    // Settles resting on the floor, focus untouched.
    expect(finalClearance).toBeCloseTo(CAMERA_SURFACE_CLEARANCE, 9);
    expectFinitePose(rig);
  });

  it("rides above the water sheet when the tick clamps the eye", () => {
    const { minClearance, finalClearance, rig } = zoomFlight(lake, true);
    expect(minClearance).toBeGreaterThanOrEqual(CAMERA_SURFACE_CLEARANCE - 1e-9);
    expect(finalClearance).toBeCloseTo(CAMERA_SURFACE_CLEARANCE, 9);
    expectFinitePose(rig);
  });

  it("keeps a low orbit over a neighboring rise out of the dirt", () => {
    // Target seated in a valley, camera swung low over a 20-unit rise:
    // the polar clamp is target-relative, so update() keeps the buried
    // pose — the canvas floor must lift it.
    const { el } = makeStubDom();
    const camera = new THREE.PerspectiveCamera(48, WIDTH / HEIGHT, 2, 14000);
    camera.position.set(0, 2, 30);
    const controls = new OrbitControls(camera, el as unknown as HTMLElement);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.target.set(0, 0, 0);
    controls.update();
    expect(camera.position.y).toBeLessThan(20);
    clampCameraAboveSurface(camera.position, 20);
    expect(camera.position.y).toBe(20 + CAMERA_SURFACE_CLEARANCE);
    expect(camera.position.x).toBe(0);
    expect(camera.position.z).toBe(30);
  });
});

describe("cursor-anchored zoom wiring in TerrainCanvas", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const canvasSource = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");

  it("enables OrbitControls zoom-to-cursor", () => {
    expect(canvasSource).toMatch(/controls\.zoomToCursor\s*=\s*true/);
  });

  it("keeps the zoom guardrails the anchored mode relies on", () => {
    expect(canvasSource).toContain("controls.minDistance");
    expect(canvasSource).toContain("controls.maxDistance");
    expect(canvasSource).toContain("controls.zoomSpeed");
    // The anchored mode migrates the orbit target toward the cursor, so the
    // tick must re-clamp it to the map after controls.update() — carrying
    // the camera with the clamped delta so the angle survives the edge.
    expect(canvasSource).toContain("clampPanTargetWithCamera(controls.target");
  });

  it("scales the orbit ceiling to the doubled map", () => {
    // 320x256 cells ≈ 5104 world units wide: the zoom-out ceiling sits at
    // twice the classic 4200 so the whole battlefield stays frameable.
    expect(canvasSource).toMatch(/controls\.maxDistance\s*=\s*MAX_ZOOM_DISTANCE/);
  });

  it("holds the eye above the terrain/water surface every tick", () => {
    // OrbitControls' guardrails are target-relative, so the tick lifts the
    // final camera column above the local surface: ground, or the water
    // sheet when it's shown and higher — with no jump exemption, since an
    // underground eye is never a valid request.
    expect(canvasSource).toContain("clampCameraAboveSurface(camera.position, surfaceY)");
    expect(canvasSource).toMatch(
      /Math\.max\(groundY\(camera\.position\.x, camera\.position\.z\), water\.position\.y\)/,
    );
  });

  it("backs the close-up floor off to frame a single hull", () => {
    // 30-unit floor: ~27 units tall at the 48° fov, about one ~26-unit
    // tank hull — the 15-unit floor showed half a hull and felt too
    // close. High enough that a typical close-up pitch clears the 6-unit
    // surface floor (30·cos(74°) ≈ 8.3), so zooming in keeps the angle
    // instead of steepening onto the floor — while staying well outside
    // the longest hull half-length (14) and the 2-unit near plane, so
    // hulls never clip.
    expect(MIN_ZOOM_DISTANCE).toBe(30);
    expect(MIN_ZOOM_DISTANCE).toBeGreaterThan(14);
    expect(MIN_ZOOM_DISTANCE).toBeGreaterThan(2 * 5);
    expect(canvasSource).toMatch(/controls\.minDistance\s*=\s*MIN_ZOOM_DISTANCE/);
  });

  it("pins the orbit target to the terrain every tick", () => {
    // Cursor-anchored zoom re-seats the target along the camera's downward
    // forward ray each tick, so without a floor of its own the target sinks
    // underground while the eye rides the surface clamp — the offset
    // stretches past the zoom floor and the view pitches fully vertical.
    // The tick must floor the target's final column on the terrain (like
    // minimap jumps: dirt, not the water sheet) right after the eye floor.
    expect(canvasSource).toMatch(/clampTargetAboveSurface\(\s*controls\.target,/);
    expect(canvasSource).toMatch(/groundY\(controls\.target\.x, controls\.target\.z\)/);
  });
});

describe("close-up keeps its angle (target floor)", () => {
  // Cursor-anchored zoom re-seats the orbit target along the camera's
  // downward forward ray every wheel tick. The eye floor holds only the
  // camera up, so without a floor of its own the target dives hundreds of
  // units underground at max zoom: the camera→target offset stretches far
  // past the zoom floor and the view pitches fully vertical. The tick
  // answers with clampTargetAboveSurface on the target's final terrain
  // column. These tests drive a real control instance through the wheel
  // path in canvas tick order (XZ clamps, then the surface floors) on
  // flat ground, first without the floor (the vertical snap) and then
  // with it applied per tick exactly like the canvas does.
  const worldW = 5104;
  const worldD = 4080;

  /** Polar angle of the camera→target offset: 0 = looking straight down. */
  function polarOf(camera: THREE.PerspectiveCamera, target: THREE.Vector3): number {
    const off = camera.position.clone().sub(target);
    return Math.acos(Math.min(1, Math.max(-1, off.y / off.length())));
  }

  function zoomFlight(floored: boolean, clientX: number, clientY: number): ZoomRig {
    const rig = makeRig(true);
    for (let i = 0; i < 120; i++) {
      rig.fireWheel(clientX, clientY, -120);
      rig.controls.update();
      // Canvas tick order: zoom is not a rigid pan, so the camera reels
      // in alone; both surface floors read their final XZ column.
      clampPanTargetWithCamera(rig.controls.target, rig.camera.position, worldW, worldD);
      clampCameraToWorld(rig.camera.position, worldW, worldD);
      if (floored) clampTargetAboveSurface(rig.controls.target, 0);
      clampCameraAboveSurface(rig.camera.position, 0);
    }
    return rig;
  }

  function expectFinitePose(rig: ZoomRig): void {
    for (const v of [
      rig.camera.position.x,
      rig.camera.position.y,
      rig.camera.position.z,
      rig.controls.target.x,
      rig.controls.target.y,
      rig.controls.target.z,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  }

  it("pitches fully vertical and overshoots the zoom floor without the target floor (the bug)", () => {
    const rig = zoomFlight(false, 400, 450);
    // The eye rides the 6-unit floor while the focus sinks ~390 under the
    // dirt: the offset stretches ~13x past the zoom floor and the view
    // ends up looking straight down instead of holding its ~74° pitch.
    expect(rig.controls.target.y).toBeLessThan(-100);
    expect(distanceOf(rig.camera, rig.controls.target)).toBeGreaterThan(5 * MIN_ZOOM_DISTANCE);
    expect(polarOf(rig.camera, rig.controls.target)).toBeLessThan((10 * Math.PI) / 180);
  });

  it.each([
    [400, 300],
    [400, 450],
    [400, 550],
  ])("arrives at the zoom floor with the angle intact (cursor %i,%i)", (clientX, clientY) => {
    const start = makeRig(true);
    const startPhi = polarOf(start.camera, start.controls.target);
    const rig = zoomFlight(true, clientX, clientY);
    // Parked at the zoom floor, focus on the dirt, eye above it — and the
    // pitch within a few degrees of the opening ~74° (center zoom holds
    // it exactly; low-cursor zoom leans a touch shallower onto the eye
    // floor instead of snapping vertical).
    expect(distanceOf(rig.camera, rig.controls.target)).toBeGreaterThanOrEqual(
      MIN_ZOOM_DISTANCE - 1e-6,
    );
    expect(distanceOf(rig.camera, rig.controls.target)).toBeLessThan(MIN_ZOOM_DISTANCE + 1);
    expect(rig.controls.target.y).toBeGreaterThanOrEqual(-1e-9);
    expect(rig.camera.position.y).toBeGreaterThanOrEqual(CAMERA_SURFACE_CLEARANCE - 1e-9);
    expect(Math.abs(polarOf(rig.camera, rig.controls.target) - startPhi)).toBeLessThan(
      (8 * Math.PI) / 180,
    );
    expectFinitePose(rig);
  });
});
