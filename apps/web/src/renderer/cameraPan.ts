// Keyboard pan (arrow keys / WASD) for the orbit camera.
//
// Pure, framework-free helpers: screen-space key intent is converted into a
// camera-relative ground-plane offset, applied equally to the camera position
// and the orbit target so the view translates without rotating. Kept free of
// three.js so it stays unit-testable in a node environment.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PanInput {
  /** Screen-right intent: +1 = pan the view right. */
  right: number;
  /** Screen-up intent: +1 = pan the view away from the viewer. */
  forward: number;
}

/** World units the target travels per second, relative to camera distance. */
export const PAN_SPEED_FACTOR = 1.2;

/** Default slider positions: both ship at 1x — the base speeds below carry
 * the absolute feel, so the View-menu readouts open at 1.0x. */
export const DEFAULT_PAN_SPEED = 1;
export const DEFAULT_ZOOM_SPEED = 1;

/** Absolute speeds behind slider 1x (OrbitControls units for the drag /
 * wheel paths, multiplier on PAN_SPEED_FACTOR for keyboard panning).
 * Pan preserves the task-88 3x default feel; zoom doubles the task-87 2x
 * default, so 1x on the slider is 2x faster than the old zoom default. */
export const PAN_BASE_SPEED = 3;
export const ZOOM_BASE_SPEED = 4;

/** Slider bounds for the View-menu pan/zoom speed controls. */
export const PAN_SPEED_MIN = 0.2;
export const PAN_SPEED_MAX = 3;
export const ZOOM_SPEED_MIN = 0.2;
export const ZOOM_SPEED_MAX = 3;

/**
 * Closest the wheel/pinch may dolly toward the orbit target (world units).
 * 15 frames a single ~26-unit tank hull as a tight close-up while staying
 * just outside the longest hull half-length (14) and ~7.5x past the 2-unit
 * near plane, so hulls never clip and no near-plane change was needed; the
 * polar clamp still holds the camera above the dirt. Cursor-anchored zoom
 * behavior is untouched — only the floor.
 */
export const MIN_ZOOM_DISTANCE = 15;
/**
 * Farthest the wheel/pinch may dolly out (world units). 320x256 cells is
 * ~5104 world units wide, so twice the classic 4200 keeps the whole
 * doubled battlefield frameable.
 */
export const MAX_ZOOM_DISTANCE = 8400;

/** How far past the map half-extents the orbit target may travel (fraction). */
export const PAN_EDGE_MARGIN = 0.25;

interface KeyAxis {
  right: number;
  forward: number;
}

const KEY_AXES: Record<string, KeyAxis> = {
  ArrowUp: { right: 0, forward: 1 },
  KeyW: { right: 0, forward: 1 },
  ArrowDown: { right: 0, forward: -1 },
  KeyS: { right: 0, forward: -1 },
  ArrowLeft: { right: -1, forward: 0 },
  KeyA: { right: -1, forward: 0 },
  ArrowRight: { right: 1, forward: 0 },
  KeyD: { right: 1, forward: 0 },
};

export function isPanKey(code: string): boolean {
  return code in KEY_AXES;
}

/**
 * Sum the screen-space intent of all held key codes and normalize, so
 * diagonal pan (e.g. W+D) travels at the same speed as cardinal pan and
 * opposing keys (e.g. W+S) cancel out. Unknown codes are ignored.
 */
export function panInputFromCodes(codes: Iterable<string>): PanInput {
  let right = 0;
  let forward = 0;
  for (const code of codes) {
    const axis = KEY_AXES[code];
    if (!axis) continue;
    right += axis.right;
    forward += axis.forward;
  }
  const len = Math.hypot(right, forward);
  if (len > 1) {
    right /= len;
    forward /= len;
  }
  return { right, forward };
}

/**
 * Convert a normalized pan intent into a world-space ground-plane offset.
 * `distance` scales the offset (pass camera distance * PAN_SPEED_FACTOR * dt
 * for frame-rate independent, zoom-proportional panning).
 */
export function panOffset(
  camera: Vec3,
  target: Vec3,
  input: PanInput,
  distance: number,
): { x: number; z: number } {
  let fx = target.x - camera.x;
  let fz = target.z - camera.z;
  let len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    // Camera directly overhead: fall back to world north.
    fx = 0;
    fz = -1;
    len = 1;
  }
  fx /= len;
  fz /= len;
  // Screen-right = forward x up.
  const rx = -fz;
  const rz = fx;
  return {
    x: (rx * input.right + fx * input.forward) * distance,
    z: (rz * input.right + fz * input.forward) * distance,
  };
}

/** Translate both camera position and orbit target by a ground offset. */
export function applyPan(position: Vec3, target: Vec3, offset: { x: number; z: number }): void {
  position.x += offset.x;
  position.z += offset.z;
  target.x += offset.x;
  target.z += offset.z;
}

/** Keep the orbit target near the map (up to PAN_EDGE_MARGIN past each edge). */
export function clampPanTarget(target: Vec3, worldW: number, worldD: number): void {
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);
  target.x = Math.min(bx, Math.max(-bx, target.x));
  target.z = Math.min(bz, Math.max(-bz, target.z));
}

/**
 * True when a key event originates from an editable control, so native
 * behavior (e.g. arrows moving a range-slider thumb or caret) wins over
 * camera panning. Accepts the raw `Event.target`.
 */
export function shouldIgnoreKeyEvent(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName === "string") {
    const tag = el.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  return false;
}

/** Clamp a raw slider value into [lo, hi]; non-finite input falls back. */
function clampSpeed(value: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** Clamp a raw pan-speed slider value into [PAN_SPEED_MIN, PAN_SPEED_MAX]. */
export function clampPanSpeed(value: number): number {
  return clampSpeed(value, PAN_SPEED_MIN, PAN_SPEED_MAX, DEFAULT_PAN_SPEED);
}

/** Clamp a raw zoom-speed slider value into [ZOOM_SPEED_MIN, ZOOM_SPEED_MAX]. */
export function clampZoomSpeed(value: number): number {
  return clampSpeed(value, ZOOM_SPEED_MIN, ZOOM_SPEED_MAX, DEFAULT_ZOOM_SPEED);
}

/**
 * Absolute OrbitControls pan speed for a slider position: the clamped
 * slider value scaled by PAN_BASE_SPEED, so 1x reads as the old 3x default.
 */
export function effectivePanSpeed(value: number): number {
  return clampPanSpeed(value) * PAN_BASE_SPEED;
}

/**
 * Absolute OrbitControls zoom speed for a slider position: the clamped
 * slider value scaled by ZOOM_BASE_SPEED, so 1x reads as 4x stock speed —
 * twice the old 2x default.
 */
export function effectiveZoomSpeed(value: number): number {
  return clampZoomSpeed(value) * ZOOM_BASE_SPEED;
}

/**
 * Frame step for keyboard panning: zoom-proportional, frame-rate
 * independent, and scaled by the View-menu pan-speed slider through
 * effectivePanSpeed (1x = the old 3x default feel).
 */
export function panStepDistance(distance: number, dt: number, speed: number): number {
  return distance * PAN_SPEED_FACTOR * effectivePanSpeed(speed) * dt;
}
