import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  clampCameraToWorld,
  clampPanTargetWithCamera,
  isCameraOutsideWorld,
} from "./cameraPan";
import {
  jumpCameraTo,
  minimapPointToWorld,
  minimapUvToWorld,
  worldToMinimapUv,
} from "./minimap";

const W = 5104;
const D = 4080;

describe("minimapUvToWorld", () => {
  it("maps the center to the world origin", () => {
    expect(minimapUvToWorld(0.5, 0.5, W, D)).toEqual({ x: 0, z: 0 });
  });

  it("maps corners to half-extents", () => {
    expect(minimapUvToWorld(0, 0, W, D)).toEqual({ x: -W / 2, z: -D / 2 });
    expect(minimapUvToWorld(1, 1, W, D)).toEqual({ x: W / 2, z: D / 2 });
  });

  it("clamps out-of-range and non-finite input to the edges", () => {
    expect(minimapUvToWorld(-0.5, 2, W, D)).toEqual({ x: -W / 2, z: D / 2 });
    expect(minimapUvToWorld(NaN, Infinity, W, D)).toEqual({ x: -W / 2, z: -D / 2 });
  });

  it("round-trips with worldToMinimapUv (the overlay dot math)", () => {
    for (const [x, z] of [
      [0, 0],
      [-W / 2, -D / 2],
      [W / 2, D / 2],
      [1234, -987],
    ] as const) {
      const uv = worldToMinimapUv(x, z, W, D);
      expect(minimapUvToWorld(uv.u, uv.v, W, D).x).toBeCloseTo(x, 9);
      expect(minimapUvToWorld(uv.u, uv.v, W, D).z).toBeCloseTo(z, 9);
    }
  });
});

describe("minimapPointToWorld", () => {
  const rect = { left: 10, top: 20, width: 250, height: 250 };

  it("maps a client point through the box rect", () => {
    // Center of the box → world origin.
    expect(minimapPointToWorld(135, 145, rect, W, D)).toEqual({ x: 0, z: 0 });
    // Top-left corner → north-west corner of the world.
    expect(minimapPointToWorld(10, 20, rect, W, D)).toEqual({ x: -W / 2, z: -D / 2 });
  });

  it("falls back to the center on a zero-size rect", () => {
    expect(minimapPointToWorld(10, 20, { left: 0, top: 0, width: 0, height: 0 }, W, D)).toEqual({
      x: 0,
      z: 0,
    });
  });
});

describe("jumpCameraTo preserves angle of view and zoom", () => {
  it("translates target and camera by the same ground offset", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const before = {
      dx: position.x - target.x,
      dy: position.y - target.y,
      dz: position.z - target.z,
      dist: Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z),
    };
    jumpCameraTo(position, target, { x: 1000, z: -500 }, W, D);
    expect(target.x).toBeCloseTo(1000, 9);
    expect(target.z).toBeCloseTo(-500, 9);
    // Same offset vector → same yaw/pitch/zoom; target height untouched.
    expect(position.x - target.x).toBeCloseTo(before.dx, 9);
    expect(position.y - target.y).toBeCloseTo(before.dy, 9);
    expect(position.z - target.z).toBeCloseTo(before.dz, 9);
    expect(Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)).toBeCloseTo(
      before.dist,
      9,
    );
    expect(target.y).toBe(50);
  });

  it("clamps past the edge but still preserves the offset", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const dx = position.x - target.x;
    const dz = position.z - target.z;
    jumpCameraTo(position, target, { x: 99999, z: -99999 }, W, D);
    const boundX = (W / 2) * 1.25;
    const boundZ = (D / 2) * 1.25;
    expect(target.x).toBeCloseTo(boundX, 9);
    expect(target.z).toBeCloseTo(-boundZ, 9);
    expect(position.x - target.x).toBeCloseTo(dx, 9);
    expect(position.z - target.z).toBeCloseTo(dz, 9);
  });
});

