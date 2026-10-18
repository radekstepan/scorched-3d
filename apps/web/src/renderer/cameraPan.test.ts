import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  cameraFrameDelta,
  effectiveDragPanSpeed,
  MIN_PAN_DISTANCE,
  CAMERA_SURFACE_CLEARANCE,
  DEFAULT_PAN_SPEED,
  DEFAULT_ZOOM_SPEED,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  PAN_BASE_SPEED,
  PAN_EDGE_MARGIN,
  PAN_SPEED_FACTOR,
  PAN_SPEED_MAX,
  PAN_SPEED_MIN,
  RIGID_PAN_EPSILON,
  ZOOM_BASE_SPEED,
  ZOOM_SPEED_MAX,
  ZOOM_SPEED_MIN,
  applyPan,
  clampCameraAboveSurface,
  clampCameraToWorld,
  clampCameraToWorldWithTarget,
  clampPanSpeed,
  clampPanTarget,
  clampPanTargetWithCamera,
  clampTargetAboveSurface,
  clampZoomSpeed,
  effectivePanSpeed,
  effectiveZoomSpeed,
  isCameraOutsideWorld,
  isPanKey,
  isRigidPan,
  panInputFromCodes,
  panModeBinding,
  panOffset,
  panStepDistance,
  shouldIgnoreKeyEvent,
} from "./cameraPan";

describe("isPanKey", () => {
  it("accepts arrows and WASD codes", () => {
    for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]) {
      expect(isPanKey(code)).toBe(true);
    }
  });

  it("rejects other keys", () => {
    for (const code of ["Space", "Enter", "KeyQ", "KeyE", "PageUp", "ShiftLeft", ""]) {
      expect(isPanKey(code)).toBe(false);
    }
  });
});

