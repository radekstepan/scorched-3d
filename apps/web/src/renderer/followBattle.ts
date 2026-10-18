// Follow-battle camera: auto-track the centroid of recent combat.
//
// Pure, framework-free helpers (no three.js, no React) so vitest covers
// them without WebGL. The canvas owns one CombatEventTracker fed by the
// combat impact hook, and glides the orbit rig toward the live centroid
// while the View-menu "Follow battle" toggle is on.
//
// Retail TA tracks a single selected unit with its follow camera
// (nanolathe `07-interface-input-camera-and-front-end.md`, [R-CAM-01 §12]:
// T cycles the tracked object, the scroll pass is the host-frame camera
// writer). This adapts that shape to an unattended skirmish: the tracked
// point is the centroid of recent impacts instead of one hull, and the
// camera writer is the existing tick's rigid-pan path. Like retail, follow
// state is presentation-only — the simulation never reads it back.

/** How long an impact steers the centroid (seconds of battle time). */
export const FOLLOW_EVENT_WINDOW = 6;
/** Oldest events are evicted past this many (one volley is a handful). */
export const FOLLOW_MAX_EVENTS = 64;
/** Exponential approach rate toward the centroid (1/s). */
export const FOLLOW_GAIN = 2.5;
/** Inside this ground distance of the centroid the camera rests (no jitter). */
export const FOLLOW_DEADZONE = 8;
/**
 * Manual camera input (keyboard pan, orbit/drag/zoom gesture, minimap
 * jump) pauses the glide for this long, then follow resumes on its own.
 * The toggle stays on: the user borrows the camera, never loses the mode.
 */
export const FOLLOW_RESUME_DELAY = 3;

export interface CombatCentroid {
  x: number;
  z: number;
  /** Impacts currently inside the window. */
  count: number;
}

interface CombatEvent {
  x: number;
  z: number;
  age: number;
}

/**
 * Recent-impact ring for the follow-battle camera. `record` stamps an
 * impact at age zero, `tick` ages the ring on battle dt (pausing with the
 * battle when suspended), and `centroid` averages whatever survives the
 * window — null on a quiet field, so the camera rests instead of drifting
 * to a stale point.
 */
export class CombatEventTracker {
  private events: CombatEvent[] = [];

  record(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.events.push({ x, z, age: 0 });
    while (this.events.length > FOLLOW_MAX_EVENTS) this.events.shift();
  }

  tick(dt: number): void {
    if (!(dt > 0)) return;
    for (const e of this.events) e.age += dt;
    while (this.events.length > 0 && this.events[0]!.age >= FOLLOW_EVENT_WINDOW) {
      this.events.shift();
    }
  }

  centroid(): CombatCentroid | null {
    if (this.events.length === 0) return null;
    let x = 0;
    let z = 0;
    for (const e of this.events) {
      x += e.x;
      z += e.z;
    }
    return { x: x / this.events.length, z: z / this.events.length, count: this.events.length };
  }

  get size(): number {
    return this.events.length;
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * True while manual input owns the camera: during an orbit/drag/zoom
 * gesture, or within FOLLOW_RESUME_DELAY of the last keyboard pan,
 * gesture end, or minimap jump. Follow motion is skipped, not queued —
 * the centroid keeps updating underneath, so resume glides to live action.
 */
export function followSuppressed(now: number, lastManualInput: number, userDriving: boolean): boolean {
  if (userDriving) return true;
  if (!Number.isFinite(now) || !Number.isFinite(lastManualInput)) return false;
  return now - lastManualInput < FOLLOW_RESUME_DELAY;
}

/**
 * Rigid X/Z translation gliding the orbit target toward the combat
 * centroid: an exponential approach (`1 - exp(-gain·dt)` of the remaining
 * gap) that never overshoots and rests inside FOLLOW_DEADZONE. The canvas
 * applies it to camera + target together (the keyboard-pan path) so
 * yaw/pitch/zoom survive, then runs the existing edge clamps.
 */
export function followBattleStep(
  targetX: number,
  targetZ: number,
  cx: number,
  cz: number,
  dt: number,
): { x: number; z: number } {
  const zero = { x: 0, z: 0 };
  if (!(dt > 0)) return zero;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetZ)) return zero;
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return zero;
  const dx = cx - targetX;
  const dz = cz - targetZ;
  if (Math.hypot(dx, dz) <= FOLLOW_DEADZONE) return zero;
  const k = 1 - Math.exp(-FOLLOW_GAIN * dt);
  return { x: dx * k, z: dz * k };
}
