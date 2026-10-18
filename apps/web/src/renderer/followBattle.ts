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
 * Manual pan input (keyboard pan, drag-pan gesture, minimap jump) pauses
 * the glide for this long, then follow resumes on its own. The toggle
 * stays on: the user borrows the camera, never loses the mode. Rotate and
 * zoom gestures never pause the glide — they compose with the rigid
 * translation instead of fighting it.
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
 * Which pointer gestures own the camera against follow-battle. The canvas
 * keeps OrbitControls on its stock button mapping (left rotates, middle
 * dollies, right pans, one finger rotates, two fingers dolly-pan), so a
 * pan hold is exactly: a right-button contact down, or two or more live
 * touch contacts. Rotate and zoom contacts never feed this tracker, and
 * the wheel feeds nothing at all — follow glides straight through them.
 *
 * In pan mode the canvas repoints the orbit gestures at pan (see
 * `panModeBinding`), so left-button contacts and single touch contacts
 * pan too — the canvas mirrors the toggle here with `setPanMode` and the
 * hold follows the live mapping instead of the stock one.
 *
 * Framework-free (no DOM types) so vitest covers it without WebGL: the
 * canvas feeds raw `button`/`pointerId`/`pointerType` triples.
 */
export class FollowHoldTracker {
  /** Right-button (pan) contacts currently down, by pointer id. */
  private panButtons = new Set<number>();
  /** Live touch contacts, by pointer id (two fingers pan). */
  private touches = new Set<number>();
  /** Pan-mode input mapping: left / single-finger drags pan, so they hold. */
  private panMode = false;

  /** Mirror the View-menu pan-mode toggle (called every tick). */
  setPanMode(panMode: boolean): void {
    this.panMode = panMode;
  }

  pointerDown(button: number, pointerId: number, pointerType: string): void {
    if (pointerType === "touch") {
      this.touches.add(pointerId);
      return;
    }
    if (button === 2 || (this.panMode && button === 0)) this.panButtons.add(pointerId);
  }

  /**
   * Release a contact. Returns true when a pan hold ended with this
   * release (was panning, now not) so the caller can stamp the resume
   * delay. Feed pointercancel here too — OrbitControls balances its own
   * gesture state the same way, and a missed release would hold follow
   * off forever.
   */
  pointerUp(pointerId: number): boolean {
    const was = this.userPanning;
    this.panButtons.delete(pointerId);
    this.touches.delete(pointerId);
    return was && !this.userPanning;
  }

  /** True while a pan gesture owns the camera. In pan mode one finger
   * pans (the orbit gesture is repointed), so a single touch holds too. */
  get userPanning(): boolean {
    return this.panButtons.size > 0 || this.touches.size >= (this.panMode ? 1 : 2);
  }

  reset(): void {
    this.panButtons.clear();
    this.touches.clear();
  }
}

/**
 * True while manual pan input owns the camera: during a drag-pan
 * gesture, or within FOLLOW_RESUME_DELAY of the last keyboard pan,
 * pan-gesture end, or minimap jump. Follow motion is skipped, not queued —
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
