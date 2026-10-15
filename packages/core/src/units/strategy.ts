import { HUNT_ENGAGE_RADIUS, HUNT_LEASH_RADIUS, THREAT_DISENGAGE_RADIUS, THREAT_MEMORY_DURATION } from "./retaliation.js";
import type { ThreatMemory } from "./retaliation.js";
import type { UnitKind } from "./types.js";

/**
 * Strategic skirmish layer: the "when / whom / with whom" above the
 * retaliation pipeline. Framework-free (no three.js) so the web renderer
 * and vitest share the same rules.
 *
 * Problem: retaliation + hunt made every hull charge the nearest contact
 * the moment it noticed one — lone scouts suicided into whole columns,
 * guns split fire across random pairs, and nobody ever waited for backup.
 * The drive (`movement.ts`) and the turret scheduler (`CombatFx`) already
 * knew *how* to fight; nothing decided *whether* the fight was winnable.
 *
 * Nanolathe parallel (adapted, no COB scripts here): retail TA units guard
 * a post, answer attackers inside it, and return — closer to this module
 * than to free-for-all brawling. The same idea, one level up: a hull
 * measures the local brawl before committing, joins its squad's fight
 * instead of starting its own, and holds facing the enemy (waiting for
 * backup) rather than charging alone into a group.
 *
 * Authority rules (decided, documented):
 * - Odds gate every commitment. Hunt acquisition refuses (the hull patrols
 *   on, waiting) and an in-progress pursuit holds in place facing the
 *   threat (the memory stays fresh, the rose trail stays lit) while local
 *   enemy strength outweighs friendly strength past `STRATEGY_HOLD_RATIO`.
 *   Allies are counted around *me* (who can back me up), enemies around
 *   the *threat* (what I would drive into) — so a scout charges a lone
 *   contact but stops at the edge of a column.
 * - Targets are scored, not nearest-only. Distance still dominates (guns
 *   must stay in range and skirmishes must keep happening), but a wounded
 *   enemy (finish the kill), the squad's focus (join teammates for focus
 *   fire instead of splitting shots), and the hull that shot me (answer
 *   the threat) all pull — deterministic, lowest index breaking ties.
 * - Health weights strength. A burning column counts less than a pristine
 *   one, so a damaged group invites the finish while a fresh one deters.
 *   Callers without damage state pass nothing and read everyone pristine.
 * - Player orders still win. This layer only steers idle/patrolling hulls
 *   and gun-target choice; ordered/holding hulls never consult it.
 * - Determinism: no rng, no wall clock. Same roster snapshot in, same
 *   decision out — replays stay identical.
 */

export interface StrategyPoint {
  x: number;
  z: number;
}

/**
 * Neighbourhood radius for the odds count, world units. Matches the
 * retaliation leash scale on purpose: the brawl that matters is the one a
 * hull could plausibly drive into, not the far side of the map.
 */
export const STRATEGY_ASSESS_RADIUS = 650;
/**
 * Hold line: a hull waits instead of committing while enemy effective
 * strength exceeds friendly effective strength by this factor. 1.5 keeps
 * even fights (1v1, 2v2, 3v3) and finishes (wounded groups count less)
 * flowing, while a lone hull facing 2+ fresh enemies holds. Deliberately
 * above 1 so mutual caution cannot stalemate equal columns.
 */
export const STRATEGY_HOLD_RATIO = 1.5;
/** Distance-equivalent pull of a fully-wounded enemy (scaled by missing hp). */
export const STRATEGY_WOUNDED_WEIGHT = 260;
/** Distance-equivalent pull per teammate already engaging a candidate. */
export const STRATEGY_FOCUS_WEIGHT = 170;
/** Distance-equivalent pull of the hull that shot me (answer the threat). */
export const STRATEGY_THREAT_WEIGHT = 120;
/** Distance-equivalent pull of staying on the current gun target (no thrash). */
export const STRATEGY_STICKY_WEIGHT = 200;
/**
 * Peewee scout notice radius, world units: the lightest hull carries the
 * sharpest eyes. Past the regular `HUNT_ENGAGE_RADIUS` (so a scout spots a
 * column its heavier teammates cannot see yet) yet inside the shared
 * disengage bound, so the hysteresis gap keeps a scouting hull on the
 * boundary from flickering like any other hunter.
 */