describe("jumpCameraTo seats the target onto the terrain", () => {
  it("lands the clicked surface point on the orbit target, keeping the full 3D offset", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const before = {
      dx: position.x - target.x,
      dy: position.y - target.y,
      dz: position.z - target.z,
      dist: Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z),
    };
    const seen: Array<[number, number]> = [];
    jumpCameraTo(position, target, { x: 1000, z: -500 }, W, D, (x, z) => {
      seen.push([x, z]);
      return 40;
    });
    // Sampler runs at the destination; the target IS the clicked surface point.
    expect(seen).toEqual([[1000, -500]]);
    expect(target.x).toBeCloseTo(1000, 9);
    expect(target.y).toBeCloseTo(40, 9);
    expect(target.z).toBeCloseTo(-500, 9);
    // Same offset vector → same yaw/pitch/zoom, only the focus moved.
    expect(position.x - target.x).toBeCloseTo(before.dx, 9);
    expect(position.y - target.y).toBeCloseTo(before.dy, 9);
    expect(position.z - target.z).toBeCloseTo(before.dz, 9);
    expect(Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)).toBeCloseTo(
      before.dist,
      9,
    );
  });

  it("samples the clamped destination past the edge", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const seen: Array<[number, number]> = [];
    jumpCameraTo(position, target, { x: 99999, z: -99999 }, W, D, (x, z) => {
      seen.push([x, z]);
      return -12;
    });
    const boundX = (W / 2) * 1.25;
    const boundZ = (D / 2) * 1.25;
    expect(seen).toEqual([[boundX, -boundZ]]);
    expect(target.x).toBeCloseTo(boundX, 9);
    expect(target.y).toBeCloseTo(-12, 9);
    expect(target.z).toBeCloseTo(-boundZ, 9);
    // Camera rode along by the same delta, so the zoom distance survives.
    expect(position.y - target.y).toBeCloseTo(1150, 9);
  });

  it("ignores a non-finite sample and keeps target height", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    jumpCameraTo(position, target, { x: 1000, z: -500 }, W, D, () => NaN);
    expect(target).toEqual({ x: 1000, y: 50, z: -500 });
    expect(position).toEqual({ x: 1000, y: 1200, z: 2500 });
  });

  it("puts the clicked ground point in the center of the view (HQ-click regression)", () => {
    // Close, glancing view onto low ground: the old height-preserving jump
    // leaves the clicked point far off-center; the seated jump centers it.
    const dest = { x: 1000, z: -500 };
    const ground = -20;
    const projectAfter = (seat: boolean): { x: number; y: number } => {
      const position = { x: 0, y: 60, z: 120 };
      const target = { x: 0, y: 50, z: 0 };
      if (seat) jumpCameraTo(position, target, dest, W, D, () => ground);
      else jumpCameraTo(position, target, dest, W, D);
      const camera = new THREE.PerspectiveCamera(48, 16 / 9, 2, 14000);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateMatrixWorld();
      const ndc = new THREE.Vector3(dest.x, ground, dest.z).project(camera);
      return { x: ndc.x, y: ndc.y };
    };
    const unseated = projectAfter(false);
    // ~31° off-axis at a 48° fov: the clicked point is out of frame.
    expect(Math.hypot(unseated.x, unseated.y)).toBeGreaterThan(0.5);
    const seated = projectAfter(true);
    expect(Math.abs(seated.x)).toBeLessThan(1e-6);
    expect(Math.abs(seated.y)).toBeLessThan(1e-6);
  });
});

