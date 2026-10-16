/**
 * Shared team enemy intel: what each side knows about the enemy.
 * Framework-free (no three.js) so the web renderer and vitest share the
 * same rules.
 *
 * Problem: each team kept a single sticky last-known contact — one point
 * per side, never expiring, refreshed only while a teammate actively
 * pursued. Two enemy groups in different directions collapsed to one
 * (the records flapped or one group stayed unknown), a hull that merely
 * *saw* the enemy shared nothing (ordered, holding, and outnumbered hulls
 * never acquire, so their eyes were wasted), and a stale spot marched the
 * side forever — on the doubled field that reads as units getting
 * genuinely lost. Each side now keeps a per-enemy memory: every hull's
 * eyes feed the board, and every free hull advances on its nearest
 * remembered contact.
 *
 * Nanolathe parallel (adapted, no engine hooks here): the Modern AI
 * observer keeps a `Remembered` record per sighted enemy handle — last
 * observed position plus a `LastSeen` tick — refreshed by visible
 * contacts and dropped when the record ages out (60 s for mobiles,
 * buildings never) or the owner looks at the spot again and finds
 * nothing (the rally probe). Same three answers here, keyed by roster
 * index instead of pool handle:
 *
 * - Remembered sightings: `rememberSighting` records (or refreshes) one
 *   enemy's last-known position with the sim timestamp. Hull contacts
 *   key by roster index (>= 0); spotted forts key by `fortIntelKey`
 *   (negative, one per enemy HQ team), so hull and fort contacts coexist
 *   instead of clobbering one contact point.
 * - Finite memory: `sweepIntel` drops mobile records unseen for
 *   `INTEL_MEMORY_DURATION` (forts never age — a works does not move,
 *   so its last-known never goes stale) and drops records whose subject
 *   is gone (dead hulls, wrecked forts), so nobody marches on corpses.
 * - Confirm-gone: a record whose subject has moved on drops once a live
 *   teammate stands within `INTEL_CONFIRM_RADIUS` of the remembered
 *   spot — the side looked, found nothing, and stops going back.
 *
 * Authority rules (decided, documented):
 * - Spotting is passive, pursuit is gated. Any live hull's eyes feed the
 *   board — ordered, holding, threatened, and outnumbered hulls all
 *   report — but only free hulls *act* on it (advances still refuse
 *   exactly like hunts: player orders win, outnumbered non-scouts wait).
 * - The board is knowledge, not orders. It names last-known positions;
 *   the threat pipeline (`advanceMemory` on the team-advance leash)
 *   still drives the march, with the same give-ups.
 * - Determinism: no rng, no wall clock. `seenAt`/`now` are sim seconds
 *   from the caller's deterministic clock, and ties break to the lowest
 *   subject key — same sighting sequence in, same board out.
 */
export interface EnemyIntel {
  /** Last-known subject position, world units. */
  x: number;
  /** Last-known subject position, world units. */
  z: number;
  /** Sim seconds when the subject was last seen (or heard, via damage). */
  seenAt: number;
  /**
   * True for a spotted fort (see `fortIntelKey`): structures never expire
   * (a works does not move) and drop only when the fort is gone.
   */
  structure?: boolean;
}

/** One side's memories: subject key (roster index, or `fortIntelKey`) to intel. */
export type TeamIntel = Map<number, EnemyIntel>;

/** The shared board: team id to that side's memories. Sweep-owned, mutated in place. */
export type IntelBoard = Map<number, TeamIntel>;

/**
 * Seconds a mobile sighting stays actionable without a refresh. Five
 * threat-memory lifetimes (see `THREAT_MEMORY_DURATION`): long enough for
 * a side to march a contact across the doubled field, short enough that a
 * lost enemy is forgotten instead of marched on forever. Matches the
 * nanolathe mobile memory limit (60 s).
 */