export const SCOUT_NOTICE_RADIUS = HUNT_ENGAGE_RADIUS + 400;
/**
 * Peewee scout leash, world units: a ranging scout may chase a contact
 * farther from its patrol anchor than a tank — still local (inside two map
 * half-widths on the doubled field), never a map-wide chase.
 */
export const SCOUT_LEASH_RADIUS = 2000;
/**
 * Peewee scout disengage radius, world units: an engaged scout tolerates a
 * contact out to here before letting go — the same 150-unit hysteresis gap
 * as the regular gates (engage 1500 < disengage 1650), so a scout on the
 * boundary does not flicker either. Without it the drive would drop every
 * scout-range acquisition on the first step.
 */
export const SCOUT_DISENGAGE_RADIUS = SCOUT_NOTICE_RADIUS + 150;

/**
 * True for the scout kind: the peewee ranges ahead, spots early, and probes
 * even when outnumbered — its live threat memory feeds `squadFocus` and the
 * sticky team contact, so the rest of the side engages what the scout found.
 */
export function isScoutKind(kind: UnitKind | undefined | null): boolean {
  return kind === "peewee";
}

/** Hunt notice radius for `kind` (scouts see farther, everyone else default). */
export function huntNoticeRadiusFor(kind?: UnitKind | null): number {
  return isScoutKind(kind ?? undefined) ? SCOUT_NOTICE_RADIUS : HUNT_ENGAGE_RADIUS;
}

/** Hunt leash for `kind` (scouts range wider, everyone else default). */
export function huntLeashFor(kind?: UnitKind | null): number {
  return isScoutKind(kind ?? undefined) ? SCOUT_LEASH_RADIUS : HUNT_LEASH_RADIUS;
}

/**
 * Disengage radius for `kind`: an active pursuit ends once the live attacker
 * is past this from the victim. Scouts hold scout-range contacts (see
 * `SCOUT_DISENGAGE_RADIUS`); everyone else keeps the shared bound, so
 * existing pursuit history is byte-identical.
 */
export function disengageRadiusFor(kind?: UnitKind | null): number {
  return isScoutKind(kind ?? undefined) ? SCOUT_DISENGAGE_RADIUS : THREAT_DISENGAGE_RADIUS;
}

/** Local force comparison around a hull: live counts plus health-weighted strength. */
export interface BattleOdds {
  /** Live teammates near the allies center (self excluded). */
  allies: number;
  /** Live enemies near the enemies center. */
  enemies: number;
  /** Health-weighted friendly strength (includes self at `selfHp`). */
  allyHp: number;
  /** Health-weighted enemy strength. */
  enemyHp: number;
}

/** Health fraction remaining (1 pristine .. 0 dead) for a roster index. */
function healthAt(hp: readonly number[] | null | undefined, index: number): number {
  const v = hp?.[index];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 1;
}

/**
 * Weigh the local brawl: friendly strength around `alliesCenter` (who can
 * back me up — counted around my position) against enemy strength around
 * `enemiesCenter` (what I would drive into — counted around the threat).
 * The two centers split on purpose: charging a scout standing apart from
 * its column reads winnable, charging into the column does not. Self counts
 * once at `selfHp`; unknown sides contribute to neither strength.
 */
export function battleOdds(
  self: number,
  selfSide: number,
  selfHp: number,
  alliesCenter: StrategyPoint,
  enemiesCenter: StrategyPoint,
  positions: readonly StrategyPoint[],
  teams: readonly (number | undefined)[],
  alive: readonly boolean[],
  hp?: readonly number[] | null,
  radius = STRATEGY_ASSESS_RADIUS,
): BattleOdds {
  let allies = 0;
  let enemies = 0;
  let allyHp = 0;
  let enemyHp = 0;
  if (!(radius > 0)) return { allies, enemies, allyHp, enemyHp };
  const clampedSelf = Math.min(Math.max(selfHp, 0), 1);
  allyHp += clampedSelf;
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    if (alive[i] === false) continue;
    const side = teams[i];
    if (side === undefined) continue;
    const p = positions[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (side === selfSide) {
      if (Math.hypot(p.x - alliesCenter.x, p.z - alliesCenter.z) <= radius) {
        allies++;
        allyHp += healthAt(hp, i);
      }
    } else {
      if (Math.hypot(p.x - enemiesCenter.x, p.z - enemiesCenter.z) <= radius) {
        enemies++;
        enemyHp += healthAt(hp, i);
      }
    }
  }
  return { allies, enemies, allyHp, enemyHp };
}