describe("edge clicks survive the corner clamp exactly (task 112)", () => {
  // The click/dot box is the image content box (block img, ring frame), so
  // fractions at the box edges address the map edges exactly. The
  // PAN_EDGE_MARGIN clamp only bites past 1.25x half-extents and carries
  // the camera with the clamped delta — the same bounds the tick's
  // clampPanTargetWithCamera enforces, so a jump never fights it (task 4).
  const rect = { left: 0, top: 0, width: 234, height: 234 };

  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.5, 1],
    [1, 0.5],
    [0.5, 0],
  ] as const) {
    it(`fraction (${u}, ${v}) addresses the map edge exactly and centers it`, () => {
      const w = minimapPointToWorld(rect.left + u * rect.width, rect.top + v * rect.height, rect, W, D);
      expect(w.x).toBeCloseTo((u - 0.5) * W, 9);
      expect(w.z).toBeCloseTo((v - 0.5) * D, 9);
      const position = { x: -1500, y: 1400, z: 2600 };
      const target = { x: 200, y: 300, z: -400 };
      const dx = position.x - target.x;
      const dy = position.y - target.y;
      const dz = position.z - target.z;
      jumpCameraTo(position, target, w, W, D, () => 42);
      // Inside the margin: the target becomes the clicked surface point and
      // the camera rides the same delta (angle/zoom preserved).
      expect(target.x).toBeCloseTo(w.x, 9);
      expect(target.y).toBeCloseTo(42, 9);
      expect(target.z).toBeCloseTo(w.z, 9);
      expect(position.x - target.x).toBeCloseTo(dx, 9);
      expect(position.y - target.y).toBeCloseTo(dy, 9);
      expect(position.z - target.z).toBeCloseTo(dz, 9);
      // …and the clicked surface point projects to the screen center.
      const camera = new THREE.PerspectiveCamera(48, 16 / 9, 2, 20000);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateMatrixWorld();
      const ndc = new THREE.Vector3(w.x, 42, w.z).project(camera);
      expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
      expect(Math.abs(ndc.y)).toBeLessThan(1e-6);
    });
  }

  it("leaves inside-margin destinations untouched (no fight with the corner clamp)", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const edge = { x: (W / 2) * 1.25, z: -(D / 2) * 1.25 };
    jumpCameraTo(position, target, edge, W, D, () => 7);
    expect(target.x).toBeCloseTo(edge.x, 9);
    expect(target.y).toBeCloseTo(7, 9);
    expect(target.z).toBeCloseTo(edge.z, 9);
    expect(position.x - target.x).toBeCloseTo(0, 9);
    expect(position.y - target.y).toBeCloseTo(1150, 9);
    expect(position.z - target.z).toBeCloseTo(3000, 9);
  });
});

describe("jumpCameraTo centers the click at any angle and zoom (task 102)", () => {
  const dest = { x: 800, z: -600 };
  const ground = 25;
  const polar = Math.PI / 3; // 60° from +Y: a typical oblique RTS view.
  const offsetFor = (azimuthDeg: number, dist: number): { x: number; y: number; z: number } => {
    const az = (azimuthDeg * Math.PI) / 180;
    return {
      x: dist * Math.sin(polar) * Math.sin(az),
      y: dist * Math.cos(polar),
      z: dist * Math.sin(polar) * Math.cos(az),
    };
  };
  const sphericalOf = (dx: number, dy: number, dz: number): { az: number; polar: number; dist: number } => {
    const dist = Math.hypot(dx, dy, dz);
    return { az: Math.atan2(dx, dz), polar: Math.acos(dy / dist), dist };
  };

  for (const azimuth of [0, 45, 90, 180, 270]) {
    for (const dist of [300, 4000]) {
      it(`azimuth ${azimuth}°, distance ${dist}: target becomes the clicked surface point, angle + zoom preserved, NDC centered`, () => {
        const off = offsetFor(azimuth, dist);
        const position = { x: off.x, y: 50 + off.y, z: off.z };
        const target = { x: 0, y: 50, z: 0 };
        const before = sphericalOf(position.x - target.x, position.y - target.y, position.z - target.z);
        jumpCameraTo(position, target, dest, W, D, () => ground);
        // The clicked world point becomes the new orbit target / camera focus.
        expect(target.x).toBeCloseTo(dest.x, 9);
        expect(target.y).toBeCloseTo(ground, 9);
        expect(target.z).toBeCloseTo(dest.z, 9);
        // Angle (azimuthal/polar) and zoom distance preserved.
        const after = sphericalOf(position.x - target.x, position.y - target.y, position.z - target.z);
        expect(after.dist).toBeCloseTo(before.dist, 6);
        expect(after.az).toBeCloseTo(before.az, 9);
        expect(after.polar).toBeCloseTo(before.polar, 9);
        // …and the clicked surface point projects to the screen center.
        const camera = new THREE.PerspectiveCamera(48, 16 / 9, 2, 20000);
        camera.position.set(position.x, position.y, position.z);
        camera.lookAt(target.x, target.y, target.z);
        camera.updateMatrixWorld();
        const ndc = new THREE.Vector3(dest.x, ground, dest.z).project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
        expect(Math.abs(ndc.y)).toBeLessThan(1e-6);
      });
    }
  }
});

