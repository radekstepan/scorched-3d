import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAN_SPEED,
  DEFAULT_ZOOM_SPEED,
  PAN_EDGE_MARGIN,
  PAN_SPEED_FACTOR,
  PAN_SPEED_MAX,
  PAN_SPEED_MIN,
  ZOOM_SPEED_MAX,
  ZOOM_SPEED_MIN,
  applyPan,
  clampPanSpeed,
  clampPanTarget,
  clampZoomSpeed,
  isPanKey,
  panInputFromCodes,
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
  it("exposes a sane 0.2x–3x slider range around a 1x default", () => {
    expect(DEFAULT_PAN_SPEED).toBe(1);
    expect(DEFAULT_ZOOM_SPEED).toBe(1);
    expect(PAN_SPEED_MIN).toBe(0.2);
    expect(PAN_SPEED_MAX).toBe(3);
    expect(ZOOM_SPEED_MIN).toBe(0.2);
    expect(ZOOM_SPEED_MAX).toBe(3);
  });

  it("clamps pan speed into range", () => {
    expect(clampPanSpeed(1)).toBe(1);
    expect(clampPanSpeed(0.2)).toBe(0.2);
    expect(clampPanSpeed(3)).toBe(3);
    expect(clampPanSpeed(-5)).toBe(PAN_SPEED_MIN);
    expect(clampPanSpeed(99)).toBe(PAN_SPEED_MAX);
  });

  it("clamps zoom speed into range", () => {
    expect(clampZoomSpeed(1)).toBe(1);
    expect(clampZoomSpeed(-5)).toBe(ZOOM_SPEED_MIN);
    expect(clampZoomSpeed(99)).toBe(ZOOM_SPEED_MAX);
  });

  it("falls back to 1x on non-finite input", () => {
    expect(clampPanSpeed(NaN)).toBe(DEFAULT_PAN_SPEED);
    expect(clampPanSpeed(Infinity)).toBe(DEFAULT_PAN_SPEED);
    expect(clampZoomSpeed(NaN)).toBe(DEFAULT_ZOOM_SPEED);
    expect(clampZoomSpeed(-Infinity)).toBe(DEFAULT_ZOOM_SPEED);
  });

  it("scales the keyboard pan step linearly with the speed multiplier", () => {
    const base = panStepDistance(1000, 0.016, 1);
    expect(base).toBeCloseTo(1000 * PAN_SPEED_FACTOR * 0.016, 10);
    expect(panStepDistance(1000, 0.016, 2)).toBeCloseTo(base * 2, 10);
    expect(panStepDistance(1000, 0.016, 0.5)).toBeCloseTo(base * 0.5, 10);
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
});