/**
 * True while committing would be suicide: live enemies near `enemiesCenter`
 * outweigh friendly strength near `alliesCenter` past `STRATEGY_HOLD_RATIO`.
 * Unknown sides, dead callers, and empty battlefields never hold — and a
 * hull with no live enemies nearby never holds either (there is nothing to
 * wait out; the notice gates handle range).
 */
export function outnumbered(
  self: number,
  alliesCenter: StrategyPoint,
  enemiesCenter: StrategyPoint,
  positions: readonly StrategyPoint[],
  teams: readonly (number | undefined)[],
  alive: readonly boolean[],
  hp?: readonly number[] | null,
  radius = STRATEGY_ASSESS_RADIUS,
): boolean {
  if (!Number.isInteger(self) || self < 0 || self >= positions.length) return false;
  if (alive[self] === false) return false;
  const side = teams[self];
  if (side === undefined) return false;
  const odds = battleOdds(
    self, side, healthAt(hp, self),
    alliesCenter, enemiesCenter, positions, teams, alive, hp, radius,
  );
  if (odds.enemies === 0) return false;
  return odds.enemyHp > odds.allyHp * STRATEGY_HOLD_RATIO;
}

/**
 * True while an idle hull at its own position should wait instead of
 * acquiring a fight: the brawl around *it* is already lost. The pursuit
 * drive asks the wider question (`outnumbered` at the threat) once a chase
 * is underway; this is the acquisition gate.
 */
export function shouldHold(
  self: number,
  positions: readonly StrategyPoint[],
  teams: readonly (number | undefined)[],
  alive: readonly boolean[],
  hp?: readonly number[] | null,
  radius = STRATEGY_ASSESS_RADIUS,
): boolean {
  const me = positions[self];
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z)) return false;
  return outnumbered(self, me, me, positions, teams, alive, hp, radius);
}

/**
 * The squad's focus: the live enemy most teammates are already pursuing
 * (by live threat memory), or -1 when nobody on `team` is engaged. Ties
 * break to the lowest roster index so the choice replays deterministically.
 * Only memories pointing at live opposite-side hulls count — grudges
 * against wrecks, mates, or unknown sides never focus fire.
 */
