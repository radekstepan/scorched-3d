import type { UnitKind } from "./types.js";

/**
 * AAA RTS retaliation AI: threat memory + pursuit with hysteresis and a
 * leash. Framework-free (no three.js) so the web renderer and vitest share
 * the same rules.
 *
 * Problem: patrolling hulls used to take fire with total indifference —
 * they kept walking their loop while being shelled, so the skirmish read as
 * target practice instead of a fight. Every splash now also leaves a threat
 * memory on the victim (attacker index + last-known position + a countdown),
 * and idle/patrolling hulls steer toward that memory to fight back while it
 * is fresh, near, and reachable — then give up and resume their patrol.
 *
 * Nanolathe parallel (adapted, no COB scripts here): retail TA units
 * answer damage by acquiring the attacker as a target and closing to
 * weapons range, but they never chase across the map — they guard a post
 * and return to it (the patrol anchor here). The same three gates apply:
 *
 * - Engage on direction: the memory records *where the shot came from*
 *   (shooter position threaded through the damage path, so the victim turns
 *   toward the attacker, not just away from the blast), and the hull both
 *   faces and drives that way.
 * - Hysteresis against oscillation: a victim engages a nearby attacker
 *   (`THREAT_ENGAGE_RADIUS`) but only gives up once the attacker is much
 *   farther away (`THREAT_DISENGAGE_RADIUS`) or the memory expires
 *   (`THREAT_MEMORY_DURATION` without a re-hit) — so a hull dancing on the
 *   boundary does not flicker between pursuit and patrol every tick.
 * - Leash to the post: pursuit never drags a hull farther than
 *   `THREAT_LEASH_RADIUS` from its patrol anchor (route waypoint 0, the
 *   spawn). A sniper shelling from across the map is ignored outright; a
 *   fleeing attacker that outruns the leash is let go and the patrol
 *   resumes.
 *
 * Authority rules (decided, documented):
 * - Player orders win. Ordered and holding units never retaliate — a new
 *   order (or hold) clears any live memory, and hits taken while ordered
 *   record nothing. Only idle/patrolling hulls pursue.
 * - Movers never teleport: pursuit drives through the same turn-rate caps,
 *   alignment grip, rough-terrain drag, slope gating, spacing, and
 *   separation as patrol and orders — it only swaps the *target*.
 * - Stand-off at weapons range: a pursuer closes to its kind's brawl
 *   distance (`PURSUE_STANDOFF` — scouts close, artillery hangs back), then
 *   holds and faces the threat while the turret scheduler does the shooting
 *   — hulls close, guns kill.
 * - Determinism: no rng, no wall clock. The memory is a `ttl` countdown
 *   ticked by sim `dt`, so the same hit sequence replays identically.
 * - Wrecks stay silent: the renderer refuses threats for destroyed hulls
 *   (and clears the memory on the kill), and a hull never pursues itself
 *   (own-splash self-hits are ignored).
 */

/** Last-known threat on a mover: who shot, from where, for how much longer. */
export interface ThreatMemory {
  /** Roster index of the attacker (resolved to live positions per tick). */
  attacker: number;
  /** Last-known attacker position, world units. */
  x: number;
  z: number;
  /** Seconds of memory remaining; pursuit ends at 0 without a re-hit. */
  ttl: number;
}

/**
 * Seconds a threat memory lasts without a re-hit. Long enough to close
 * across a neighbourhood, short enough that a lost attacker is forgotten
 * and the patrol resumes instead of guarding a stale position forever.
 */
export const THREAT_MEMORY_DURATION = 12;
/**
 * Engage gate: a hit from an attacker farther than this never starts a
 * pursuit (cross-map artillery is ignored). Compared against the
 * victim→attacker distance at hit time.
 */
export const THREAT_ENGAGE_RADIUS = 900;
/**
 * Disengage gate: an active pursuit ends once the (live) attacker is
 * farther than this from the victim. Deliberately larger than the engage
 * gate — the gap is the hysteresis that stops boundary oscillation.
 */
export const THREAT_DISENGAGE_RADIUS = 1250;
/**
 * Leash: pursuit never chases a threat farther than this from the patrol
 * anchor (route waypoint 0). Keeps retaliation local — no map-wide chases.
 */
export const THREAT_LEASH_RADIUS = 650;
/** Floor on the weapons-range stand-off (scouts still close to brawling range). */
export const THREAT_MIN_STANDOFF = 150;
/** Cap on the weapons-range stand-off (artillery holds at shell distance). */
export const THREAT_MAX_STANDOFF = 800;

/**
 * Weapons-range stand-off per kind, world units: a pursuer drives to this
 * distance from the threat, then holds and faces it while the turret
 * scheduler does the shooting — hulls close, guns kill. Deliberately far
 * inside the engage gate (so most pursuits visibly drive) yet outside
 * ramming distance: scouts brawl close, tanks hold at bolt distance, and
 * artillery hangs back at shell distance instead of charging guns.
 */
