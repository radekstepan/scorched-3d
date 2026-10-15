// Minimap click-to-move helpers.
//
// Pure, framework-free coordinate mapping + camera retarget: a minimap
// pointer (u/v fractions across the square minimap box) maps linearly to
// world X/Z, and jumping the orbit camera there translates both the camera
// position and the orbit target by the same ground offset — so yaw, pitch,
// and zoom distance are preserved (only the focus point moves). Kept free
// of three.js so it stays unit-testable in a node environment, mirroring
// cameraPan.ts.

import { clampPanTarget, type Vec3 } from "./cameraPan";

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map a minimap fraction to world X/Z. `u` runs left→right, `v` runs
 * top→bottom (matching the overlay dot math in App.tsx:
 * left = x/worldW + 0.5, top = z/worldD + 0.5). Out-of-range and
 * non-finite inputs clamp to the map edges.
 */
export function minimapUvToWorld(
  u: number,
  v: number,
  worldW: number,
  worldD: number,
): { x: number; z: number } {
  return {
    x: (clamp01(u) - 0.5) * worldW,
    z: (clamp01(v) - 0.5) * worldD,
  };
}

/** Inverse of `minimapUvToWorld`: world X/Z → minimap fractions. */
export function worldToMinimapUv(
  x: number,
  z: number,
  worldW: number,
  worldD: number,
): { u: number; v: number } {
  return {
    u: x / worldW + 0.5,
    v: z / worldD + 0.5,
  };
}

export interface MinimapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Map a client pointer to world X/Z through a minimap box rect (the
 * `getBoundingClientRect()` of the square minimap wrapper). Zero-size
 * rects fall back to the map center instead of dividing by zero.
 */
export function minimapPointToWorld(
  clientX: number,
  clientY: number,
  rect: MinimapRect,
  worldW: number,
  worldD: number,
): { x: number; z: number } {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, z: 0 };
  return minimapUvToWorld(
    (clientX - rect.left) / rect.width,
    (clientY - rect.top) / rect.height,
    worldW,
    worldD,
  );
}

/**
 * Retarget an orbit camera to a minimap world point while preserving the
 * angle of view and zoom level: the position→target offset vector is kept
 * (same yaw/pitch/distance, same target height), only translated in X/Z.
 * The destination is clamped to the map (same edge margin as keyboard
 * pan) and the camera follows by the clamped delta, so the offset truly
 * never changes — even at the map edges.
 */
export function jumpCameraTo(
  position: Vec3,
  target: Vec3,
  dest: { x: number; z: number },
  worldW: number,
  worldD: number,
): void {
  const clamped = { x: dest.x, y: target.y, z: dest.z };
  clampPanTarget(clamped, worldW, worldD);
  const dx = clamped.x - target.x;
  const dz = clamped.z - target.z;
  position.x += dx;
  position.z += dz;
  target.x = clamped.x;
  target.z = clamped.z;
}