export const INTEL_MEMORY_DURATION = 60;
/**
 * Re-observe radius, world units: a live teammate this close to a
 * remembered spot whose subject has moved on confirms the contact gone
 * (see `sweepIntel`) — the side looked and found nothing. Sized past the
 * closest stand-off (a holder duelling at 180–220 of a live enemy must
 * never confirm-gone its own fight) yet inside a neighbourhood, so only a
 * hull genuinely at the spot forgets it.
 */
export const INTEL_CONFIRM_RADIUS = 250;

/**
 * Board key for a spotted enemy fort of HQ team `hqTeam`: negative, one
 * per side, disjoint from the >= 0 roster-index hull keys. Null for an
 * invalid team (refused — never a record).
 */
export function fortIntelKey(hqTeam: number): number | null {
  if (!Number.isInteger(hqTeam) || hqTeam < 0) return null;
  return -(hqTeam + 1);
}

/** True for a fort key (see `fortIntelKey`), false for hull keys and junk. */
export function isFortIntelKey(key: number): boolean {
  return Number.isInteger(key) && key < 0;
}

/**
 * HQ team behind a fort key (the inverse of `fortIntelKey`), or null for
 * hull keys and junk.
 */
export function fortIntelTeam(key: number): number | null {
  if (!isFortIntelKey(key)) return null;
  return -1 - key;
}

/**
 * Record (or refresh) what `team` knows about one enemy `key`: a roster
 * index for a hull, `fortIntelKey` for a spotted fort (`structure` then).
 * Overwrites position and clock — fresh information wins. Refuses invalid
 * boards, teams, keys, positions, and timestamps (the board keeps its old
 * record, if any). Mutates the sweep-owned board in place.
 */
export function rememberSighting(
  board: IntelBoard,
  team: number,
  key: number,
  x: number,
  z: number,
  now: number,
  structure = false,
): void {
  if (!(board instanceof Map)) return;
  if (!Number.isInteger(team) || team < 0) return;
  if (!Number.isInteger(key)) return;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  if (!Number.isFinite(now)) return;
  let records = board.get(team);
  if (!(records instanceof Map)) {
    records = new Map<number, EnemyIntel>();
    board.set(team, records);
  }
  records.set(key, structure ? { x, z, seenAt: now, structure: true } : { x, z, seenAt: now });
}

/** True while `team` remembers at least one enemy contact. */
export function hasIntel(board: IntelBoard, team: number): boolean {
  if (!(board instanceof Map)) return false;
  if (!Number.isInteger(team) || team < 0) return false;
  return (board.get(team)?.size ?? 0) > 0;
}

export interface NearestIntelOptions {
  /** Leash center (patrol anchor): contacts past `leash` from it are out. */
  anchor?: { x: number; z: number } | null;
  /** Leash radius from the anchor; no gate without a valid anchor + leash. */
  leash?: number;
}

/**
 * The remembered contact of `team` nearest to (`x`, `z`) — the spot a
 * free hull advances on — or null when the side knows nothing (or nothing
 * in leash). Ties break to the lowest subject key so the choice replays
 * deterministically. Corrupt records (non-finite positions) never win.
 */
export function nearestIntel(
  board: IntelBoard,
  team: number,
  x: number,
  z: number,
  opts?: NearestIntelOptions,
): { key: number; x: number; z: number } | null {
  if (!(board instanceof Map)) return null;
  if (!Number.isInteger(team) || team < 0) return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const records = board.get(team);
  if (!records || records.size === 0) return null;
  const anchor = opts?.anchor ?? null;
  const leash = opts?.leash ?? NaN;
  const gated =
    anchor !== null &&
    Number.isFinite(anchor.x) &&
    Number.isFinite(anchor.z) &&
    typeof leash === "number" &&
    leash > 0;
  const leash2 = gated ? (leash as number) * (leash as number) : -1;
  const gatedAnchor = gated ? anchor : null;
  let best: { key: number; x: number; z: number } | null = null;
  let bestDist2 = Number.POSITIVE_INFINITY;
  for (const [key, intel] of records) {
    if (!intel || !Number.isFinite(intel.x) || !Number.isFinite(intel.z)) continue;
    if (gatedAnchor) {
      const lx = intel.x - gatedAnchor.x;
      const lz = intel.z - gatedAnchor.z;
      if (lx * lx + lz * lz > leash2) continue;
    }
    const dx = intel.x - x;
    const dz = intel.z - z;
    const dist2 = dx * dx + dz * dz;
    if (dist2 < bestDist2 || (dist2 === bestDist2 && (best === null || key < best.key))) {
      bestDist2 = dist2;
      best = { key, x: intel.x, z: intel.z };
    }
  }
  return best;
}

