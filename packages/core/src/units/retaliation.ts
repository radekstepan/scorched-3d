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
export interface ThreatChallenger {
  /** Roster index of the live enemy chipping an HQ assault. */
  attacker: number;
  /** Consecutive hits from `attacker` while the assault stands. */
  hits: number;
  /** Last-known challenger position, world units. */
  x: number;
  z: number;
}

export interface ThreatMemory {
  /** Roster index of the attacker (resolved to live positions per tick). */
  attacker: number;
  /** Last-known attacker position, world units. */
  x: number;
  z: number;
  /** Seconds of memory remaining; pursuit ends at 0 without a re-hit. */
  ttl: number;
  /**
   * Leash for this pursuit, world units from the patrol anchor. Absent reads
   * as `THREAT_LEASH_RADIUS` (retaliation: hits only ever pull a hull a
   * short way off its loop). Hunt acquisitions set the wider
   * `HUNT_LEASH_RADIUS` so a hull that *sees* the enemy may chase it down —
   * the drive (`pursueStep`) honors whichever leash the memory carries.
   */
  leash?: number;
  /**
   * True when this position memory is an HQ/structure assault (see
   * `seekStructure`), not a team-advance waypoint: the hull is engaging an
   * enemy fort and must finish consistent challengers before resuming it.
   * The sweep never clobbers an assault with a team advance, and a hit while
   * assaulting counts toward `challenger` instead of stealing immediately.
   */
  structure?: boolean;
  /**
   * Consistent-attacker record while assaulting a structure: consecutive hits
   * from one live enemy (`hits` reaching `HQ_DEFENSE_HITS` retargets the
   * assault onto the challenger — self-defense first, HQ after). A hit from
   * a different attacker restarts the count; the record dies with the memory
   * (or on retarget), so stale chips never preempt later assaults.
   */
  challenger?: ThreatChallenger;
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
 * Shell-investigate engage gate: a wound from an arcing shell records a
 * threat inside this distance even past the bolt envelope — so a tank being
 * shelled from beyond line-of-sight turns to investigate the firing
 * position instead of patrolling on. Sized past the hammer's reach (1000
 * plus the scheduler's +50 admission margin and scatter) yet inside the
 * disengage bound, so the hysteresis still holds: a fresh victim answers
 * shells at 1100 while an engaged one tolerates 1250. Deliberately the
 * hunt-eyes scale — being shelled is as salient as spotting the enemy.
 * Memories recorded past the retaliation gates carry the hunt leash, so the
 * investigate ranges like a hunt (bounded, never a map-wide chase) under
 * the same countdown.
 */
export const SHELL_ENGAGE_RADIUS = 1100;
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
/**
 * Hunt engage gate: an idle/patrolling hull *notices* a live enemy inside
 * this distance and starts a pursuit (see `acquireHunt`). Deliberately wider
 * than the retaliation engage gate — being shot is salient at 900, but a
 * visible enemy column is worth answering at 1100 — yet still inside the
 * shared disengage bound, so the hysteresis gap (engage 1100 < disengage
 * 1250) keeps a hull on the boundary from flickering between hunt and
 * patrol every tick.
 */
export const HUNT_ENGAGE_RADIUS = 1100;
/**
 * Hunt leash: a hunt pursuit may range this far from the patrol anchor —
 * roughly a map half-width, so mid-map meetings stay pursuable while a hull
 * never abandons its side of the field to chase a contact home. Carried on
 * the threat memory (`ThreatMemory.leash`); retaliation memories keep the
 * tighter `THREAT_LEASH_RADIUS`.
 */
export const HUNT_LEASH_RADIUS = 1400;
/**
 * Team-advance leash: a side pushing its last-known enemy direction (or a
 * scout recon push with no contact yet) may range this far from the patrol
 * anchor — roughly a full map width on the doubled field, so a contact at
 * mid-map or a deep HQ sighting still marches instead of dying on the hunt
 * leash at the second step. Retaliation and hunt memories keep their tighter
 * leashes; only position advances (attacker -1, never a grudge) ride this.
 */
export const TEAM_ADVANCE_LEASH_RADIUS = 3500;
/** Floor on the weapons-range stand-off (scouts still close to brawling range). */
export const THREAT_MIN_STANDOFF = 150;
/** Cap on the weapons-range stand-off (artillery holds at shell distance). */
export const THREAT_MAX_STANDOFF = 800;
/**
 * Consistent hits from one live enemy before a hull assaulting an HQ
 * retargets onto its challenger (see `notifyThreat`). One stray splash is
 * not worth abandoning the fort for — three in a row from the same gun
 * means the assault is under honest fire and the enemy must be dealt with
 * first. Low enough to answer real pressure, high enough that chip damage
 * never yanks a push off its target.
 */
export const HQ_DEFENSE_HITS = 3;

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
  // Infantry closes to knife-fight range (its gun reaches 550).
  peewee: 180,
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
 *   pull a patrol off its loop. Wounds from arcing shells (`shell`, see
 *   `SHELL_ENGAGE_RADIUS`) engage wider and range on the hunt leash instead:
 *   the same memory, the same drive, the same countdown — a shelled hull
 *   investigates the firing position instead of staying put, giving up at
 *   the same leash, disengage, and expiry gates. Close shell hits record a
 *   plain retaliation memory, byte-identical to a bolt hit.
 * - A re-hit from the *same* attacker refreshes position + clock while the
 *   attacker stays inside `THREAT_DISENGAGE_RADIUS` (the hysteresis side:
 *   an engaged hull tolerates more distance than a fresh one); past it the
 *   memory drops instead of refreshing. The refresh keeps the memory's
 *   carried leash, so a ranging investigate (or hunt) never collapses to
 *   the tight anchor guard mid-chase.
 * - A hit from a *new* attacker steals the memory only inside the engage
 *   gate — the latest close hit is the most salient — otherwise the old
 *   pursuit stands. Shell hits steal on the wider shell gates (recording a
 *   hunt-leash memory past the retaliation bounds), bolts on the tight ones.
 * - HQ assaults are the exception: a hull engaging a fort (`structure`, see
 *   `seekStructure`) never drops the push on a single splash. Hits from one
 *   live enemy count up on `challenger`, and only `HQ_DEFENSE_HITS` in a row
 *   from the same gun retargets the hull onto the challenger — self-defense
 *   first, the fort after. A different attacker restarts the count; distant
 *   chips (past the engage gate or the leash) record nothing, shells
 *   included.
 */
export function notifyThreat<M extends { threat?: ThreatMemory; order?: unknown; hold?: boolean }>(
  mover: M,
  victim: { x: number; z: number },
  attacker: number,
  ax: number,
  az: number,
  anchor?: ThreatAnchor | null,
  shell = false,
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
  const engage = shell ? SHELL_ENGAGE_RADIUS : THREAT_ENGAGE_RADIUS;
  const leashGate = shell ? HUNT_LEASH_RADIUS : THREAT_LEASH_RADIUS;
  // Close enough for a plain retaliation memory (bolt-identical shape, no
  // carried leash): only shells refused here fall through to the wider
  // investigate gates below.
  const close =
    dist <= THREAT_ENGAGE_RADIUS &&
    !(anchor && Math.hypot(ax - anchor.x, az - anchor.z) > THREAT_LEASH_RADIUS);
  const live = mover.threat && mover.threat.ttl > 0 ? mover.threat : undefined;
  if (live) {
    // An HQ assault under fire holds its push until the fire proves
    // consistent — one splash is chip damage, not a reason to turn.
    if (live.attacker === -1 && live.structure === true) {
      return noteAssaultHit(mover, live, attacker, ax, az, dist, anchor);
    }
    if (attacker === live.attacker) {
      if (dist > THREAT_DISENGAGE_RADIUS) {
        const { threat: _dropped, ...rest } = mover;
        return { ...rest } as M;
      }
      return {
        ...mover,
        threat: {
          attacker,
          x: ax,
          z: az,
          ttl: THREAT_MEMORY_DURATION,
          ...(live.leash !== undefined ? { leash: live.leash } : {}),
        },
      };
    }
    if (dist > engage) return mover;
    if (anchor && Math.hypot(ax - anchor.x, az - anchor.z) > leashGate) return mover;
    return {
      ...mover,
      threat:
        shell && !close
          ? { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS }
          : { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION },
    };
  }
  if (dist > engage) return mover;
  if (anchor && Math.hypot(ax - anchor.x, az - anchor.z) > leashGate) return mover;
  return {
    ...mover,
    threat:
      shell && !close
        ? { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS }
        : { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION },
  };
}

/**
 * Count one hit from `attacker` against a hull assaulting an HQ (see
 * `notifyThreat`): consecutive hits from the same gun accumulate on the
 * assault's `challenger` record, and the `HQ_DEFENSE_HITS`-th in a row
 * retargets the hull onto the challenger through a normal retaliation
 * memory — the enemy is dealt with first, and the fort is re-engaged once
 * the grudge clears (obstructed guns re-seek, the scheduler re-picks
 * admitted forts). A hit from a different gun restarts the count at 1;
 * chips from past the engage gate or the anchor leash record nothing.
 *
 * Pure: no rng, no clocks.
 */
function noteAssaultHit<M extends { threat?: ThreatMemory }>(
  mover: M,
  live: ThreatMemory,
  attacker: number,
  ax: number,
  az: number,
  dist: number,
  anchor?: ThreatAnchor | null,
): M {
  if (dist > THREAT_ENGAGE_RADIUS) return mover;
  if (anchor && Math.hypot(ax - anchor.x, az - anchor.z) > THREAT_LEASH_RADIUS) return mover;
  const prev = live.challenger;
  const hits = prev && prev.attacker === attacker ? prev.hits + 1 : 1;
  if (hits >= HQ_DEFENSE_HITS) {
    return { ...mover, threat: { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION } };
  }
  return { ...mover, threat: { ...live, challenger: { attacker, hits, x: ax, z: az } } };
}

/**
 * Reposition for a blocked line of fire: point an idle/patrolling hull at
 * the target its gun cannot reach because terrain (or wood) hides it, so
 * the hull closes to a higher vantage or shorter range instead of shooting
 * through the hill. Drives the same threat/pursuit pipeline retaliation
 * uses (stand-off hold, disengage give-up, anchor leash, memory expiry —
 * see `pursueStep`), so the hull advances, holds facing the target inside
 * stand-off, and resumes patrol if the fight moves on.
 *
 * Compared to `notifyThreat` (which records a hit someone else dealt), the
 * seeker is the *shooter*: there is no engage-radius gate — a gun inside
 * admitted range but behind a ridge must still close even when the target
 * sits past the retaliation notice bound — while the rest of the authority
 * rules hold:
 *
 * - Ordered/holding movers ignore the seek (player orders win).
 * - The patrol-anchor leash still applies (local repositioning only, never
 *   a map-wide chase): a target past the leash leaves the mover untouched.
 * - `attacker` is the *target* roster index the hull should close on, or
 *   -1 for a structure with no roster row (an HQ): the drive falls back to
 *   the last-known (`ax`, `az`) position. Self-seeks never happen (guns
 *   only ever draw cross-team pairs) but are refused anyway.
 * - A live memory is refreshed in place (position + clock), preserving its
 *   leash (a hunt memory keeps ranging wide instead of collapsing to the
 *   retaliation leash mid-chase).
 *
 * Pure: no rng, no clocks.
 */
export function seekEngage<M extends { threat?: ThreatMemory; order?: unknown; hold?: boolean }>(
  mover: M,
  victim: { x: number; z: number },
  attacker: number,
  ax: number,
  az: number,
  anchor?: ThreatAnchor | null,
): M {
  if (!Number.isInteger(attacker) || attacker < -1) return mover;
  if (!Number.isFinite(ax) || !Number.isFinite(az)) return mover;
  if (!victim || !Number.isFinite(victim.x) || !Number.isFinite(victim.z)) return mover;
  if (mover.hold) return mover;
  const order = mover.order as { at?: number; points?: readonly unknown[] } | undefined;
  if (order && (order.at ?? 0) >= 0 && (order.at ?? 0) < (order.points?.length ?? 0)) return mover;
  // Self-seeks never happen (guns only ever draw cross-team pairs); the
  // renderer also refuses seeker === target like the threat pipeline does.
  if (anchor && Math.hypot(ax - anchor.x, az - anchor.z) > THREAT_LEASH_RADIUS) return mover;
  const live = mover.threat && mover.threat.ttl > 0 ? mover.threat : undefined;
  if (live) {
    return {
      ...mover,
      threat: {
        attacker,
        x: ax,
        z: az,
        ttl: THREAT_MEMORY_DURATION,
        ...(live.leash !== undefined ? { leash: live.leash } : {}),
      },
    };
  }
  return { ...mover, threat: { attacker, x: ax, z: az, ttl: THREAT_MEMORY_DURATION } };
}

/**
 * HQ/structure assault: point an idle/patrolling hull at an enemy fort it is
 * shelling but cannot reach from where it stands (see `seekEngage`, whose
 * `-1` convention this shares), so the hull closes toward the fort, holds at
 * weapons-range stand-off, and resumes patrol if the fight moves on.
 *
 * Compared to `seekEngage`, two deliberate differences — the assault is a
 * commitment, not a waypoint:
 *
 * - The memory carries `structure: true`: the hunt sweep never clobbers it
 *   with a team advance (position waypoints still upgrade to live hunts, the
 *   assault is *restored* when no hunt acquires), and hits taken while
 *   assaulting count toward a challenger instead of stealing immediately
 *   (see `notifyThreat` + `HQ_DEFENSE_HITS`) — the hull deals with a
 *   consistent attacker first, then resumes the fort.
 * - A live grudge against a roster enemy (`attacker >= 0`) is never
 *   overwritten: a hull already fighting someone finishes that fight instead
 *   of turning for the fort mid-brawl. Live position waypoints (team
 *   advances) still yield to the assault like any other seek.
 *
 * Ordered/holding movers ignore the assault (player orders win) and the
 * patrol-anchor leash still applies (local pushes only). Pure: no rng, no
 * clocks.
 */
export function seekStructure<M extends { threat?: ThreatMemory; order?: unknown; hold?: boolean }>(
  mover: M,
  victim: { x: number; z: number },
  x: number,
  z: number,
  anchor?: ThreatAnchor | null,
): M {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return mover;
  if (!victim || !Number.isFinite(victim.x) || !Number.isFinite(victim.z)) return mover;
  if (mover.hold) return mover;
  const order = mover.order as { at?: number; points?: readonly unknown[] } | undefined;
  if (order && (order.at ?? 0) >= 0 && (order.at ?? 0) < (order.points?.length ?? 0)) return mover;
  if (anchor && Math.hypot(x - anchor.x, z - anchor.z) > THREAT_LEASH_RADIUS) return mover;
  const live = mover.threat && mover.threat.ttl > 0 ? mover.threat : undefined;
  if (live) {
    // Already answering a live enemy: finish that fight first (self-defense
    // before forts). The challenger record on an older assault survives —
    // the hull is already doing what the count would ask for.
    if (live.attacker >= 0) return mover;
    return {
      ...mover,
      threat: {
        attacker: -1,
        x,
        z,
        ttl: THREAT_MEMORY_DURATION,
        structure: true,
        ...(live.leash !== undefined ? { leash: live.leash } : {}),
        ...(live.challenger !== undefined ? { challenger: { ...live.challenger } } : {}),
      },
    };
  }
  return { ...mover, threat: { attacker: -1, x, z, ttl: THREAT_MEMORY_DURATION, structure: true } };
}

/**
 * Team-advance position memory: point an idle/patrolling hull at a team's
 * last-known enemy position (see `advanceMemory`), so a side that has found
 * the enemy keeps pushing that way instead of guarding its patrol loop after
 * contact is lost. Drives the same threat/pursuit pipeline retaliation uses
 * (stand-off hold, anchor leash, memory expiry — see `pursueStep`), with two
 * deliberate differences:
 *
 * - `attacker` is always -1 (a position, not a roster grudge — the same
 *   convention as an HQ structure seek): the drive falls back to the stored
 *   (`x`, `z`), and the memory never feeds squad focus or gun grudges.
 * - The disengage gate does not apply (see `pursueStep`): a last-known
 *   position cannot flee, so distance from it is the reason to advance, not
 *   a reason to give up. The patrol-anchor leash and memory expiry still
 *   release the hull, and the issue-side leash gate keeps the push local.
 * - Ordered/holding movers ignore the advance (player orders win), wrecks
 *   never carry it, and the strategic layer still gates cowardly commits
 *   (the renderer refuses advances while `shouldHold`).
 *
 * Pure: no rng, no clocks.
 */
export function advanceMemory(x: number, z: number, leash: number = HUNT_LEASH_RADIUS): ThreatMemory | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (!(leash > 0)) return null;
  return { attacker: -1, x, z, ttl: THREAT_MEMORY_DURATION, leash };
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

/**
 * Hunt acquisition: point an idle/patrolling hull at the nearest live enemy
 * it can see, reusing the threat/pursuit pipeline retaliation drives through
 * (stand-off hold, disengage give-up, memory expiry, frozen patrol leg — see
 * `pursueStep`). The memory carries the wider hunt leash, so a hull that
 * notices the enemy may chase it down instead of holding its loop.
 *
 * Pure: no rng, no clocks. The caller (renderer `UnitMovement`, which knows
 * the roster teams and which hulls are wrecks) sweeps idle hulls through
 * this; the drive, the give-ups, and the expiry all live in `movement.ts`.
 *
 * - Ordered/holding movers, movers already carrying a live memory, wrecks,
 *   and out-of-range callers refuse: only a free hull acquires.
 * - Only live enemies (`alive[i]`, opposite `teams[i]`) count — a hull never
 *   hunts its own side, a wreck, itself, or an unknown index.
 * - The nearest such enemy inside `HUNT_ENGAGE_RADIUS` of the victim *and*
 *   inside `HUNT_LEASH_RADIUS` of `anchor` takes the memory; anything farther
 *   is beneath notice and the patrol continues.
 */
export function acquireHunt<M extends { threat?: ThreatMemory; order?: unknown; hold?: boolean }>(
  mover: M,
  self: number,
  teams: readonly (number | undefined)[],
  foes: readonly { x: number; z: number }[],
  alive: readonly boolean[],
  anchor?: ThreatAnchor | null,
): M {
  if (!Number.isInteger(self) || self < 0 || self >= foes.length) return mover;
  if (alive[self] === false) return mover;
  if (mover.hold) return mover;
  const order = mover.order as { at?: number; points?: readonly unknown[] } | undefined;
  if (order && (order.at ?? 0) >= 0 && (order.at ?? 0) < (order.points?.length ?? 0)) return mover;
  if (mover.threat && mover.threat.ttl > 0) return mover;
  const side = teams[self];
  if (side === undefined) return mover;
  const me = foes[self];
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z)) return mover;
  let best = -1;
  let bestDist = HUNT_ENGAGE_RADIUS;
  for (let i = 0; i < foes.length; i++) {
    if (i === self) continue;
    if (alive[i] === false) continue;
    if (teams[i] === undefined || teams[i] === side) continue;
    const foe = foes[i];
    if (!foe || !Number.isFinite(foe.x) || !Number.isFinite(foe.z)) continue;
    const d = Math.hypot(foe.x - me.x, foe.z - me.z);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return mover;
  const target = foes[best]!;
  if (anchor && Math.hypot(target.x - anchor.x, target.z - anchor.z) > HUNT_LEASH_RADIUS) return mover;
  return {
    ...mover,
    threat: { attacker: best, x: target.x, z: target.z, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS },
  };
}