describe("panInputFromCodes", () => {
  it("maps each key to its screen-space axis", () => {
    expect(panInputFromCodes(["ArrowUp"])).toEqual({ right: 0, forward: 1 });
    expect(panInputFromCodes(["KeyW"])).toEqual({ right: 0, forward: 1 });
    expect(panInputFromCodes(["ArrowDown"])).toEqual({ right: 0, forward: -1 });
    expect(panInputFromCodes(["KeyS"])).toEqual({ right: 0, forward: -1 });
    expect(panInputFromCodes(["ArrowLeft"])).toEqual({ right: -1, forward: 0 });
    expect(panInputFromCodes(["KeyA"])).toEqual({ right: -1, forward: 0 });
    expect(panInputFromCodes(["ArrowRight"])).toEqual({ right: 1, forward: 0 });
    expect(panInputFromCodes(["KeyD"])).toEqual({ right: 1, forward: 0 });
  });

  it("normalizes diagonal input to unit length", () => {
    const input = panInputFromCodes(["KeyW", "KeyD"]);
    expect(Math.hypot(input.right, input.forward)).toBeCloseTo(1, 10);
    expect(input.right).toBeCloseTo(Math.SQRT1_2, 10);
    expect(input.forward).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("cancels opposing keys", () => {
    expect(panInputFromCodes(["KeyW", "KeyS"])).toEqual({ right: 0, forward: 0 });
    expect(panInputFromCodes(["KeyA", "KeyD"])).toEqual({ right: 0, forward: 0 });
    expect(panInputFromCodes(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])).toEqual({
      right: 0,
      forward: 0,
    });
  });

  it("ignores non-pan codes mixed in with pan keys", () => {
    expect(panInputFromCodes(["Space", "KeyW", "Enter"])).toEqual({ right: 0, forward: 1 });
    expect(panInputFromCodes(["Space"])).toEqual({ right: 0, forward: 0 });
    expect(panInputFromCodes([])).toEqual({ right: 0, forward: 0 });
  });

  it("accepts a Set like the live key tracker", () => {
    const input = panInputFromCodes(new Set(["ArrowLeft", "ArrowUp"]));
    expect(input.right).toBeCloseTo(-Math.SQRT1_2, 10);
    expect(input.forward).toBeCloseTo(Math.SQRT1_2, 10);
  });
});

describe("panOffset", () => {
  // Camera south of the target (+Z), looking north (-Z): screen-up is -Z,
  // screen-right is +X.
  const camera = { x: 0, y: 600, z: 1000 };
  const target = { x: 0, y: 0, z: 0 };

  it("pans forward along the camera ground direction", () => {
    const off = panOffset(camera, target, { right: 0, forward: 1 }, 100);
    expect(off.x).toBeCloseTo(0, 10);
    expect(off.z).toBeCloseTo(-100, 10);
  });

  it("pans backward and sideways", () => {
    expect(panOffset(camera, target, { right: 0, forward: -1 }, 100).z).toBeCloseTo(100, 10);
    const right = panOffset(camera, target, { right: 1, forward: 0 }, 100);
    expect(right.x).toBeCloseTo(100, 10);
    expect(right.z).toBeCloseTo(0, 10);
  });

  it("follows a rotated camera", () => {
    // Camera east of the target (+X), looking west: screen-up is -X.
    const off = panOffset({ x: 1000, y: 600, z: 0 }, target, { right: 0, forward: 1 }, 50);
    expect(off.x).toBeCloseTo(-50, 10);
    expect(off.z).toBeCloseTo(0, 10);
  });

  it("falls back to world north when the camera is directly overhead", () => {
    const off = panOffset({ x: 10, y: 600, z: 20 }, { x: 10, y: 0, z: 20 }, { right: 0, forward: 1 }, 100);
    expect(off.x).toBeCloseTo(0, 10);
    expect(off.z).toBeCloseTo(-100, 10);
  });
});

describe("applyPan", () => {
  it("translates camera and target by the same offset", () => {
    const position = { x: 5, y: 600, z: 1000 };
    const target = { x: 0, y: 0, z: 0 };
    applyPan(position, target, { x: 10, z: -20 });
    expect(position).toEqual({ x: 15, y: 600, z: 980 });
    expect(target).toEqual({ x: 10, y: 0, z: -20 });
  });
});

describe("clampPanTarget", () => {
  it("leaves in-bounds targets alone", () => {
    const target = { x: 100, y: 0, z: -200 };
    clampPanTarget(target, 4000, 4000);
    expect(target).toEqual({ x: 100, y: 0, z: -200 });
  });

  it("clamps past the edge margin on every side", () => {
    const bound = (4000 / 2) * (1 + PAN_EDGE_MARGIN);
    const target = { x: 99999, y: 0, z: -99999 };
    clampPanTarget(target, 4000, 4000);
    expect(target.x).toBeCloseTo(bound, 10);
    expect(target.z).toBeCloseTo(-bound, 10);
  });

  it("supports non-square maps", () => {
    const target = { x: 99999, y: 0, z: 99999 };
    clampPanTarget(target, 2000, 4000);
    expect(target.x).toBeCloseTo(1000 * (1 + PAN_EDGE_MARGIN), 10);
    expect(target.z).toBeCloseTo(2000 * (1 + PAN_EDGE_MARGIN), 10);
  });
});

describe("clampPanTargetWithCamera", () => {
  const bound = (4000 / 2) * (1 + PAN_EDGE_MARGIN);

  it("stops at the edge and retains the viewing angle", () => {
    // Target already at the north bound, camera south of it: panning
    // further north must move neither — the old target-only clamp let the
    // camera keep travelling past the stuck target and flip the view.
    const target = { x: 0, y: 0, z: -bound };
    const position = { x: 0, y: 600, z: -bound + 1000 };
    const before = { x: position.x - target.x, y: position.y - target.y, z: position.z - target.z };
    applyPan(position, target, { x: 0, z: -500 });
    clampPanTargetWithCamera(target, position, 4000, 4000);
    expect(target.z).toBeCloseTo(-bound, 10);
    expect(position.x - target.x).toBeCloseTo(before.x, 10);
    expect(position.y - target.y).toBeCloseTo(before.y, 10);
    expect(position.z - target.z).toBeCloseTo(before.z, 10);
  });

  it("stops both axes at a corner without rotating", () => {
    const target = { x: bound, y: 0, z: -bound };
    const position = { x: bound - 700, y: 600, z: -bound + 700 };
    const before = { x: position.x - target.x, z: position.z - target.z };
    applyPan(position, target, { x: 400, z: -400 });
    clampPanTargetWithCamera(target, position, 4000, 4000);
    expect(target.x).toBeCloseTo(bound, 10);
    expect(target.z).toBeCloseTo(-bound, 10);
    expect(position.x - target.x).toBeCloseTo(before.x, 10);
    expect(position.z - target.z).toBeCloseTo(before.z, 10);
  });

  it("slides along a blocked edge instead of sticking", () => {
    // At the east bound, panning south-east keeps the free (south)
    // component and drops only the blocked (east) one.
    const target = { x: bound, y: 0, z: 0 };
    const position = { x: bound - 1000, y: 600, z: 1000 };
    applyPan(position, target, { x: 300, z: 200 });
    clampPanTargetWithCamera(target, position, 4000, 4000);
    expect(target.x).toBeCloseTo(bound, 10);
    expect(target.z).toBeCloseTo(200, 10);
    expect(position.x - target.x).toBeCloseTo(-1000, 10);
    expect(position.z - target.z).toBeCloseTo(1000, 10);
  });

  it("leaves in-bounds pans untouched", () => {
    const target = { x: 100, y: 0, z: -200 };
    const position = { x: 100, y: 600, z: 800 };
    applyPan(position, target, { x: 10, z: -20 });
    clampPanTargetWithCamera(target, position, 4000, 4000);
    expect(target).toEqual({ x: 110, y: 0, z: -220 });
    expect(position).toEqual({ x: 110, y: 600, z: 780 });
  });

  it("never moves the camera height", () => {
    const target = { x: 99999, y: 50, z: -99999 };
    const position = { x: 0, y: 600, z: 1000 };
    clampPanTargetWithCamera(target, position, 4000, 4000);
    expect(position.y).toBe(600);
    expect(target.y).toBe(50);
  });
});

describe("clampCameraToWorld", () => {
  // Standard 320x256 map: world 5104x4080, target rectangle ±3190 x ±2550.
  const worldW = 5104;
  const worldD = 4080;
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);

  it("uses the same virtual rectangle as the orbit target", () => {
    expect(bx).toBeCloseTo(3190, 10);
    expect(bz).toBeCloseTo(2550, 10);
  });

  it("leaves in-bounds positions alone", () => {
    const position = { x: 100, y: 1200, z: -200 };
    clampCameraToWorld(position, worldW, worldD);
    expect(position).toEqual({ x: 100, y: 1200, z: -200 });
  });

  it("contains the opening frame (up to 350 past the map edge)", () => {
    // commanderCameraPose starts the camera past the map edge looking in;
    // the rectangle must swallow that pose or the first tick would snap it.
    expect(worldW / 2 + 350).toBeLessThan(bx);
    expect(worldD / 2 + 350).toBeLessThan(bz);
    const position = { x: worldW / 2 + 350, y: 1300, z: -(worldD / 2 + 350) };
    clampCameraToWorld(position, worldW, worldD);
    expect(position.x).toBeCloseTo(worldW / 2 + 350, 10);
    expect(position.z).toBeCloseTo(-(worldD / 2 + 350), 10);
  });

  it("clamps past the edge margin on every side, per axis", () => {
    const position = { x: 99999, y: 1200, z: 200 };
    clampCameraToWorld(position, worldW, worldD);
    expect(position.x).toBeCloseTo(bx, 10);
    expect(position.z).toBe(200);
    const other = { x: -100, y: 1200, z: -99999 };
    clampCameraToWorld(other, worldW, worldD);
    expect(other.x).toBe(-100);
    expect(other.z).toBeCloseTo(-bz, 10);
  });

  it("clamps both axes at a corner", () => {
    const position = { x: -99999, y: 1200, z: 99999 };
    clampCameraToWorld(position, worldW, worldD);
    expect(position.x).toBeCloseTo(-bx, 10);
    expect(position.z).toBeCloseTo(bz, 10);
  });

  it("never moves the camera height", () => {
    const position = { x: 99999, y: 1200, z: -99999 };
    clampCameraToWorld(position, worldW, worldD);
    expect(position.y).toBe(1200);
  });

  it("supports non-square maps", () => {
    const position = { x: 99999, y: 500, z: 99999 };
    clampCameraToWorld(position, 2000, 4000);
    expect(position.x).toBeCloseTo(1000 * (1 + PAN_EDGE_MARGIN), 10);
    expect(position.z).toBeCloseTo(2000 * (1 + PAN_EDGE_MARGIN), 10);
  });

  it("pulls an orbited-out camera back while the clamped target stays put", () => {
    // The reported bug: target pinned at its bound, camera swung thousands
    // of units past the edge by orbiting at far zoom. The tick order is
    // clampPanTargetWithCamera first (no-op here — target already inside),
    // then the camera clamp reels the camera in without touching the target.
    const target = { x: 0, y: 0, z: 0 };
    const position = { x: 0, y: 1500, z: 6000 };
    clampPanTargetWithCamera(target, position, worldW, worldD);
    clampCameraToWorld(position, worldW, worldD);
    expect(target).toEqual({ x: 0, y: 0, z: 0 });
    expect(position.x).toBe(0);
    expect(position.z).toBeCloseTo(bz, 10);
    expect(position.y).toBe(1500);
  });

  it("holds both at the edge when a pan pushes past together", () => {
    // Keyboard/right-drag pans translate target and camera by the same
    // offset; at the edge the target stops with the angle retained and the
    // camera ends inside the rectangle too.
    const target = { x: bx - 100, y: 0, z: 0 };
    const position = { x: bx - 1100, y: 1200, z: 1000 };
    applyPan(position, target, { x: 500, z: 0 });
    clampPanTargetWithCamera(target, position, worldW, worldD);
    clampCameraToWorld(position, worldW, worldD);
    expect(target.x).toBeCloseTo(bx, 10);
    expect(position.x - target.x).toBeCloseTo(-1000, 10);
    expect(Math.abs(position.x)).toBeLessThanOrEqual(bx);
    expect(Math.abs(position.z)).toBeLessThanOrEqual(bz);
  });
});

