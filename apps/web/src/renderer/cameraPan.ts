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
 * Pan 1x is the old 0.3x feel (1.215 absolute = 4.05 × 0.3); zoom 1x
 * doubles the task-87 2x default (4x stock), so the slider reads 1x
 * while zooming 2x faster than the old zoom default. */
export const PAN_BASE_SPEED = 1.215;
export const ZOOM_BASE_SPEED = 4;

/** Slider bounds for the View-menu pan/zoom speed controls. */
export const PAN_SPEED_MIN = 0.2;
export const PAN_SPEED_MAX = 3;
export const ZOOM_SPEED_MIN = 0.2;
export const ZOOM_SPEED_MAX = 3;

/**
 * Closest the wheel/pinch may dolly toward the orbit target (world units).
 * 30 frames a single ~26-unit tank hull as the close-up (2·30·tan(24°) ≈
 * 27 world units tall at the 48° fov), backed off from a 15-unit floor
 * that showed half a hull and felt too close. It also keeps a typical
 * close-up pitch above the 6-unit surface floor (30·cos(74°) ≈ 8.3), so
 * cursor-anchored zoom preserves the view angle exactly instead of
 * steepening onto the floor — while staying well outside the longest
 * hull half-length (14) and 15x past the 2-unit near plane, so hulls
 * never clip and no near-plane change was needed.
 */
export const MIN_ZOOM_DISTANCE = 30;
/**
 * Farthest the wheel/pinch may dolly out (world units). 320x256 cells is
 * ~5104 world units wide, so twice the classic 4200 keeps the whole
 * doubled battlefield frameable.
 */
export const MAX_ZOOM_DISTANCE = 8400;
/**
 * Minimum eye height above the local terrain/water surface (world units).
 * 6 clears the 2-unit near plane with room to spare, rides above the ~2
 * units of water swell crests, and absorbs the bilinear-vs-mesh height
 * mismatch — while staying well under the 30-unit zoom floor, so typical
 * close-ups of a surface-seated target never touch it. Only grazing
 * descents (zooming into a slope, orbiting low over a rise) land here.
 */
export const CAMERA_SURFACE_CLEARANCE = 6;

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
 * Clamp the orbit target to the map like `clampPanTarget`, but move the
 * camera position back by the clamped-away delta so the position→target
 * offset (yaw/pitch/distance) never changes.
 *
 * Clamping the target alone lets the camera keep travelling past it: at a
 * map corner the camera crosses over the stuck target and the view flips
 * backwards. Carrying the camera with the clamped delta stops forward
 * motion at the bound instead — per axis, so sliding along an edge still
 * works — while the viewing angle is retained exactly.
 */
export function clampPanTargetWithCamera(
  target: Vec3,
  position: Vec3,
  worldW: number,
  worldD: number,
): void {
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);
  const cx = Math.min(bx, Math.max(-bx, target.x));
  const cz = Math.min(bz, Math.max(-bz, target.z));
  position.x += cx - target.x;
  position.z += cz - target.z;
  target.x = cx;
  target.z = cz;
}

/**
 * Keep the camera position itself inside the same virtual rectangle as the
 * orbit target (up to PAN_EDGE_MARGIN past each map edge). Clamping only
 * the target still lets orbiting/zooming swing the camera thousands of
 * units past the edge — the target sits at its bound while the camera
 * keeps travelling, and the view leaves the world ("off the map").
 *
 * Unlike `clampPanTargetWithCamera`, the target is NOT moved here: the
 * target already has its own tighter-or-equal clamp, so pulling the camera
 * back shortens the viewing offset (a slight zoom-in at the bound) while
 * the focus point stays put. Height is untouched — the polar clamp and
 * zoom distance own Y.
 *
 * Never apply this to a jump-placed camera (see `isCameraOutsideWorld`):
 * a minimap jump is an explicit teleport whose offset IS the requested
 * zoom/angle, so reeling it in destroys the request instead of trimming
 * gradual drift.
 */
export function clampCameraToWorld(position: Vec3, worldW: number, worldD: number): void {
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);
  position.x = Math.min(bx, Math.max(-bx, position.x));
  position.z = Math.min(bz, Math.max(-bz, position.z));
}

/**
 * Clamp the camera position to the world rectangle like
 * `clampCameraToWorld`, but carry the orbit target with the clamped-away
 * delta so the position→target offset (yaw/pitch/distance) never changes.
 *
 * This is the pan-back wall: the camera sits behind the target, so panning
 * backwards drives the camera into its bound first. The plain camera clamp
 * would pin the camera while the target keeps advancing — the target
 * catches up to the camera, the ground-plane forward basis collapses, and
 * the view warps (pan direction snaps to the overhead fallback). Carrying
 * the target with the clamped delta stops backward motion at the bound
 * instead — per axis, so sliding along the wall still works — while the
 * viewing angle is retained exactly. Mirror of `clampPanTargetWithCamera`,
 * which is the equivalent wall for panning forward.
 *
 * Only use this for rigid pans (keyboard pan, right-drag pan): orbiting or
 * zooming at the edge must keep the reel-in behavior of
 * `clampCameraToWorld` so the focus point stays put. The tick tells them
 * apart with `isRigidPan`.
 */