describe("minimap jumps survive the camera clamp via the jump exemption (task 120)", () => {
  // Headless tick-chain through REAL OrbitControls with the canvas settings
  // (damping, polar clamp, zoom-to-cursor): jump → controls.update() →
  // target clamp → conditional camera clamp → project. Task 118's
  // clampCameraToWorld yanked every jump-placed camera back into the
  // ±3190×±2550 rectangle — a far-east-view → east-HQ click collapsed zoom
  // ~2.6x and swung the polar angle ~38°, with the clicked point out of
  // frame on the jump tick. The tick now exempts jump-placed cameras until
  // they drift back inside (wiring pins in App.minimap.test.ts); these
  // tests prove the mechanism through real three.js: exemption ⟺ the
  // requested zoom + angle survive with the click centered.
  const ground = 100;
  const dest = { x: 2472, z: 300 }; // East map-end HQ.

  function makeJumpRig(pos: { x: number; y: number; z: number }, tgt: { x: number; y: number; z: number }) {
    const doc = { addEventListener() {}, removeEventListener() {} };
    const el = {
      style: {},
      ownerDocument: doc,
      getRootNode: () => doc,
      addEventListener() {},
      removeEventListener() {},
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    };
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 2, 14000);
    camera.position.set(pos.x, pos.y, pos.z);
    const controls = new OrbitControls(camera, el as unknown as HTMLElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.zoomToCursor = true;
    controls.target.set(tgt.x, tgt.y, tgt.z);
    controls.update();
    return { camera, controls };
  }

  function sphericalOf(camera: THREE.PerspectiveCamera, target: THREE.Vector3): {
    az: number;
    polar: number;
    dist: number;
  } {
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;
    const dist = Math.hypot(dx, dy, dz);
    return { az: Math.atan2(dx, dz), polar: Math.acos(dy / dist), dist };
  }

  function projectDest(camera: THREE.PerspectiveCamera): { x: number; y: number } {
    camera.updateMatrixWorld();
    const ndc = new THREE.Vector3(dest.x, ground, dest.z).project(camera);
    return { x: ndc.x, y: ndc.y };
  }

  for (const [name, pos, tgt] of [
    ["far overview from the east", { x: 3190, y: 1200, z: 0 }, { x: 0, y: 100, z: 0 }],
    ["mid view looking west", { x: 2500, y: 1400, z: 200 }, { x: 0, y: 100, z: 0 }],
  ] as const) {
    it(`exempt jump preserves zoom + angle and centers on the jump tick (${name} → HQ)`, () => {
      const { camera, controls } = makeJumpRig(pos, tgt);
      const before = sphericalOf(camera, controls.target);
      // Tick order mirrors TerrainCanvas: jump → update → target clamp →
      // conditional camera clamp → render. The translated camera lands
      // outside the rectangle (the pre-fix yank trigger) but the
      // exemption holds, so the offset survives untouched.
      let jumpPlacedCamera = true;
      jumpCameraTo(camera.position, controls.target, dest, W, D, () => ground);
      expect(isCameraOutsideWorld(camera.position, W, D)).toBe(true);
      controls.update();
      clampPanTargetWithCamera(controls.target, camera.position, W, D);
      if (jumpPlacedCamera && !isCameraOutsideWorld(camera.position, W, D)) jumpPlacedCamera = false;
      if (!jumpPlacedCamera) clampCameraToWorld(camera.position, W, D);
      expect(jumpPlacedCamera).toBe(true);
      const ndc = projectDest(camera);
      expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
      expect(Math.abs(ndc.y)).toBeLessThan(1e-6);
      const after = sphericalOf(camera, controls.target);
      expect(after.dist).toBeCloseTo(before.dist, 6);
      expect(after.az).toBeCloseTo(before.az, 6);
      expect(after.polar).toBeCloseTo(before.polar, 6);
    });
  }

  it("contrast: clamping the jump-placed camera collapses zoom and misses the frame (the bug)", () => {
    // The pre-fix tick order (unconditional camera clamp): the same jump
    // lands the camera at x=5662, update() aims from there, then the clamp
    // yanks it to 3190 — so the jump tick renders the clicked point out of
    // frame, and the settled view keeps neither the zoom nor the angle.
    const { camera, controls } = makeJumpRig({ x: 3190, y: 1200, z: 0 }, { x: 0, y: 100, z: 0 });
    const before = sphericalOf(camera, controls.target);
    jumpCameraTo(camera.position, controls.target, dest, W, D, () => ground);
    controls.update();
    clampPanTargetWithCamera(controls.target, camera.position, W, D);
    clampCameraToWorld(camera.position, W, D);
    const flash = projectDest(camera);
    expect(Math.hypot(flash.x, flash.y)).toBeGreaterThan(1);
    // Settle one quiet tick: the ground point re-centers, but the zoom and
    // angle are gone (dist ~3374 → ~1314, polar ~71° → ~33°).
    controls.update();
    clampPanTargetWithCamera(controls.target, camera.position, W, D);
    clampCameraToWorld(camera.position, W, D);
    const settled = projectDest(camera);
    expect(Math.abs(settled.x)).toBeLessThan(1e-6);
    expect(Math.abs(settled.y)).toBeLessThan(1e-6);
    const after = sphericalOf(camera, controls.target);
    expect(after.dist).toBeLessThan(before.dist * 0.5);
    expect(after.polar).toBeLessThan(before.polar - 0.3);
  });

  it("exemption holds across later ticks (no delayed yank) and clears on re-entry", () => {
    // A jump-tick-only skip would yank on tick 2 — the same breakage one
    // frame later. Run five quiet ticks through the tick transition and
    // demand a stable offset throughout.
    const { camera, controls } = makeJumpRig({ x: 3190, y: 1200, z: 0 }, { x: 0, y: 100, z: 0 });
    let jumpPlacedCamera = true;
    jumpCameraTo(camera.position, controls.target, dest, W, D, () => ground);
    const jumped = sphericalOf(camera, controls.target);
    for (let tick = 0; tick < 5; tick++) {
      controls.update();
      clampPanTargetWithCamera(controls.target, camera.position, W, D);
      if (jumpPlacedCamera && !isCameraOutsideWorld(camera.position, W, D)) jumpPlacedCamera = false;
      if (!jumpPlacedCamera) clampCameraToWorld(camera.position, W, D);
      expect(jumpPlacedCamera).toBe(true);
      const now = sphericalOf(camera, controls.target);
      expect(now.dist).toBeCloseTo(jumped.dist, 6);
      expect(now.az).toBeCloseTo(jumped.az, 6);
      expect(now.polar).toBeCloseTo(jumped.polar, 6);
    }
    // Zoom in: dolly the offset to 20% so the camera drifts back inside
    // (x 5662 → 3110, within ±3190) — the next tick clears the exemption
    // through the re-entry check.
    camera.position.set(
      controls.target.x + (camera.position.x - controls.target.x) * 0.2,
      controls.target.y + (camera.position.y - controls.target.y) * 0.2,
      controls.target.z + (camera.position.z - controls.target.z) * 0.2,
    );
    expect(isCameraOutsideWorld(camera.position, W, D)).toBe(false);
    controls.update();
    clampPanTargetWithCamera(controls.target, camera.position, W, D);
    if (jumpPlacedCamera && !isCameraOutsideWorld(camera.position, W, D)) jumpPlacedCamera = false;
    if (!jumpPlacedCamera) clampCameraToWorld(camera.position, W, D);
    expect(jumpPlacedCamera).toBe(false);
    // …and with the exemption cleared, gradual drift past the bound is
    // trimmed again: the task-118 protection is intact.
    camera.position.set((W / 2) * 1.25 + 500, 800, 300);
    controls.update();
    clampPanTargetWithCamera(controls.target, camera.position, W, D);
    if (jumpPlacedCamera && !isCameraOutsideWorld(camera.position, W, D)) jumpPlacedCamera = false;
    if (!jumpPlacedCamera) clampCameraToWorld(camera.position, W, D);
    expect(camera.position.x).toBeCloseTo((W / 2) * 1.25, 9);
    expect(controls.target.x).toBeCloseTo(dest.x, 9);
  });
});