export const PURSUE_STANDOFF: Record<UnitKind, number> = {
  flash: 220,
  stump: 280,
  commander: 300,
  hammer: 480,
};

/** True while the mover carries a live (unexpired) threat memory. */
export function hasThreat(mover: { threat?: ThreatMemory }): boolean {
  return (mover.threat?.ttl ?? 0) > 0;
}

/**
 * Weapons-range stand-off for `kind` (see `PURSUE_STANDOFF`). Falls back to
 * the floor for unknown kinds so headless callers never divide into a NaN.
 */
export function pursueStandOff(kind: UnitKind): number {
  return PURSUE_STANDOFF[kind] ?? THREAT_MIN_STANDOFF;
}

export interface ThreatAnchor {
  x: number;
  z: number;
}

/**
 * Record a hit from `attacker` at (`ax`, `az`) on `mover`: returns a new
 * mover with the threat memory set or refreshed. Pure: no rng, no clocks.
 *
 * - Ordered/holding movers ignore the hit (player orders win — the memory
 *   is never even recorded, so there is nothing to expire later).
 * - Self-hits (`attacker === victim`) are ignored: a hull shelled by its
 *   own blast splash must not pursue itself.
 * - A fresh victim engages only inside `THREAT_ENGAGE_RADIUS` and only when
 *   the attacker sits inside the leash of `anchor` — distant snipers never
 *   pull a patrol off its loop.
 * - A re-hit from the *same* attacker refreshes position + clock while the
 *   attacker stays inside `THREAT_DISENGAGE_RADIUS` (the hysteresis side:
 *   an engaged hull tolerates more distance than a fresh one); past it the
 *   memory drops instead of refreshing.
 * - A hit from a *new* attacker steals the memory only inside the engage
 *   gate — the latest close hit is the most salient — otherwise the old
 *   pursuit stands.
 */
export function notifyThreat<M extends { threat?: ThreatMemory; order?: unknown; hold?: boolean }>(
  mover: M,
  victim: { x: number; z: number },
  attacker: number,
  ax: number,
  az: number,
  anchor?: ThreatAnchor | null,
): M {
  if (!Number.isInteger(attacker) || attacker < 0) return mover;
  if (!Number.isFinite(ax) || !Number.isFinite(az)) return mover;
  if (mover.hold) return mover;
  const order = mover.order as { at?: number; points?: readonly unknown[] } | undefined;
  if (order && (order.at ?? 0) >= 0 && (order.at ?? 0) < (order.points?.length ?? 0)) return mover;
  const dx = ax - victim.x;
  const dz = az - victim.z;
  const dist = Math.hypot(dx, dz);
  if (!(dist >= 0)) return mover;
  const live = mover.threat && mover.threat.ttl > 0 ? mover.threat : undefined;
  if (live) {
    if (attacker === live.attacker) {
      if (dist > THREAT_DISENGAGE_RADIUS) {
        const { threat: _dropped, ...rest } = mover;
        return { ...rest } as M;
      }
      return { ...mover, threat: { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION } };
    }
    if (dist > THREAT_ENGAGE_RADIUS) return mover;
    if (anchor && Math.hypot(ax - anchor.x, az - anchor.z) > THREAT_LEASH_RADIUS) return mover;
    return { ...mover, threat: { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION } };
  }
  if (dist > THREAT_ENGAGE_RADIUS) return mover;
  if (anchor && Math.hypot(ax - anchor.x, az - anchor.z) > THREAT_LEASH_RADIUS) return mover;
  return { ...mover, threat: { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION } };
}

/**
 * Tick a threat countdown by `dt` seconds, dropping the key at expiry so
 * post-pursuit snapshots compare equal with never-threatened ones. Pure;
 * a non-positive step leaves the mover untouched.
 */
export function tickThreat<M extends { threat?: ThreatMemory }>(mover: M, dt: number): M {
  const ttl = mover.threat?.ttl;
  if (!(ttl !== undefined && ttl > 0)) return mover;
  if (!(dt > 0)) return mover;
  const remain = ttl - dt;
  if (remain > 0) {
    if (remain === ttl) return mover;
    return { ...mover, threat: { ...(mover.threat as ThreatMemory), ttl: remain } };
  }
  const { threat: _dropped, ...rest } = mover;
  return { ...rest } as M;
}

/** Drop any threat memory (orders, hold, kills clear it). Pure. */
export function clearThreat<M extends { threat?: ThreatMemory }>(mover: M): M {
  if (mover.threat === undefined) return mover;
  const { threat: _dropped, ...rest } = mover;
  return { ...rest } as M;
}