describe("clampCameraToWorldWithTarget", () => {
  // Standard 320x256 map: world 5104x4080, camera rectangle ±3190 x ±2550.
  const worldW = 5104;
  const worldD = 4080;
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);

  it("stops a pan-back at the wall and retains the viewing angle", () => {
    // Camera south of the target, both stepping +Z: the camera reaches the
    // south bound first and the target must stop with it — the old
    // target-agnostic clamp pinned the camera while the target kept
    // advancing until it caught the camera and warped the angle.
    const target = { x: 0, y: 0, z: bz - 1500 };
    const position = { x: 0, y: 1200, z: bz - 500 };
    const before = { x: position.x - target.x, y: position.y - target.y, z: position.z - target.z };
    applyPan(position, target, { x: 0, z: 800 });
    clampPanTargetWithCamera(target, position, worldW, worldD);
    clampCameraToWorldWithTarget(position, target, worldW, worldD);
    expect(position.z).toBeCloseTo(bz, 10);
    expect(target.z).toBeLessThan(position.z);
    expect(position.x - target.x).toBeCloseTo(before.x, 10);
    expect(position.y - target.y).toBeCloseTo(before.y, 10);
    expect(position.z - target.z).toBeCloseTo(before.z, 10);
  });

  it("stops both axes at a corner without rotating", () => {
    const target = { x: bx - 1000, y: 0, z: bz - 1000 };
    const position = { x: bx - 300, y: 1200, z: bz - 300 };
    const before = { x: position.x - target.x, z: position.z - target.z };
    applyPan(position, target, { x: 500, z: 500 });
    clampPanTargetWithCamera(target, position, worldW, worldD);
    clampCameraToWorldWithTarget(position, target, worldW, worldD);
    expect(position.x).toBeCloseTo(bx, 10);
    expect(position.z).toBeCloseTo(bz, 10);
    expect(position.x - target.x).toBeCloseTo(before.x, 10);
    expect(position.z - target.z).toBeCloseTo(before.z, 10);
  });

  it("slides along the wall instead of sticking", () => {
    // Camera at the south bound, panning south-east: the free (east)
    // component survives and only the blocked (south) one is dropped.
    const target = { x: 0, y: 0, z: bz - 1000 };
    const position = { x: -1000, y: 1200, z: bz };
    applyPan(position, target, { x: 300, z: 200 });
    clampPanTargetWithCamera(target, position, worldW, worldD);
    clampCameraToWorldWithTarget(position, target, worldW, worldD);
    expect(position.z).toBeCloseTo(bz, 10);
    expect(position.x).toBeCloseTo(-700, 10);
    expect(target.x).toBeCloseTo(300, 10);
    expect(position.x - target.x).toBeCloseTo(-1000, 10);
    expect(position.z - target.z).toBeCloseTo(1000, 10);
  });

  it("leaves in-bounds pans untouched", () => {
    const target = { x: 100, y: 0, z: -200 };
    const position = { x: 100, y: 1200, z: 800 };
    applyPan(position, target, { x: 10, z: -20 });
    clampPanTargetWithCamera(target, position, 5104, 4080);
    clampCameraToWorldWithTarget(position, target, 5104, 4080);
    expect(target).toEqual({ x: 110, y: 0, z: -220 });
    expect(position).toEqual({ x: 110, y: 1200, z: 780 });
  });

  it("never moves heights", () => {
    const target = { x: 0, y: 50, z: 0 };
    const position = { x: 99999, y: 1200, z: 99999 };
    clampCameraToWorldWithTarget(position, target, worldW, worldD);
    expect(position.y).toBe(1200);
    expect(target.y).toBe(50);
  });
});

