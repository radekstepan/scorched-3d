import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";

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
  controls.minDistance = 80;
  controls.maxDistance = 4200;
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

  it("respects min/max distance at the extremes", () => {
    const { camera, controls, fireWheel } = makeRig(true);
    for (let i = 0; i < 80; i++) fireWheel(CX, CY, -400);
    const minDist = distanceOf(camera, controls.target);
    expect(minDist).toBeGreaterThanOrEqual(80 - 1e-6);
    expect(minDist).toBeLessThan(81);
    for (let i = 0; i < 80; i++) fireWheel(CX, CY, 400);
    const maxDist = distanceOf(camera, controls.target);
    expect(maxDist).toBeLessThanOrEqual(4200 + 1e-6);
    expect(maxDist).toBeGreaterThan(4199);
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
    expect(dist).toBeGreaterThanOrEqual(80 - 1e-6);
    expect(dist).toBeLessThanOrEqual(4200 + 1e-6);
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
    // tick must re-clamp it to the map after controls.update().
    expect(canvasSource).toContain("clampPanTarget(controls.target");
  });

  it("scales the orbit ceiling to the doubled map", () => {
    // 320x256 cells ≈ 5104 world units wide: the zoom-out ceiling sits at
    // twice the classic 4200 so the whole battlefield stays frameable.
    expect(canvasSource).toMatch(/controls\.maxDistance\s*=\s*8400/);
  });
});