export function squadFocus(
  team: number,
  threats: readonly (ThreatMemory | undefined)[],
  teams: readonly (number | undefined)[],
  alive: readonly boolean[],
): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < threats.length; i++) {
    if (alive[i] === false) continue;
    if (teams[i] !== team) continue;
    const target = threats[i]?.attacker;
    if (target === undefined || !Number.isInteger(target) || target < 0 || target >= alive.length) continue;
    if (alive[target] === false) continue;
    if (teams[target] === undefined || teams[target] === team) continue;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  let best = -1;
  let bestCount = 0;
  for (const [target, count] of counts) {
    if (count > bestCount || (count === bestCount && (best < 0 || target < best))) {
      best = target;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Score a candidate target: distance dominates (guns must stay in range),
 * lower wins. Wounded enemies pull (finish the kill), squad focus pulls per
 * teammate already on the target (focus fire over split shots), answering
 * the hull that shot me pulls, and staying on the current gun target pulls
 * (no aim thrash). Pure arithmetic — the callers own the filtering.
 */
export function targetScore(
  distance: number,
  enemyHp: number,
  focusCount: number,
  isThreat: boolean,
  isSticky: boolean,
): number {
  const missing = 1 - Math.min(Math.max(enemyHp, 0), 1);
  return (
    distance -
    missing * STRATEGY_WOUNDED_WEIGHT -
    Math.max(focusCount, 0) * STRATEGY_FOCUS_WEIGHT -
    (isThreat ? STRATEGY_THREAT_WEIGHT : 0) -
    (isSticky ? STRATEGY_STICKY_WEIGHT : 0)
  );
}

export interface TargetOptions {
  /** Health fractions remaining, parallel to positions; absent reads pristine. */
  hp?: readonly number[] | null;
  /** Squad focus index (see `squadFocus`); -1/absent means no focus. */
  focus?: number;
  /** The hull that shot me, answered preferentially; absent means no grudge. */
  threatAttacker?: number;
  /** Notice gate: candidates farther than this from self are beneath notice. */
  maxDist?: number;
  /** Leash center (patrol anchor): candidates past `leash` from it are out. */
  anchor?: StrategyPoint | null;
  /** Leash radius from the anchor; defaults to the hunt leash when anchored. */
  leash?: number;
  /**
   * Scout eyes: use the wider scout notice/leash defaults instead of the
   * regular hunt gates (see `SCOUT_NOTICE_RADIUS` / `SCOUT_LEASH_RADIUS`).
   * Explicit `maxDist`/`leash` still win when provided.
   */
  scout?: boolean;
}

/**
 * Pick whom to fight: the best-scoring live enemy — nearest first, with
 * wounded/focus/threat pulls (see `targetScore`) — or -1 when nothing is
 * worth engaging. Filters mirror `acquireHunt` (live enemies only, never
 * self/mates/wrecks/unknown sides, inside the notice gate and the anchor
 * leash), so this drops into the hunt pipeline byte-compatibly for even
 * fights while steering mismatches sensibly. Ties break to the lowest
 * roster index.
 */
export function chooseTarget(
  self: number,
  positions: readonly StrategyPoint[],
  teams: readonly (number | undefined)[],
  alive: readonly boolean[],
  opts?: TargetOptions,
): number {
  if (!Number.isInteger(self) || self < 0 || self >= positions.length) return -1;
  if (alive[self] === false) return -1;
  const side = teams[self];
  if (side === undefined) return -1;
  const me = positions[self];
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z)) return -1;
  const maxDist = opts?.maxDist ?? (opts?.scout ? SCOUT_NOTICE_RADIUS : HUNT_ENGAGE_RADIUS);
  if (!(maxDist > 0)) return -1;
  const anchor = opts?.anchor ?? null;
  const leash = opts?.leash ?? (opts?.scout ? SCOUT_LEASH_RADIUS : HUNT_LEASH_RADIUS);
  const focus = opts?.focus ?? -1;
  const threatAttacker = opts?.threatAttacker ?? -1;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    if (alive[i] === false) continue;
    const foeSide = teams[i];
    if (foeSide === undefined || foeSide === side) continue;
    const foe = positions[i];
    if (!foe || !Number.isFinite(foe.x) || !Number.isFinite(foe.z)) continue;
    const dist = Math.hypot(foe.x - me.x, foe.z - me.z);
    if (!(dist <= maxDist)) continue;
    if (anchor && !(Math.hypot(foe.x - anchor.x, foe.z - anchor.z) <= leash)) continue;
    const score = targetScore(
      dist,
      healthAt(opts?.hp, i),
      i === focus ? 1 : 0,
      i === threatAttacker,
      false,
    );
    if (score < bestScore || (score === bestScore && (best < 0 || i < best))) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Hunt acquisition with judgment: the same refusals as `acquireHunt`
 * (ordered/holding/busy/wrecked hulls never acquire, unknown sides acquire
 * nothing), plus two strategic gates —
 *
 * - an outnumbered hull waits instead of charging alone (`shouldHold`) —
 *   unless it is a peewee scout (`kinds[self]`): scouts probe even when
 *   outnumbered, shadowing at range (the drive still holds an outnumbered
 *   pursuer facing the threat instead of closing) so the side keeps eyes on
 *   the enemy and shares the contact via `squadFocus`;
 * - the quarry is *chosen* (`chooseTarget` over the squad focus), so a hull
 *   joins its squad's fight and prefers wounded enemies over fresh ones.
 *
 * Scouts acquire on the wider scout gates (`SCOUT_NOTICE_RADIUS` /
 * `SCOUT_LEASH_RADIUS`); every other kind resolves exactly like before.
 * The memory carries the matching leash. Pure: no rng,
 * no clocks. Even fights resolve exactly like `acquireHunt` (nearest live
 * enemy inside both gates).
 */
export function acquireStrategicHunt<
  M extends { threat?: ThreatMemory; order?: unknown; hold?: boolean },
>(
  mover: M,
  self: number,
  teams: readonly (number | undefined)[],
  foes: readonly { x: number; z: number }[],
  alive: readonly boolean[],
  anchor?: StrategyPoint | null,
  threats?: readonly (ThreatMemory | undefined)[] | null,
  hp?: readonly number[] | null,
  kinds?: readonly (UnitKind | undefined)[] | null,
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
  const scout = isScoutKind(kinds?.[self]);
  // Courage check first: a hull that would lose the local brawl patrols on
  // and waits for backup instead of starting a fight it cannot finish.
  // Scouts are exempt — probing alone is their job; the drive holds them at
  // eyes-on distance until backup arrives, and their memory focuses the squad.
  if (!scout && shouldHold(self, foes, teams, alive, hp)) return mover;
  const focus = threats ? squadFocus(side, threats, teams, alive) : -1;
  const pick = chooseTarget(self, foes, teams, alive, {
    hp,
    focus,
    maxDist: scout ? SCOUT_NOTICE_RADIUS : HUNT_ENGAGE_RADIUS,
    anchor: anchor ?? null,
    leash: scout ? SCOUT_LEASH_RADIUS : HUNT_LEASH_RADIUS,
    scout,
  });
  if (pick < 0) return mover;
  const target = foes[pick]!;
  return {
    ...mover,
    threat: {
      attacker: pick,
      x: target.x,
      z: target.z,
      ttl: THREAT_MEMORY_DURATION,
      leash: scout ? SCOUT_LEASH_RADIUS : HUNT_LEASH_RADIUS,
    },
  };
}

export interface GunTargetOptions {
  /** Health fractions remaining, parallel to positions; absent reads pristine. */
  hp?: readonly number[] | null;
  /** Roster indices already under fire (the scheduler's pending aims). */
  focusCounts?: readonly number[] | null;
  /** Currently-aimed target of this attacker (stay on target, no thrash). */
  sticky?: number;
  /** Admission gate: prefer candidates inside this distance; falls back wide. */
  maxDist?: number;
}

/**
 * Gun-target choice for the ambient scheduler: which live enemy `attacker`
 * should shoot. Distance-first like the old uniform draw (so admitted,
 * in-range duels keep their pace), steered by wounded/focus/sticky pulls —
 * guns finish burning hulls and pile onto the squad's target instead of
 * spreading shots across the roster. Candidates inside `maxDist` win over
 * farther ones; when nothing is admitted, the best far target still returns
 * (the launch gate retries, exactly like the old random-far-pair rhythm).
 * Returns -1 when no live enemy exists. Pure: no rng — the caller draws the
 * attacker uniformly and aims deterministically.
 */
export function pickStrategicTarget(
  attacker: number,
  positions: readonly StrategyPoint[],
  teams: readonly (number | undefined)[],
  alive: readonly boolean[],
  opts?: GunTargetOptions,
): number {
  if (!Number.isInteger(attacker) || attacker < 0 || attacker >= positions.length) return -1;
  if (alive[attacker] === false) return -1;
  const side = teams[attacker];
  if (side === undefined) return -1;
  const me = positions[attacker];
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z)) return -1;
  const focusOf = (i: number): number => {
    const counts = opts?.focusCounts;
    if (!counts) return 0;
    let n = 0;
    for (const t of counts) if (t === i) n++;
    return n;
  };
  const sticky = opts?.sticky ?? -1;
  const maxDist = opts?.maxDist;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAdmitted = false;
  for (let i = 0; i < positions.length; i++) {
    if (i === attacker) continue;
    if (alive[i] === false) continue;
    const foeSide = teams[i];
    if (foeSide === undefined || foeSide === side) continue;
    const foe = positions[i];
    if (!foe || !Number.isFinite(foe.x) || !Number.isFinite(foe.z)) continue;
    const dist = Math.hypot(foe.x - me.x, foe.z - me.z);
    if (!(dist >= 0)) continue;
    const admitted = maxDist === undefined || maxDist === null ? true : dist <= maxDist;
    // An admitted candidate always beats an unadmitted one; within each
    // tier the strategic score decides.
    const score = targetScore(dist, healthAt(opts?.hp, i), focusOf(i), false, i === sticky);
    if (admitted && !bestAdmitted) {
      best = i;
      bestScore = score;
      bestAdmitted = true;
    } else if (admitted === bestAdmitted && (score < bestScore || (score === bestScore && (best < 0 || i < best)))) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}