describe("pan-back wall regression (task 136)", () => {
  const worldW = 5104;
  const worldD = 4080;
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);

  it("holds the camera-target offset through a sustained pan-back (no warp)", () => {
    // Camera south of the target, panning backwards (+Z) step after step
    // through the keyboard-pan tick order: every step must keep pushing
    // +Z (a snapped direction is the warp), and the wall must park the
    // camera at the south bound with the target a full offset ahead of it.
    const target = { x: 0, y: 0, z: 0 };
    const position = { x: 0, y: 1200, z: 1000 };
    for (let i = 0; i < 40; i++) {
      const off = panOffset(position, target, { right: 0, forward: -1 }, 500);
      expect(off.x).toBeCloseTo(0, 10);
      expect(off.z).toBeCloseTo(500, 10);
      applyPan(position, target, off);
      clampPanTargetWithCamera(target, position, worldW, worldD);
      clampCameraToWorldWithTarget(position, target, worldW, worldD);
    }
    expect(position.z).toBeCloseTo(bz, 10);
    expect(target.z).toBeCloseTo(bz - 1000, 10);
    expect(position.x - target.x).toBeCloseTo(0, 10);
    expect(position.z - target.z).toBeCloseTo(1000, 10);
  });

  it("contrast: the target-agnostic camera clamp lets the target catch the camera (the warp)", () => {
    // The pre-fix tick order for pans: the camera pins at the south bound
    // while the target keeps advancing, until target and camera coincide
    // on the ground plane — the forward basis collapses and the view snaps
    // top-down. Pan paths must use the carrying clamp instead; the plain
    // one stays for orbit/zoom reel-in only.
    const target = { x: 0, y: 0, z: 0 };
    const position = { x: 0, y: 1200, z: 1000 };
    for (let i = 0; i < 12; i++) {
      const off = panOffset(position, target, { right: 0, forward: -1 }, 500);
      applyPan(position, target, off);
      clampPanTargetWithCamera(target, position, worldW, worldD);
      clampCameraToWorld(position, worldW, worldD);
    }
    expect(position.z).toBeCloseTo(bz, 10);
    expect(target.z).toBeCloseTo(bz, 10);
    expect(Math.hypot(position.x - target.x, position.z - target.z)).toBeLessThan(1);
  });
});

describe("isRigidPan", () => {
  it("reads true when target and camera move by the same delta", () => {
    expect(isRigidPan(300, 200, 300, 200)).toBe(true);
    expect(isRigidPan(-50, 0, -50, 0)).toBe(true);
    expect(isRigidPan(0, -120.5, 0, -120.5)).toBe(true);
  });

  it("tolerates float64 rounding of identical pan offsets", () => {
    expect(RIGID_PAN_EPSILON).toBe(1e-6);
    expect(isRigidPan(300, 200, 300 + 1e-9, 200 - 1e-9)).toBe(true);
    expect(isRigidPan(100, 100, 100 + RIGID_PAN_EPSILON, 100)).toBe(true);
    expect(isRigidPan(100, 100, 100 + RIGID_PAN_EPSILON * 1.1, 100)).toBe(false);
  });

  it("reads false when the target is stationary (orbit, zoom, quiet ticks)", () => {
    expect(isRigidPan(0, 0, 0, 0)).toBe(false);
    // A pure orbit swings the camera around a fixed target: reel-in, not wall.
    expect(isRigidPan(0, 0, 50, -30)).toBe(false);
  });

  it("reads false when target and camera move apart (cursor-anchored zoom)", () => {
    // Dollying out while the target migrates toward the cursor: the camera
    // travels far, the target only slightly — the focus must stay put.
    expect(isRigidPan(10, 5, 300, 150)).toBe(false);
    expect(isRigidPan(300, 200, 300, -200)).toBe(false);
  });
});

describe("isCameraOutsideWorld", () => {
  // Same rectangle the clamp enforces: ±3190 x ±2550 on the 320x256 map.
  const worldW = 5104;
  const worldD = 4080;
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);

  it("reads false inside the rectangle and on its boundary", () => {
    expect(isCameraOutsideWorld({ x: 0, y: 1200, z: 0 }, worldW, worldD)).toBe(false);
    expect(isCameraOutsideWorld({ x: bx, y: 0, z: -bz }, worldW, worldD)).toBe(false);
    expect(isCameraOutsideWorld({ x: -bx, y: 9999, z: bz }, worldW, worldD)).toBe(false);
  });

  it("reads true past any edge, per axis", () => {
    expect(isCameraOutsideWorld({ x: bx + 1, y: 0, z: 0 }, worldW, worldD)).toBe(true);
    expect(isCameraOutsideWorld({ x: 0, y: 0, z: -bz - 1 }, worldW, worldD)).toBe(true);
    expect(isCameraOutsideWorld({ x: -(bx + 1), y: 0, z: bz + 1 }, worldW, worldD)).toBe(true);
  });

  it("ignores height like the clamp", () => {
    expect(isCameraOutsideWorld({ x: 0, y: 99999, z: 0 }, worldW, worldD)).toBe(false);
    expect(isCameraOutsideWorld({ x: bx + 1, y: -99999, z: 0 }, worldW, worldD)).toBe(true);
  });

  it("agrees with the clamp: it fires exactly where the clamp would move the camera", () => {
    // The minimap-jump exemption (task 120) clears on re-entry through
    // this predicate, so it must match the clamp bound exactly — a
    // mismatch would either yank fresh jumps or exempt gradual drift.
    const points = [
      { x: bx, z: bz },
      { x: bx + 0.5, z: bz },
      { x: bx, z: -(bz + 0.5) },
      { x: 5662, z: 300 },
      { x: -1600, z: 2900 },
      { x: 1482, z: 400 },
    ];
    for (const { x, z } of points) {
      const position = { x, y: 1200, z };
      const before = { ...position };
      clampCameraToWorld(position, worldW, worldD);
      const moved = position.x !== before.x || position.z !== before.z;
      expect(isCameraOutsideWorld(before, worldW, worldD)).toBe(moved);
    }
  });
});