/**
 * Sweep-wide intel maintenance: drop what the side should forget, in one
 * pass (see the header). For each record, in order:
 *
 * - Gone subjects drop: `locate` returns null (or a non-finite position)
 *   for dead hulls and wrecked forts — nobody marches on corpses.
 * - Stale mobiles drop: unseen for longer than `ttl` (forts never age).
 * - Confirmed-gone drops: the subject's live position sits farther than
 *   `confirmRadius` from the remembered spot while a live teammate stands
 *   within `confirmRadius` of it — the side re-observed the spot and
 *   found nothing. A subject still at its spot is never dropped, however
 *   many teammates surround it.
 *
 * Teams left with no records are pruned, so `hasIntel` reads false for a
 * side that forgot everything. Non-positive `ttl`/`confirmRadius` skip
 * that pass (dead subjects still drop). Refuses invalid boards, clocks,
 * and resolvers. Mutates the sweep-owned board in place. Pure otherwise:
 * no rng, no wall clock.
 */
export function sweepIntel(
  board: IntelBoard,
  now: number,
  teams: readonly (number | undefined)[],
  positions: readonly { x: number; z: number }[],
  alive: readonly boolean[],
  locate: (team: number, key: number) => { x: number; z: number } | null,
  ttl: number = INTEL_MEMORY_DURATION,
  confirmRadius: number = INTEL_CONFIRM_RADIUS,
): void {
  if (!(board instanceof Map)) return;
  if (!Number.isFinite(now)) return;
  if (typeof locate !== "function") return;
  for (const [team, records] of board) {
    if (!(records instanceof Map)) {
      board.delete(team);
      continue;
    }
    for (const [key, intel] of records) {
      if (!intel || !Number.isFinite(intel.x) || !Number.isFinite(intel.z) || !Number.isFinite(intel.seenAt)) {
        records.delete(key);
        continue;
      }
      const subject = locate(team, key);
      if (!subject || !Number.isFinite(subject.x) || !Number.isFinite(subject.z)) {
        records.delete(key);
        continue;
      }
      if (intel.structure !== true && ttl > 0 && now - intel.seenAt > ttl) {
        records.delete(key);
        continue;
      }
      if (confirmRadius > 0) {
        const mx = subject.x - intel.x;
        const mz = subject.z - intel.z;
        if (
          mx * mx + mz * mz > confirmRadius * confirmRadius &&
          teammateAtSpot(team, intel, teams, positions, alive, confirmRadius)
        ) {
          records.delete(key);
        }
      }
    }
    if (records.size === 0) board.delete(team);
  }
}

/** True while a live teammate of `team` stands within `radius` of the remembered spot. */
function teammateAtSpot(
  team: number,
  intel: EnemyIntel,
  teams: readonly (number | undefined)[],
  positions: readonly { x: number; z: number }[],
  alive: readonly boolean[],
  radius: number,
): boolean {
  const r2 = radius > 0 ? radius * radius : -1;
  const zero = radius === 0;
  for (let j = 0; j < positions.length; j++) {
    if (teams[j] !== team) continue;
    if (alive[j] === false) continue;
    const mate = positions[j];
    if (!mate || !Number.isFinite(mate.x) || !Number.isFinite(mate.z)) continue;
    const dx = mate.x - intel.x;
    const dz = mate.z - intel.z;
    // Squared reach (a zero radius still admits a mate standing exactly on
    // the spot, like the old hypot gate; negative/NaN admits nothing).
    if (dx * dx + dz * dz <= r2 || (zero && dx === 0 && dz === 0)) return true;
  }
  return false;
}