export function clampCameraToWorldWithTarget(
  position: Vec3,
  target: Vec3,
  worldW: number,
  worldD: number,
): void {
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);
  const cx = Math.min(bx, Math.max(-bx, position.x));
  const cz = Math.min(bz, Math.max(-bz, position.z));
  target.x += cx - position.x;
  target.z += cz - position.z;
  position.x = cx;
  position.z = cz;
}

/** Tolerance for `isRigidPan`: float64 rounding of identical pan offsets. */
export const RIGID_PAN_EPSILON = 1e-6;

/**
 * True when a controls update moved the orbit target and the camera by the
 * same ground-plane delta — a rigid pan (right-drag, including its damped
 * glide), as opposed to orbiting or cursor-anchored zooming, which move
 * target and camera apart. The tick uses it to pick the pan-back wall
 * (`clampCameraToWorldWithTarget`, angle retained) over the orbit reel-in
 * (`clampCameraToWorld`, focus retained). A stationary target reads false:
 * with no pan motion both clamps agree, and pure orbit/zoom must reel in.
 */
export function isRigidPan(
  dTargetX: number,
  dTargetZ: number,
  dPositionX: number,
  dPositionZ: number,
): boolean {
  if (dTargetX === 0 && dTargetZ === 0) return false;
  return (
    Math.abs(dTargetX - dPositionX) <= RIGID_PAN_EPSILON &&
    Math.abs(dTargetZ - dPositionZ) <= RIGID_PAN_EPSILON
  );
}

/**
 * Lift the camera eye above the local surface (terrain, or the water sheet
 * when it's the higher of the two — callers pass the max). OrbitControls'
 * own guardrails are target-relative: cursor-anchored zoom flies the
 * camera down the pointer ray toward the dirt, and the polar clamp only
 * holds the eye above the target's horizontal plane, so zooming into a
 * slope or orbiting low over a rise happily buries the camera. This is the
 * terrain-collision floor: run it after the XZ clamps (it reads the final
 * column) with no jump exemption — an underground eye is never a valid
 * request. The target is untouched, so the focus stays put while the view
 * pitches up slightly at the floor, mirroring `clampCameraToWorld`.
 * Non-finite surfaces (no height sample) leave the camera alone.
 */
export function clampCameraAboveSurface(
  position: Vec3,
  surfaceY: number,
  clearance: number = CAMERA_SURFACE_CLEARANCE,
): void {
  if (!Number.isFinite(surfaceY) || !Number.isFinite(clearance)) return;
  const floor = surfaceY + clearance;
  if (position.y < floor) position.y = floor;
}

/**
 * Hold the orbit target at or above the local terrain surface (callers pass
 * the terrain height under the target's final XZ column — the focus may
 * rest on a lakebed, mirroring `jumpCameraTo`, which seats jumps on the
 * terrain rather than the water sheet). The zero clearance is deliberate:
 * the eye needs room for its near plane and the swell, but a focus point
 * sitting exactly on the dirt is a valid request.
 *
 * Without this, cursor-anchored zoom sinks the target through the floor:
 * every wheel tick re-seats the target along the camera's downward
 * forward ray while `clampCameraAboveSurface` holds only the eye up, so
 * the target dives hundreds of units underground, the camera→target
 * offset stretches far past the zoom floor, and the view pitches to
 * fully vertical. Pinning the target to the surface keeps the pair
 * rigid, so close-ups arrive at the zoom floor with the view angle
 * intact. Run it after the XZ clamps (it reads the final column) with
 * no jump exemption — an underground focus is never a valid request.
 * Non-finite surfaces (no height sample) leave the target alone.
 */
export function clampTargetAboveSurface(target: Vec3, surfaceY: number): void {
  if (!Number.isFinite(surfaceY)) return;
  if (target.y < surfaceY) target.y = surfaceY;
}

/**
 * True when the camera sits outside the world rectangle
 * `clampCameraToWorld` enforces (same bounds, read-only). The tick uses it
 * for the minimap-jump exemption: a jump-placed camera keeps its exact
 * offset (the requested zoom/angle) until it drifts back inside on its own
 * — clamping the fresh teleport would yank it, collapsing zoom and
 * swinging the angle. Height is ignored, like the clamp itself.
 */
export function isCameraOutsideWorld(position: Vec3, worldW: number, worldD: number): boolean {
  const bx = (worldW / 2) * (1 + PAN_EDGE_MARGIN);
  const bz = (worldD / 2) * (1 + PAN_EDGE_MARGIN);
  return Math.abs(position.x) > bx || Math.abs(position.z) > bz;
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
 * slider value scaled by PAN_BASE_SPEED, so 1x reads as the old 0.3x
 * feel (1.215 absolute).
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
 * effectivePanSpeed (1x = the old 0.3x feel).
 */
export function panStepDistance(distance: number, dt: number, speed: number): number {
  return distance * PAN_SPEED_FACTOR * effectivePanSpeed(speed) * dt;
}