describe("shouldIgnoreKeyEvent", () => {
  it("ignores editable controls", () => {
    expect(shouldIgnoreKeyEvent({ tagName: "INPUT" })).toBe(true);
    expect(shouldIgnoreKeyEvent({ tagName: "textarea" })).toBe(true);
    expect(shouldIgnoreKeyEvent({ tagName: "SELECT" })).toBe(true);
    expect(shouldIgnoreKeyEvent({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("allows canvas, body, and null targets", () => {
    expect(shouldIgnoreKeyEvent({ tagName: "CANVAS" })).toBe(false);
    expect(shouldIgnoreKeyEvent({ tagName: "BODY" })).toBe(false);
    expect(shouldIgnoreKeyEvent({})).toBe(false);
    expect(shouldIgnoreKeyEvent(null)).toBe(false);
    expect(shouldIgnoreKeyEvent(undefined)).toBe(false);
  });
});

describe("camera speed sliders", () => {
  it("defaults both sliders to 1x inside the 0.2x–3x range", () => {
    expect(DEFAULT_PAN_SPEED).toBe(1);
    expect(DEFAULT_ZOOM_SPEED).toBe(1);
    expect(PAN_SPEED_MIN).toBe(0.2);
    expect(PAN_SPEED_MAX).toBe(3);
    expect(ZOOM_SPEED_MIN).toBe(0.2);
    expect(ZOOM_SPEED_MAX).toBe(3);
  });

  it("carries the absolute feel in base speeds (pan 1.215x, zoom 4x)", () => {
    // Pan 1x is the old 0.3x feel (1.215 absolute = 4.05 × 0.3, task
    // 140); zoom 1x doubles the old 2x default, so the slider reads 1x
    // while zooming 2x faster than before.
    expect(PAN_BASE_SPEED).toBe(1.215);
    expect(ZOOM_BASE_SPEED).toBe(4);
    expect(effectivePanSpeed(DEFAULT_PAN_SPEED)).toBe(1.215);
    expect(effectiveZoomSpeed(DEFAULT_ZOOM_SPEED)).toBe(4);
  });

  it("clamps pan speed into range", () => {
    expect(clampPanSpeed(1)).toBe(1);
    expect(clampPanSpeed(0.2)).toBe(0.2);
    expect(clampPanSpeed(3)).toBe(3);
    expect(clampPanSpeed(-5)).toBe(PAN_SPEED_MIN);
    expect(clampPanSpeed(99)).toBe(PAN_SPEED_MAX);
  });

  it("clamps zoom speed into range around the 1x default", () => {
    expect(clampZoomSpeed(2)).toBe(2);
    expect(clampZoomSpeed(1)).toBe(1);
    expect(clampZoomSpeed(-5)).toBe(ZOOM_SPEED_MIN);
    expect(clampZoomSpeed(99)).toBe(ZOOM_SPEED_MAX);
  });

  it("falls back to the defaults on non-finite input", () => {
    expect(clampPanSpeed(NaN)).toBe(DEFAULT_PAN_SPEED);
    expect(clampPanSpeed(Infinity)).toBe(DEFAULT_PAN_SPEED);
    expect(clampZoomSpeed(NaN)).toBe(DEFAULT_ZOOM_SPEED);
    expect(clampZoomSpeed(-Infinity)).toBe(DEFAULT_ZOOM_SPEED);
    expect(DEFAULT_ZOOM_SPEED).toBe(1);
  });

  it("scales effective speeds linearly with the slider after clamping", () => {
    expect(effectivePanSpeed(2)).toBeCloseTo(effectivePanSpeed(1) * 2, 10);
    expect(effectivePanSpeed(0.5)).toBeCloseTo(effectivePanSpeed(1) * 0.5, 10);
    expect(effectiveZoomSpeed(2)).toBeCloseTo(effectiveZoomSpeed(1) * 2, 10);
    expect(effectiveZoomSpeed(0.5)).toBeCloseTo(effectiveZoomSpeed(1) * 0.5, 10);
    expect(effectivePanSpeed(99)).toBe(PAN_SPEED_MAX * PAN_BASE_SPEED);
    expect(effectivePanSpeed(-1)).toBe(PAN_SPEED_MIN * PAN_BASE_SPEED);
    expect(effectiveZoomSpeed(99)).toBe(ZOOM_SPEED_MAX * ZOOM_BASE_SPEED);
    expect(effectiveZoomSpeed(-1)).toBe(ZOOM_SPEED_MIN * ZOOM_BASE_SPEED);
    expect(effectivePanSpeed(NaN)).toBe(DEFAULT_PAN_SPEED * PAN_BASE_SPEED);
    expect(effectiveZoomSpeed(NaN)).toBe(DEFAULT_ZOOM_SPEED * ZOOM_BASE_SPEED);
  });

  it("scales the keyboard pan step linearly with the speed multiplier", () => {
    const base = panStepDistance(1000, 0.016, 1);
    expect(base).toBeCloseTo(1000 * PAN_SPEED_FACTOR * PAN_BASE_SPEED * 0.016, 10);
    expect(panStepDistance(1000, 0.016, 2)).toBeCloseTo(base * 2, 10);
    expect(panStepDistance(1000, 0.016, 0.5)).toBeCloseTo(base * 0.5, 10);
  });

  it("makes new 1x equal the old 0.3x pan feel", () => {
    // The base factor is untouched; the whole change lives in PAN_BASE_SPEED
    // so keyboard and right-drag panning scale together: new 1x equals the
    // pre-task-140 0.3x position (4.05 × 0.3 = 1.215, compared loosely —
    // the product is 1 ulp off the literal).
    expect(DEFAULT_PAN_SPEED).toBe(1);
    expect(PAN_SPEED_FACTOR).toBe(1.2);
    expect(panStepDistance(1000, 0.016, DEFAULT_PAN_SPEED)).toBeCloseTo(1000 * 1.2 * 1.215 * 0.016, 10);
    expect(effectivePanSpeed(1)).toBeCloseTo(4.05 * 0.3, 10);
  });

  it("clamps out-of-range speeds before stepping", () => {
    expect(panStepDistance(1000, 0.016, 99)).toBeCloseTo(
      panStepDistance(1000, 0.016, PAN_SPEED_MAX),
      10,
    );
    expect(panStepDistance(1000, 0.016, -1)).toBeCloseTo(
      panStepDistance(1000, 0.016, PAN_SPEED_MIN),
      10,
    );
  });

  it("stays put with zero distance or zero dt", () => {
    expect(panStepDistance(0, 0.016, 2)).toBe(0);
    expect(panStepDistance(1000, 0, 2)).toBe(0);
  });

  it("bounds the wheel-zoom range from close-up to whole-map", () => {
    // Full hull plus surrounding ground at the 48° field of view.
    expect(MIN_ZOOM_DISTANCE).toBe(60);
    expect(MIN_ZOOM_DISTANCE).toBeGreaterThan(14);
    expect(MIN_ZOOM_DISTANCE).toBeGreaterThan(2 * 5);
    // Whole-map ceiling for the doubled 320x256 field.
    expect(MAX_ZOOM_DISTANCE).toBe(8400);
    expect(MAX_ZOOM_DISTANCE).toBeGreaterThan(MIN_ZOOM_DISTANCE);
  });
});

describe("world-bounds wiring in TerrainCanvas", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const canvasSource = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");

  it("holds the camera inside the world rectangle on every clamp site", () => {
    // Clamping only the orbit target still lets orbiting/zooming swing the
    // camera off the map, so the tick must clamp the camera position too —
    // once after keyboard pan, once after the follow-battle glide (the same
    // rigid-translation path), once after controls.update() (right-drag pan,
    // orbit, cursor-anchored zoom, and minimap jumps all flow through it).
    // Rigid pans carry the target with the clamped camera delta (the
    // pan-back wall); only the orbit/zoom branch reels the camera in alone.
    const carrying =
      canvasSource.match(/clampCameraToWorldWithTarget\(camera\.position/g) ?? [];
    const plain = canvasSource.match(/clampCameraToWorld\(camera\.position/g) ?? [];
    expect(carrying).toHaveLength(3);
    expect(plain).toHaveLength(1);
  });

  it("picks the pan-back wall vs the orbit reel-in through the rigid-pan check", () => {
    // The post-update site snapshots the pre-update pose and branches on
    // isRigidPan: right-drag pans (target and camera translated together)
    // hit the wall with the angle retained, while orbit/zoom motion reels
    // the camera in with the focus point staying put.
    expect(canvasSource).toContain("isRigidPan(");
    expect(canvasSource).toMatch(/if \(rigidPan\) clampCameraToWorldWithTarget\(camera\.position/);
    expect(canvasSource).toMatch(/else clampCameraToWorld\(camera\.position/);
  });
});

describe("pan-back wall through real OrbitControls (task 136)", () => {
  // Headless tick-chain through REAL OrbitControls with the canvas settings
  // (damping, polar clamp, zoom-to-cursor): snapshot → pan → rigid-pan
  // branch → clamps. controls.pan() is the programmatic equivalent of a
  // right-drag (same _panOffset path _handleMouseMovePan feeds).
  const worldW = 5104;
  const worldD = 4080;
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);

  function makePanRig(pos: { x: number; y: number; z: number }, tgt: { x: number; y: number; z: number }) {
    const doc = { addEventListener() {}, removeEventListener() {} };
    const el = {
      style: {},
      clientWidth: 1200,
      clientHeight: 800,
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

  function tickPanBack(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ): { rigid: boolean; dx: number; dy: number; dz: number } {
    // Mirrors the TerrainCanvas post-update order: the render step refreshes
    // the camera matrix first (pan math reads object.matrix), then the tick
    // snapshots the pose, runs the update, and clamps through the branch.
    camera.updateMatrixWorld();
    const preTargetX = controls.target.x;
    const preTargetZ = controls.target.z;
    const prePosX = camera.position.x;
    const prePosZ = camera.position.z;
    controls.pan(0, -120);
    const rigid = isRigidPan(
      controls.target.x - preTargetX,
      controls.target.z - preTargetZ,
      camera.position.x - prePosX,
      camera.position.z - prePosZ,
    );
    clampPanTargetWithCamera(controls.target, camera.position, worldW, worldD);
    if (rigid) clampCameraToWorldWithTarget(camera.position, controls.target, worldW, worldD);
    else clampCameraToWorld(camera.position, worldW, worldD);
    return {
      rigid,
      dx: camera.position.x - controls.target.x,
      dy: camera.position.y - controls.target.y,
      dz: camera.position.z - controls.target.z,
    };
  }

  it("stops a sustained drag pan-back at the wall with the angle retained", () => {
    // Camera south of the target; pan(0,-px) drags the view backwards (+Z).
    const { camera, controls } = makePanRig({ x: 0, y: 1200, z: 1000 }, { x: 0, y: 100, z: 0 });
    const before = {
      x: camera.position.x - controls.target.x,
      y: camera.position.y - controls.target.y,
      z: camera.position.z - controls.target.z,
    };
    for (let tick = 0; tick < 60; tick++) {
      const { rigid, dx, dy, dz } = tickPanBack(camera, controls);
      // A damped drag pan translates target and camera together every frame.
      expect(rigid).toBe(true);
      // The target never catches the camera: the ground-plane separation
      // stays whole the entire way into the wall.
      expect(Math.hypot(dx, dz)).toBeCloseTo(1000, 6);
      expect(dy).toBeCloseTo(before.y, 6);
    }
    expect(camera.position.z).toBeCloseTo(bz, 6);
    expect(controls.target.z).toBeCloseTo(bz - 1000, 6);
    expect(camera.position.x - controls.target.x).toBeCloseTo(before.x, 6);
    expect(camera.position.y - controls.target.y).toBeCloseTo(before.y, 6);
    expect(camera.position.z - controls.target.z).toBeCloseTo(before.z, 6);
  });

  it("reels in an orbited-out camera without moving the focus (orbit branch)", () => {
    // No pan input: a quiet update moves nothing, the branch reads rigid =
    // false, and the plain clamp reels the camera back while the clamped
    // target stays put — the task-118 protection is intact.
    const { camera, controls } = makePanRig({ x: 0, y: 1500, z: 6000 }, { x: 0, y: 0, z: 0 });
    const preTargetX = controls.target.x;
    const preTargetZ = controls.target.z;
    const prePosX = camera.position.x;
    const prePosZ = camera.position.z;
    controls.update();
    const rigid = isRigidPan(
      controls.target.x - preTargetX,
      controls.target.z - preTargetZ,
      camera.position.x - prePosX,
      camera.position.z - prePosZ,
    );
    expect(rigid).toBe(false);
    clampPanTargetWithCamera(controls.target, camera.position, worldW, worldD);
    if (rigid) clampCameraToWorldWithTarget(camera.position, controls.target, worldW, worldD);
    else clampCameraToWorld(camera.position, worldW, worldD);
    expect(camera.position.z).toBeCloseTo(bz, 6);
    expect(controls.target.x).toBeCloseTo(0, 9);
    expect(controls.target.z).toBeCloseTo(0, 9);
  });
});

describe("clampCameraAboveSurface", () => {
  it("lifts a buried eye to the surface plus the default clearance", () => {
    const position = { x: 10, y: 95, z: -30 };
    clampCameraAboveSurface(position, 100);
    expect(position).toEqual({ x: 10, y: 100 + CAMERA_SURFACE_CLEARANCE, z: -30 });
  });

  it("leaves a high eye alone and never touches X/Z", () => {
    const position = { x: 10, y: 500, z: -30 };
    clampCameraAboveSurface(position, 100);
    expect(position).toEqual({ x: 10, y: 500, z: -30 });
  });

  it("holds an eye resting exactly on the floor", () => {
    const position = { x: 0, y: 100 + CAMERA_SURFACE_CLEARANCE, z: 0 };
    clampCameraAboveSurface(position, 100);
    expect(position.y).toBe(100 + CAMERA_SURFACE_CLEARANCE);
  });

  it("honors an explicit clearance override", () => {
    const position = { x: 0, y: 0, z: 0 };
    clampCameraAboveSurface(position, 100, 2);
    expect(position.y).toBe(102);
  });

  it("ignores non-finite surfaces and clearances instead of NaN-ing the camera", () => {
    for (const surfaceY of [NaN, Infinity, -Infinity]) {
      const position = { x: 1, y: 2, z: 3 };
      clampCameraAboveSurface(position, surfaceY);
      expect(position).toEqual({ x: 1, y: 2, z: 3 });
    }
    const position = { x: 1, y: 2, z: 3 };
    clampCameraAboveSurface(position, 100, NaN);
    expect(position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("sizes the clearance between the near plane and the zoom floor", () => {
    // Above the 2-unit near plane (and the ~2-unit swell crests) with
    // margin, so the eye and its frustum stay out of the surface — yet
    // well under the 30-unit zoom floor, so typical close-ups of a
    // surface-seated target never touch this clamp.
    expect(CAMERA_SURFACE_CLEARANCE).toBe(6);
    expect(CAMERA_SURFACE_CLEARANCE).toBeGreaterThan(2 * 2);
    expect(CAMERA_SURFACE_CLEARANCE).toBeLessThan(MIN_ZOOM_DISTANCE);
  });
});

describe("clampTargetAboveSurface", () => {
  it("lifts a sunken focus to the surface with zero clearance", () => {
    // The focus may rest exactly on the dirt (unlike the eye, it needs no
    // room for a near plane) — the same seating minimap jumps use.
    const target = { x: 10, y: -400, z: -30 };
    clampTargetAboveSurface(target, 100);
    expect(target).toEqual({ x: 10, y: 100, z: -30 });
  });

  it("leaves a surface-or-higher focus alone and never touches X/Z", () => {
    for (const y of [100, 500]) {
      const target = { x: 10, y, z: -30 };
      clampTargetAboveSurface(target, 100);
      expect(target).toEqual({ x: 10, y, z: -30 });
    }
  });

  it("ignores non-finite surfaces instead of NaN-ing the focus", () => {
    for (const surfaceY of [NaN, Infinity, -Infinity]) {
      const target = { x: 1, y: 2, z: 3 };
      clampTargetAboveSurface(target, surfaceY);
      expect(target).toEqual({ x: 1, y: 2, z: 3 });
    }
  });
});


describe("camera wall-time and close-up navigation", () => {
  it.each([4, 10, 20, 60, 144])("pans the same distance per real second at %i FPS", fps => {
    let travelled = 0;
    for (let i = 0; i < fps; i++) travelled += panStepDistance(1000, cameraFrameDelta(1 / fps), 1);
    expect(travelled).toBeCloseTo(panStepDistance(1000, 1, 1), 8);
  });

  it("discards long stalls and invalid time", () => {
    expect(cameraFrameDelta(10)).toBe(0.25);
    expect(cameraFrameDelta(NaN)).toBe(0);
    expect(cameraFrameDelta(-1)).toBe(0);
  });

  it("keeps keyboard and drag speed useful at close zoom without changing wide views", () => {
    for (const distance of [MIN_ZOOM_DISTANCE, 100, MIN_PAN_DISTANCE, 1000]) {
      expect(panStepDistance(distance, 1, 1)).toBeCloseTo(
        distance * PAN_SPEED_FACTOR * effectiveDragPanSpeed(1, distance), 10,
      );
    }
    expect(panStepDistance(MIN_ZOOM_DISTANCE, 1, 1)).toBeGreaterThan(200);
    expect(effectiveDragPanSpeed(1, 1000)).toBe(effectivePanSpeed(1));
  });

  it("wires keyboard motion to wall time rather than the battle's capped dt", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TerrainCanvas.tsx"), "utf8");
    expect(source).toContain("cameraFrameDelta(wallDelta)");
    expect(source).toContain("panStepDistance(dist, cameraDt, opt.panSpeed)");
    expect(source).toContain("effectiveDragPanSpeed(opt.panSpeed, camera.position.distanceTo(controls.target))");
  });
});

describe("panModeBinding", () => {
  it("keeps the stock orbit mapping with rotation enabled when off", () => {
    expect(panModeBinding(false)).toEqual({ enableRotate: true, left: "rotate", oneFinger: "rotate" });
  });

  it("locks rotation and repoints the orbit gestures at pan when on", () => {
    expect(panModeBinding(true)).toEqual({ enableRotate: false, left: "pan", oneFinger: "pan" });
  });
});

describe("pan mode through real OrbitControls", () => {
  // Synthetic drags through REAL OrbitControls with the canvas settings
  // (damping, polar clamp, zoom-to-cursor): the stub element only needs a
  // listener registry — pointerdown lands on the element, while move/up
  // land on the owner document, exactly like the browser capture path.
  interface DragEvent {
    pointerId: number;
    pointerType: string;
    button: number;
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  }

  function makeDragRig() {
    const elListeners = new Map<string, Set<(e: DragEvent) => void>>();
    const docListeners = new Map<string, Set<(e: DragEvent) => void>>();
    const track =
      (map: Map<string, Set<(e: DragEvent) => void>>) =>
      (type: string, fn: (e: DragEvent) => void): void => {
        let set = map.get(type);
        if (!set) {
          set = new Set();
          map.set(type, set);
        }
        set.add(fn);
      };
    const untrack =
      (map: Map<string, Set<(e: DragEvent) => void>>) =>
      (type: string, fn: (e: DragEvent) => void): void => {
        map.get(type)?.delete(fn);
      };
    const doc = {
      addEventListener: track(docListeners),
      removeEventListener: untrack(docListeners),
    };
    const el = {
      style: {} as Record<string, string>,
      clientWidth: 1200,
      clientHeight: 800,
      ownerDocument: doc,
      getRootNode: () => doc,
      addEventListener: track(elListeners),
      removeEventListener: untrack(elListeners),
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    };
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 2, 14000);
    camera.position.set(0, 1200, 1000);
    const controls = new OrbitControls(camera, el as unknown as HTMLElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.zoomToCursor = true;
    controls.target.set(0, 100, 0);
    controls.update();
    const emit = (type: string, e: DragEvent): void => {
      for (const fn of elListeners.get(type) ?? []) fn(e);
      for (const fn of docListeners.get(type) ?? []) fn(e);
    };
    const applyBinding = (panMode: boolean): void => {
      // Same translation the canvas tick performs.
      const binding = panModeBinding(panMode);
      controls.enableRotate = binding.enableRotate;
      controls.mouseButtons.LEFT = binding.left === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      controls.touches.ONE = binding.oneFinger === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    };
    const drag = (
      x0: number, y0: number, x1: number, y1: number,
      opts: { pointerType?: string; button?: number; pointerId?: number } = {},
    ): void => {
      const { pointerType = "mouse", button = 0, pointerId = 1 } = opts;
      camera.updateMatrixWorld();
      // Touch handlers read pageX/pageY, mouse handlers clientX/clientY.
      const at = (clientX: number, clientY: number): DragEvent => ({
        pointerId, pointerType, button, clientX, clientY, pageX: clientX, pageY: clientY,
      });
      emit("pointerdown", at(x0, y0));
      emit("pointermove", at(x1, y1));
      emit("pointerup", at(x1, y1));
      controls.update();
    };
    return { camera, controls, applyBinding, drag };
  }

  it("orbits on left-drag by default: the target stays, the camera swings", () => {
    const { camera, controls, drag } = makeDragRig();
    const preTarget = controls.target.clone();
    const prePos = camera.position.clone();
    drag(600, 400, 700, 400);
    expect(controls.target.x).toBeCloseTo(preTarget.x, 9);
    expect(controls.target.y).toBeCloseTo(preTarget.y, 9);
    expect(controls.target.z).toBeCloseTo(preTarget.z, 9);
    expect(camera.position.distanceTo(prePos)).toBeGreaterThan(1);
  });

  it("pans on left-drag in pan mode: a rigid translation, angle locked", () => {
    const { camera, controls, applyBinding, drag } = makeDragRig();
    applyBinding(true);
    const preTarget = controls.target.clone();
    const preOffset = camera.position.clone().sub(controls.target);
    drag(600, 400, 700, 400);
    // The focus travelled with the drag…
    expect(controls.target.distanceTo(preTarget)).toBeGreaterThan(1);
    // …while the position→target offset (yaw/pitch/distance) survived.
    const postOffset = camera.position.clone().sub(controls.target);
    expect(postOffset.x).toBeCloseTo(preOffset.x, 6);
    expect(postOffset.y).toBeCloseTo(preOffset.y, 6);
    expect(postOffset.z).toBeCloseTo(preOffset.z, 6);
  });

  it("reads a pan-mode left-drag as a rigid pan for the clamp branch", () => {
    const { camera, controls, applyBinding, drag } = makeDragRig();
    applyBinding(true);
    camera.updateMatrixWorld();
    const preTargetX = controls.target.x;
    const preTargetZ = controls.target.z;
    const prePosX = camera.position.x;
    const prePosZ = camera.position.z;
    drag(600, 400, 700, 400);
    expect(
      isRigidPan(
        controls.target.x - preTargetX,
        controls.target.z - preTargetZ,
        camera.position.x - prePosX,
        camera.position.z - prePosZ,
      ),
    ).toBe(true);
  });

  it("keeps right-drag panning in both modes", () => {
    for (const panMode of [false, true]) {
      const { camera, controls, applyBinding, drag } = makeDragRig();
      applyBinding(panMode);
      const preTarget = controls.target.clone();
      const preOffset = camera.position.clone().sub(controls.target);
      drag(600, 400, 700, 400, { button: 2 });
      expect(controls.target.distanceTo(preTarget)).toBeGreaterThan(1);
      const postOffset = camera.position.clone().sub(controls.target);
      expect(postOffset.x).toBeCloseTo(preOffset.x, 6);
      expect(postOffset.y).toBeCloseTo(preOffset.y, 6);
      expect(postOffset.z).toBeCloseTo(preOffset.z, 6);
    }
  });

  it("pans on one-finger drag in pan mode, orbits when off", () => {
    for (const panMode of [false, true]) {
      const { camera, controls, applyBinding, drag } = makeDragRig();
      applyBinding(panMode);
      const preTarget = controls.target.clone();
      const preOffset = camera.position.clone().sub(controls.target);
      drag(600, 400, 700, 400, { pointerType: "touch", pointerId: 10 });
      if (panMode) {
        expect(controls.target.distanceTo(preTarget)).toBeGreaterThan(1);
        const postOffset = camera.position.clone().sub(controls.target);
        expect(postOffset.x).toBeCloseTo(preOffset.x, 6);
        expect(postOffset.y).toBeCloseTo(preOffset.y, 6);
        expect(postOffset.z).toBeCloseTo(preOffset.z, 6);
      } else {
        expect(controls.target.x).toBeCloseTo(preTarget.x, 9);
        expect(controls.target.y).toBeCloseTo(preTarget.y, 9);
        expect(controls.target.z).toBeCloseTo(preTarget.z, 9);
      }
    }
  });

  it("restores orbiting when pan mode toggles back off", () => {
    const { camera, controls, applyBinding, drag } = makeDragRig();
    applyBinding(true);
    applyBinding(false);
    const preTarget = controls.target.clone();
    const prePos = camera.position.clone();
    drag(600, 400, 700, 400);
    expect(controls.target.x).toBeCloseTo(preTarget.x, 9);
    expect(controls.target.y).toBeCloseTo(preTarget.y, 9);
    expect(controls.target.z).toBeCloseTo(preTarget.z, 9);
    expect(camera.position.distanceTo(prePos)).toBeGreaterThan(1);
  });
});
