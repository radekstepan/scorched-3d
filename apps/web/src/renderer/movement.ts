import * as THREE from "three";
import {
  acquireStrategicHunt,
  advanceMemory,
  advanceMovers,
  canSpotPoint,
  clearThreat,
  eyeHeight,
  findWorldPath,
  formationTargets,
  groupSpeedCap,
  hasOrder,
  hasThreat,
  HULL_TILT_SLEW,
  huntNoticeRadiusFor,
  initMover,
  isScoutKind,
  notifyThreat,
  orderMover,
  seekEngage,
  seekStructure,
  shouldHold,
  slewTilt,
  snappedFormationTargets,
  squadFocus,
  STRUCTURE_SIGHT_LIFT,
  stunMover,
  TEAM_ADVANCE_LEASH_RADIUS,
  THREAT_MEMORY_DURATION,
  type CrushContext,
  type HullSeat,
  type Mover,
  type PlacedUnit,
  type RoutePoint,
  type SeatField,
  type SightContext,
  type ThreatMemory,
  type TreeStand,
  type UnitKind,
} from "@scorched-3d/core";
import { advanceLocomotion, applyIdleTremble, clearIdleTremble } from "./units";

/**
 * Thin three.js patrol driver: each unit body follows its core looping route
 * (positions + hull yaw from `advanceMovers`), seated on the terrain surface
 * every tick via the `seat` pose (continuous height + hull pitch/roll to the
 * local grade, so hulls ride slopes instead of clipping through them) with a
 * `groundY + 0.5` flat fallback when no seat is provided. Height-exaggeration
 * changes only need a re-seat.
 * The turret/torso subgroup rotation is never touched here — combat aim
 * (external-hull mode) owns it, so turrets track targets independently
 * while hulls face the direction of travel. Drive locomotion (wheel spin,
 * walker gait from travelled distance per tick) is posed here alongside
 * the seat, and live hulls at rest breathe faintly with engine-idle
 * sway (tilt-only, visual only: movers never move). Owns no scene objects, so
 * dispose just stops updates; regen builds a fresh instance.
 */
export interface MovementEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
  /**
   * Full seated pose (surface height + hull pitch/roll) at world (x, z) for
   * a hull on the given yaw. Optional so headless tests can drive on flat
   * `groundY` alone; live play always provides it.
   */
  seat?: (x: number, z: number, hull: number, kind: UnitKind) => HullSeat;
  /**
   * Fired for every moved unit per tick so recoil anchors in combat FX can
   * follow (otherwise the kick restore would snap the hull backward).
   */
  onShift?: (index: number, dx: number, dz: number) => void;
  /**
   * Live tree stands for visibility: wood on the eye-to-eye line shrinks
   * the hunt notice gate (see `visibility.ts`). Optional so headless tests
   * can hunt on open ground; live play shares the canvas per-tick stands
   * snapshot with combat interception and the occlusion x-ray.
   */
  treeStands?: () => TreeStand[];
}

export class UnitMovement {
  private units: THREE.Group;
  private routes: RoutePoint[][];
  private kinds: UnitKind[];
  private movers: Mover[];
  private env: MovementEnv;
  private field: SeatField | null;
  private crush: CrushContext | null;
  private disposed = false;
  /**
   * Deterministic engine-idle clock, seconds (advanced by `update` only):
   * the breathing phase reads this, so the same tick sequence replays the
   * same sway with no rng and no per-frame allocation.
   */
  private elapsed = 0;
  /**
   * Wreck flags by unit index: a destroyed hull holds position forever
   * (mover frozen, orders refused) while its body stays in the scene as a
   * smouldering wreck. Live hulls still spacing-avoid wrecks through the
   * shared core separation (positions stay in the field), so nobody drives
   * through a wreck — but wrecks themselves never move.
   */
  private destroyed: boolean[] = [];
  /**
   * Sticky per-team contact: the last-known live enemy position each side
   * has found (refreshed from the squad focus while any teammate pursues a
   * live enemy, kept after contact is lost). A side that has found the
   * enemy keeps pushing that way — idle hulls advance toward the contact
   * instead of guarding their patrol loop (see `sweepHunt`). Null until a
   * side first engages, so unblooded sides patrol exactly as before.
   */
  private teamContact = new Map<number, { x: number; z: number }>();
  /**
   * Live enemy HQ positions per team (`{ x, z, team }`, wrecks excluded),
   * provided by the canvas from `HqFx.targets()`: the sweep spots forts
   * inside each hull's notice gate and shares the sighting team-wide, so a
   * scout that ranges onto the enemy works points the whole side at it.
   * Null until wired — headless groups spot nothing.
   */
  private hqProvider: (() => { x: number; z: number; team: number }[]) | null = null;
  /**
   * Per-unit accumulated damage 0..1, fed from combat once per tick (see
   * `setDamage`): the strategic layer reads remaining health from it, so
   * burning columns count for less than pristine ones when hulls weigh
   * whether a fight is winnable. Null until the first feed — odds then read
   * everyone pristine (counts only), matching headless history.
   */
  private damage: readonly number[] | null = null;

  constructor(
    units: THREE.Group,
    routes: RoutePoint[][],
    env: MovementEnv,
    field?: SeatField | null,
    crush?: CrushContext | null,
  ) {
    this.units = units;
    this.routes = routes;
    this.env = env;
    this.field = field ?? null;
    this.crush = crush ?? null;
    const placed = (units.userData.units as PlacedUnit[] | undefined) ?? [];
    this.kinds = units.children.map((_, i) => placed[i]?.kind ?? "flash");
    // Seed patrol state from live bodies (spawn == route waypoint 0, so the
    // first leg starts without a teleport).
    this.movers = units.children.map((child, i) => {
      const body = child as THREE.Group;
      const mover = initMover(routes[i] ?? [], body.rotation.y);
      mover.x = body.position.x;
      mover.z = body.position.z;
      return mover;
    });
    this.resnap();
  }

  /** Live patrol state of a unit (position + hull + target leg), for tests. */
  moverState(index: number): Mover | null {
    const mover = this.movers[index];
    if (!mover) return null;
    return {
      ...mover,
      order: mover.order
        ? {
            at: mover.order.at,
            points: mover.order.points,
            ...(mover.order.groupSpeed !== undefined ? { groupSpeed: mover.order.groupSpeed } : {}),
          }
        : undefined,
      threat: mover.threat ? { ...mover.threat } : undefined,
    };
  }

  /** Live world-space X/Z of every unit, for selection projection + minimap. */
  positions(): { x: number; z: number }[] {
    return this.movers.map((m) => ({ x: m.x, z: m.z }));
  };

  /** Roster size (drive-state polling for track trails, waypoint overlay). */
  get unitCount(): number {
    return this.movers.length;
  }

  /** True while the unit is driving a player-issued move order. */
  hasOrder(index: number): boolean {
    const mover = this.movers[index];
    return mover ? hasOrder(mover) : false;
  }

  /**
   * Unit kind per index, for driven-path prediction (per-kind speed and
   * turn rate shape the arcs). Falls back to flash for unknown indices so
   * headless tests can drive without a roster.
   */
  kindAt(index: number): UnitKind {
    return this.kinds[index] ?? "flash";
  }

  /** True once the unit has died and holds as a wreck. */
  isDestroyed(index: number): boolean {
    return this.destroyed[index] ?? false;
  }

  /**
   * Freeze a unit as a wreck: drop any live order/patrol leg, hold position,
   * and refuse all future orders. The body is untouched (combat owns the
   * char tint; the pose stays seated where it died). Idempotent.
   */
  markDestroyed(index: number): void {
    const mover = this.movers[index];
    if (!mover) return;
    this.destroyed[index] = true;
    const { stun: _dropped, recoil: _absorbed, threat: _calmed, ...rest } = mover;
    this.movers[index] = { ...rest, order: undefined, hold: true };
  }

  /**
   * Recoil a live hull away from a splash dealing `damageAdd` fractional
   * damage at world (`blastX`, `blastZ`) (core `stunMover`: refresh the beat
   * under the caps and stack the blast's shove onto the slide). The hull
   * recoils away from the hit while the renderer-side impact rock plays the
   * visible jerk back, then resumes its drive — the slide is terrain-gated,
   * so spacing, separation, and slope gating never fight it. Wrecks refuse
   * the stun (they hold forever); non-positive damage is a no-op, and a hit
   * without a blast position holds through the beat instead of sliding.
   * Idempotent per tick: re-hits refresh, they never stack past the cap.
   */
  stunUnit(index: number, damageAdd: number, blastX?: number, blastZ?: number): void {
    const mover = this.movers[index];
    if (!mover || this.destroyed[index]) return;
    const blast =
      blastX !== undefined && blastZ !== undefined ? { x: blastX, z: blastZ } : undefined;
    this.movers[index] = stunMover(mover, damageAdd, blast);
  }

  /**
   * Point a live hull at its attacker from (`ax`, `az`) (core
   * `notifyThreat` against the patrol anchor, so only idle/patrolling hulls
   * with a near, reachable threat pursue — ordered/holding hulls refuse).
   * Arcing shell wounds (`shell`) investigate past the retaliation gates on
   * the hunt leash instead of staying silent, so a tank being shelled turns
   * toward the firing position. Wrecks refuse the memory (they hold
   * forever), a hull never blames itself (own-blast self-splashes are
   * ignored), and same-team attackers never draw retaliation (friendly
   * shells are honest splash, never a grudge). Idempotent per tick: re-hits
   * refresh the memory, they never stack.
   */
  threatenUnit(victim: number, attacker: number, ax: number, az: number, shell = false): void {
    const mover = this.movers[victim];
    if (!mover || this.destroyed[victim]) return;
    if (victim === attacker) return;
    const victimTeam = this.teamAt(victim);
    if (victimTeam !== undefined && victimTeam === this.teamAt(attacker)) return;
    // Team-wide alert: the side learns the attacker's position the moment a
    // mate takes fire — even when the victim itself refuses the memory
    // (ordered/holding hulls never pursue, but their mates still reinforce).
    // Damage is ground truth (the shooter is always inside weapon range), so
    // no engage gate applies; the sweep turns the contact into advances.
    if (victimTeam !== undefined && Number.isFinite(ax) && Number.isFinite(az)) {
      this.teamContact.set(victimTeam, { x: ax, z: az });
    }
    const anchor = this.routes[victim]?.[0] ?? null;
    this.movers[victim] = notifyThreat(mover, mover, attacker, ax, az, anchor, shell);
  }

  /** True while the unit carries a live retaliation threat memory. */
  hasThreat(index: number): boolean {
    const mover = this.movers[index];
    return mover ? hasThreat(mover) : false;
  }

  /**
   * True while the unit is answering a live enemy: a live grudge against a
   * roster hull (`threat.attacker >= 0`) on its drive. The gun layer reads
   * this to hold HQ structure fire until the fight clears (self-defense
   * first, forts after). Assaulting a fort (attacker -1), patrolling, or
   * carrying no memory reads false, so unpressured guns keep shelling.
   */
  isFighting(index: number): boolean {
    const threat = this.movers[index]?.threat;
    return !!threat && threat.ttl > 0 && threat.attacker >= 0;
  }

  /**
   * Reposition a live hull whose gun cannot engage because terrain hides
   * the target (core `seekEngage` through the retaliation pursuit drive, so
   * the hull closes toward the target — a higher vantage or shorter range —
   * holds at weapons-range stand-off, and resumes patrol if the fight moves
   * on). Structure targets (an HQ fort, `target -1`) assault through core
   * `seekStructure` instead: the push survives the hunt sweep (never
   * clobbered by a team advance) and yields to consistent challengers
   * before resuming the fort. Wrecks refuse (they hold forever), a hull
   * never seeks itself, and ordered/holding hulls refuse (player orders
   * win). Idempotent per tick: re-seeks refresh the memory, they never
   * stack.
   */
  seekEngage(seeker: number, target: number, x: number, z: number): void {
    const mover = this.movers[seeker];
    if (!mover || this.destroyed[seeker]) return;
    if (seeker === target) return;
    const anchor = this.routes[seeker]?.[0] ?? null;
    this.movers[seeker] =
      target === -1
        ? seekStructure(mover, mover, x, z, anchor)
        : seekEngage(mover, mover, target, x, z, anchor);
  }

  /**
   * Feed per-unit accumulated damage 0..1 (combat's roster, same order) so
   * idle hulls weigh remaining health when deciding whether to engage, whom
   * to pursue, and whether to wait for backup. The canvas refreshes this
   * once per tick after combat runs; the drive uses the previous tick's
   * snapshot (one tick stale, never torn). Stored by reference, never
   * mutated — pass null to return to counts-only odds.
   */
  setDamage(damage: readonly number[] | null): void {
    this.damage = damage;
  }

  /**
   * Provide live enemy HQ positions for fort spotting (the canvas wires
   * `HqFx.targets()` here once both exist). A hull inside its notice gate
   * of an enemy fort shares the sighting with its whole side and assaults
   * the works; pass null to return to hull-only contacts.
   */
  setHqProvider(provider: (() => { x: number; z: number; team: number }[]) | null): void {
    this.hqProvider = provider;
  }

  /** Health fractions remaining (1 pristine .. 0 dead) for the roster. */
  private health(): number[] | null {
    if (!this.damage) return null;
    const damage = this.damage;
    return this.movers.map((_, i) => (this.destroyed[i] ? 0 : 1 - (damage[i] ?? 0)));
  }

  /**
   * Roster side of a unit (undefined when the group carries no placement —
   * headless test groups hunt nothing). For driven-path prediction and the
   * hunt sweep below.
   */
  teamAt(index: number): number | undefined {
    const placed = (this.units.userData.units as PlacedUnit[] | undefined) ?? [];
    return placed[index]?.team;
  }

  /**
    * Hunt sweep with judgment: every live idle/patrolling hull without a live
    * memory checks for a *winnable* fight (core `acquireStrategicHunt`) — an
    * outnumbered hull patrols on and waits for backup instead of charging
    * alone into a group, while a peewee scout probes anyway on wider scout
    * gates (its live memory focuses the squad and feeds the sticky contact
    * below, so the rest of the side engages what the scout found) — and
    * quarries are chosen, not just nearest: hulls
    * join their squad's focus and prefer wounded enemies (see `strategy.ts`).
    * Quarries must be *spotted* through the live sight picture (see
    * `visibility.ts`): ridges hide, high ground extends, wood shrinks.
    * Memories pointing at wrecks clear first (survivors stop guarding corpses
    * and may acquire a live enemy the same tick); position memories
    * (attacker -1: HQ seeks and team advances) survive the clear — a
    * structure is never a dead roster row. Ordered, holding, threatened, and
    * wrecked hulls are untouched, and the sweep costs one O(n) scan per hull
    * on a 6-roster, before the drive step so hunts steer same-tick.
    * In-progress pursuits that turn suicidal hold in place inside the drive
    * itself (tactics ride `advanceMovers`), so the sweep only acquires.
    *
    * Team advance: the sweep first records each side's contact (its squad
    * focus's live position — being shot counts as discovery, since the
    * victim's retaliation memory points back at a live enemy, and any hit
    * alerts the side directly in `threatenUnit` even when the victim
    * itself refuses the memory under orders) and keeps it
    * after contact is lost. A free hull whose side knows the enemy direction
    * but sees nothing itself advances toward the contact (core
    * `advanceMemory`: a -1 position memory on the wide team-advance
    * leash, so a mid-map meeting or a deep HQ sighting marches instead of
    * dying on the hunt leash) instead of guarding its loop — while a side
    * with no contact ever sends only its peewee scouts ranging toward the
    * enemy anchors (active recon) and holds its heavies on their loops. Advances refuse exactly like hunts
    * (ordered/holding hulls, no live enemy left anywhere, a contact past
    * the leash — and an outnumbered hull waiting for backup, unless it is
    * the side's peewee scout pushing ahead to keep eyes on the enemy), and
    * a hull carrying an advance still upgrades to a live hunt the tick one
    * appears.
    *
    * Fort spotting: a hull inside its notice gate of a live enemy HQ shares
    * the works team-wide (live grudges win — a side already fighting keeps
    * its hull contact) and assaults the fort itself as a structure memory
    * on the team-advance leash, so the side that finds the enemy HQ pushes
    * it instead of standing around.
   */
  sweepHunt(): void {
    if (this.movers.length === 0) return;
    const teams = this.movers.map((_, i) => this.teamAt(i));
    if (teams.every((t) => t === undefined)) return;
    // Pre-tick roster snapshot (same discipline as spacing/separation): the
    // drive below resolves live attackers against these positions, and the
    // squad focus reads these memories.
    const foes = this.movers.map((m) => ({ x: m.x, z: m.z }));
    const alive = this.movers.map((_, i) => !this.destroyed[i]);
    const threats: (ThreatMemory | undefined)[] = this.movers.map((m) =>
      m.threat && m.threat.ttl > 0 ? { ...m.threat } : undefined,
    );
    const hp = this.health();
    // Seeing surface for the sweep: hunts acquire spotted enemies, not just
    // near ones — ridges hide, high ground extends, wood shrinks (see
    // `visibility.ts`). One snapshot per sweep (eye heights + the shared
    // per-tick stands), so every pair in the tick reads the same picture.
    const sight = this.sightFor(foes);
    // Record what each side has found: the squad focus names the live enemy
    // most teammates pursue, so its position is the enemy direction. Sticky
    // — a side keeps pushing there after contact is lost. A hit already
    // alerts the side directly (see `threatenUnit`), so this refreshes the
    // contact from live pursuits on top of that.
    const seen = new Set<number>();
    const focused = new Set<number>();
    for (let i = 0; i < this.movers.length; i++) {
      const team = teams[i];
      if (team === undefined || seen.has(team)) continue;
      seen.add(team);
      const focus = squadFocus(team, threats, teams, alive);
      if (focus >= 0) {
        const at = foes[focus];
        if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) {
          this.teamContact.set(team, { x: at.x, z: at.z });
          focused.add(team);
        }
      }
    }
    // Fort spotting: a hull that *spots* a live enemy HQ (same sight gate
    // as hulls — the bunker roof over the ridge line, through the wood)
    // shares the works with its whole side (team-wide HQ-known) — scouts
    // range far enough to be the usual spotters. Live grudges win: a side
    // already focused on a hull keeps that contact instead of turning for
    // the fort.
    const hqs = this.hqProvider?.() ?? [];
    if (hqs.length > 0) {
      for (let i = 0; i < this.movers.length; i++) {
        if (!alive[i] || this.destroyed[i]) continue;
        const team = teams[i];
        if (team === undefined || focused.has(team)) continue;
        const at = foes[i];
        if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) continue;
        const notice = huntNoticeRadiusFor(this.kinds[i]);
        for (const hq of hqs) {
          if (hq.team === team) continue;
          if (!Number.isFinite(hq.x) || !Number.isFinite(hq.z)) continue;
          const fortY = this.env.groundY(hq.x, hq.z) + STRUCTURE_SIGHT_LIFT;
          if (canSpotPoint(i, foes, hq.x, hq.z, fortY, notice, sight, this.kinds)) {
            this.teamContact.set(team, { x: hq.x, z: hq.z });
            focused.add(team);
            break;
          }
        }
      }
    }
    for (let i = 0; i < this.movers.length; i++) {
      let mover = this.movers[i]!;
      const attacker = mover.threat?.attacker;
      if (
        mover.threat &&
        (attacker === undefined ||
          attacker >= this.movers.length ||
          (attacker >= 0 && this.destroyed[attacker]))
      ) {
        mover = clearThreat(mover);
      }
      const anchor = this.routes[i]?.[0] ?? null;
      // A hull carrying only an advance still upgrades: clear the position
      // memory for the acquisition attempt so a live enemy in notice takes
      // over the push the same tick. An HQ assault (`structure`) is restored
      // untouched when no hunt acquires — the sweep never clobbers a fort
      // push with a team advance; consistent challengers preempt through
      // the threat hook instead (see `threatenUnit` + `HQ_DEFENSE_HITS`).
      const assault =
        mover.threat?.attacker === -1 && mover.threat.structure === true ? mover.threat : undefined;
      const free = mover.threat?.attacker === -1 ? clearThreat(mover) : mover;
      let next = acquireStrategicHunt(free, i, teams, foes, alive, anchor, threats, hp ?? undefined, this.kinds, sight);
      if (!next.threat || next.threat.ttl <= 0) {
        next =
          assault !== undefined
            ? mover
            : (this.assaultSpottedHq(next, i, teams, foes, alive, anchor, sight) ??
              this.advanceTowardContact(next, i, teams, foes, alive, anchor, hp ?? undefined));
        // Active recon: a side with no contact yet still sends its scouts —
        // a free peewee ranges toward the enemy anchors instead of guarding
        // its loop, so the battlefield opens with probing instead of two
        // patrols waiting out of notice. Heavies hold until contact exists.
        if ((!next.threat || next.threat.ttl <= 0) && assault === undefined) {
          next = this.reconTowardEnemy(next, i, teams, foes, alive) ?? next;
        }
      }
      this.movers[i] = next;
    }
  }

  /**
   * Point a free hull at its side's last-known enemy position (see
   * `teamContact`): the guard-to-attack fallback when the hunt sweep finds
   * nothing. Refuses exactly like a hunt — ordered/holding hulls (player
   * orders win), sides with no contact ever, no live enemy left anywhere,
   * contacts past the team-advance leash of the patrol anchor, and
   * outnumbered hulls that should wait for backup instead of pushing alone
   * (peewee scouts excepted — they range ahead to keep the contact live).
   * The push rides the wide team-advance leash (see
   * `TEAM_ADVANCE_LEASH_RADIUS`) so a mid-map contact or a deep HQ sighting
   * marches instead of dying on the hunt leash. Pure per tick: returns the
   * mover with a fresh position memory, or untouched.
   */
  private advanceTowardContact(
    mover: Mover,
    self: number,
    teams: readonly (number | undefined)[],
    foes: readonly { x: number; z: number }[],
    alive: readonly boolean[],
    anchor: { x: number; z: number } | null,
    hp?: readonly number[] | null,
  ): Mover {
    if (mover.threat && mover.threat.ttl > 0) return mover;
    if (mover.hold || hasOrder(mover)) return mover;
    if (!alive[self] || this.destroyed[self]) return mover;
    const team = teams[self];
    if (team === undefined) return mover;
    const contact = this.teamContact.get(team);
    if (!contact) return mover;
    // The whole side marches on the same wide leash — scouts no longer need
    // a separate band now that advances range the full field.
    const leash = TEAM_ADVANCE_LEASH_RADIUS;
    if (anchor && Math.hypot(contact.x - anchor.x, contact.z - anchor.z) > leash) return mover;
    let enemyAlive = false;
    for (let j = 0; j < foes.length; j++) {
      if (j === self || !alive[j] || this.destroyed[j]) continue;
      const side = teams[j];
      if (side === undefined || side === team) continue;
      const at = foes[j];
      if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) continue;
      enemyAlive = true;
      break;
    }
    // A live enemy fort counts as a standing enemy — the war is not over
    // while its works stands, so the side still marches on the spotted HQ.
    if (!enemyAlive) {
      for (const hq of this.hqProvider?.() ?? []) {
        if (hq.team !== team && Number.isFinite(hq.x) && Number.isFinite(hq.z)) {
          enemyAlive = true;
          break;
        }
      }
    }
    if (!enemyAlive) return mover;
    // Scouts push ahead to keep eyes on the enemy even when the odds at
    // home look bad — ranging forward is their job, and their live memory
    // is what focuses the squad behind them. Heavier hulls wait for backup.
    if (!isScoutKind(this.kinds[self]) && shouldHold(self, foes, teams, alive, hp ?? undefined)) return mover;
    const memory = advanceMemory(contact.x, contact.z, leash);
    if (!memory) return mover;
    return { ...mover, threat: memory };
  }

  /**
   * Seeing surface for one sweep tick: per-hull eye heights on the live
   * ground plus the shared tree stands, so hunts and fort spotting read
   * the same picture. Pure per tick: returns a fresh context, or one with
   * no wood when the env carries no stands (headless open ground).
   */
  private sightFor(foes: readonly { x: number; z: number }[]): SightContext {
    const groundY = this.env.groundY;
    return {
      groundY,
      trees: this.env.treeStands?.() ?? null,
      eyeY: foes.map((p, i) => groundY(p.x, p.z) + eyeHeight(this.kinds[i])),
      kinds: this.kinds,
    };
  }

  /**
   * Assault a spotted fort: a free hull that spots a live enemy HQ pushes
   * the works as a structure assault (attacker -1 with the `structure`
   * flag, so the sweep never clobbers it with a team advance and
   * consistent challengers preempt through the threat hook). Returns the
   * mover with the assault memory, or null when no enemy fort is spotted.
   * The assault rides the wide team-advance leash — a scout spotting the far
   * works must be allowed to march on it, not refused at the tight anchor
   * guard.
   */
  private assaultSpottedHq(
    mover: Mover,
    self: number,
    teams: readonly (number | undefined)[],
    foes: readonly { x: number; z: number }[],
    alive: readonly boolean[],
    anchor: { x: number; z: number } | null,
    sight: SightContext,
  ): Mover | null {
    if (mover.threat && mover.threat.ttl > 0) return null;
    if (mover.hold || hasOrder(mover)) return null;
    if (!alive[self] || this.destroyed[self]) return null;
    const team = teams[self];
    if (team === undefined) return null;
    const hqs = this.hqProvider?.() ?? [];
    if (hqs.length === 0) return null;
    const at = foes[self];
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return null;
    const notice = huntNoticeRadiusFor(this.kinds[self]);
    for (const hq of hqs) {
      if (hq.team === team) continue;
      if (!Number.isFinite(hq.x) || !Number.isFinite(hq.z)) continue;
      const fortY = this.env.groundY(hq.x, hq.z) + STRUCTURE_SIGHT_LIFT;
      if (!canSpotPoint(self, foes, hq.x, hq.z, fortY, notice, sight, this.kinds)) continue;
      if (anchor && Math.hypot(hq.x - anchor.x, hq.z - anchor.z) > TEAM_ADVANCE_LEASH_RADIUS) continue;
      return {
        ...mover,
        threat: {
          attacker: -1,
          x: hq.x,
          z: hq.z,
          ttl: THREAT_MEMORY_DURATION,
          leash: TEAM_ADVANCE_LEASH_RADIUS,
          structure: true,
        },
      };
    }
    return null;
  }

  /**
   * Scout recon push: a free peewee whose side has no contact yet ranges
   * toward the enemy anchors' centroid (the enemy staging area) instead of
   * guarding its loop — the cold-start opener that turns two out-of-notice
   * patrols into a probing battlefield. Returns the mover with a fresh
   * position memory, or null when recon does not apply (not a scout,
   * busy, side already knows the enemy direction, or no enemy anchors).
   * The push rides the team-advance leash so the drive keeps it across the
   * field; the first hull or fort the scout notices converts it to a live
   * hunt or an HQ assault same-tick, which focuses the side behind it.
   */
  private reconTowardEnemy(
    mover: Mover,
    self: number,
    teams: readonly (number | undefined)[],
    foes: readonly { x: number; z: number }[],
    alive: readonly boolean[],
  ): Mover | null {
    if (mover.threat && mover.threat.ttl > 0) return null;
    if (mover.hold || hasOrder(mover)) return null;
    if (!alive[self] || this.destroyed[self]) return null;
    if (!isScoutKind(this.kinds[self])) return null;
    const team = teams[self];
    if (team === undefined) return null;
    if (this.teamContact.get(team)) return null;
    // Muster point of the enemy side: the centroid of live enemies' patrol
    // anchors (their staging area). Falls back to live enemy positions when
    // anchors are missing; without any enemy, there is nowhere to probe.
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (let j = 0; j < foes.length; j++) {
      if (j === self || !alive[j] || this.destroyed[j]) continue;
      if (teams[j] === undefined || teams[j] === team) continue;
      const anchor = this.routes[j]?.[0];
      const px = anchor && Number.isFinite(anchor.x) ? anchor.x : foes[j]?.x;
      const pz = anchor && Number.isFinite(anchor.z) ? anchor.z : foes[j]?.z;
      if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
      cx += px!;
      cz += pz!;
      n++;
    }
    if (n === 0) return null;
    cx /= n;
    cz /= n;
    const own = this.routes[self]?.[0];
    if (own && Math.hypot(cx - own.x, cz - own.z) > TEAM_ADVANCE_LEASH_RADIUS) return null;
    const memory = advanceMemory(cx, cz, TEAM_ADVANCE_LEASH_RADIUS);
    if (!memory) return null;
    return { ...mover, threat: memory };
  }

  /**
   * Register a reinforcement released by an HQ: append its mover (seeded at
   * the hall mouth on a short patrol loop toward the staging point, so the
   * hunt sweep can acquire enemies same-tick), kind, and route, and return
   * its roster index. The caller owns the body, placement entry, and HUD
   * roster push; combat's per-unit arrays grow on their own next tick.
   */
  addUnit(x: number, z: number, yaw: number, route: RoutePoint[], kind: UnitKind): number {
    const mover = initMover(route, yaw);
    mover.x = x;
    mover.z = z;
    this.movers.push(mover);
    this.kinds.push(kind);
    this.routes.push(route);
    return this.movers.length - 1;
  }

  /**
   * Issue a move order to one unit: A* from its live position to the target
   * (straight drive when no heightfield was provided), replacing any patrol
   * leg or previous order. Repathing just calls this again.
   */
  orderUnit(index: number, target: { x: number; z: number }, groupSpeed?: number): boolean {
    const mover = this.movers[index];
    if (!mover || this.destroyed[index]) return false;
    const path = this.field
      ? findWorldPath(this.field, { x: mover.x, z: mover.z }, target)
      : [{ x: target.x, z: target.z }];
    this.movers[index] = orderMover(mover, path, groupSpeed);
    return true;
  }

  /**
   * Issue a group move order: each unit gets its own formation-fan slot
   * around the clicked point (slot 0 takes the point itself) with an
   * independent A* path, so the group fans out instead of stacking. With a
   * heightfield the slots are snapped onto walkable ground up front with a
   * separation guarantee (`snappedFormationTargets`) — independent per-unit
   * snaps of adjacent slots could otherwise collapse onto one cell and park
   * the pair inside the mutual spacing stop.
   */
  orderGroup(indices: readonly number[], target: { x: number; z: number }): number {
    const live = indices.filter((index) => !this.destroyed[index]);
    const slots = this.field
      ? snappedFormationTargets(this.field, target, live.length)
      : formationTargets(target, live.length);
    // Group cohesion: cap every member at the slowest live member's base
    // speed so faster hulls hold formation instead of cutting ahead. Single
    // orders (`orderUnit` without a cap) are unaffected.
    const cap = groupSpeedCap(live.map((index) => this.kinds[index] ?? "flash"));
    let issued = 0;
    live.forEach((index, i) => {
      if (this.orderUnit(index, slots[i] ?? target, cap)) issued++;
    });
    return issued;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    this.elapsed += dt;
    // Hunt first: idle hulls notice live enemies (and drop memories of dead
    // attackers) before the drive step, so acquisitions steer same-tick.
    this.sweepHunt();
    // The drive carries the roster sides, live flags, and health so an
    // outnumbered pursuer holds facing the threat (waiting for backup)
    // instead of charging alone into the stronger force.
    const teams = this.movers.map((_, i) => this.teamAt(i));
    const alive = this.movers.map((_, i) => !this.destroyed[i]);
    const hp = this.health();
    const next = teams.every((t) => t === undefined)
      ? advanceMovers(this.kinds, this.movers, this.routes, dt, this.field, this.crush)
      : advanceMovers(this.kinds, this.movers, this.routes, dt, this.field, this.crush, {
        teams, alive, hp: hp ?? undefined,
      });
    // Wrecks never move: freeze their movers at the pre-tick state (core
    // separation may have shoved them). Live hulls still spacing-avoid the
    // wreck positions, so nobody drives through a wreck.
    for (let i = 0; i < next.length; i++) {
      if (this.destroyed[i]) next[i] = this.movers[i]!;
    }
    next.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      const prev = this.movers[i];
      if (!body || !prev) return;
      const dx = mover.x - prev.x;
      const dz = mover.z - prev.z;
      if (dx !== 0 || dz !== 0) this.env.onShift?.(i, dx, dz);
      // Wheels stride with travelled distance; legs settle at rest.
      advanceLocomotion(body, this.kinds[i] ?? "flash", Math.hypot(dx, dz), dt);
      // Live hulls breathe at rest (zero travel this tick); driving hulls
      // and wrecks hold their grade pose exactly.
      this.pose(body, mover, this.kinds[i] ?? "flash", dt, i, !this.destroyed[i] && dx === 0 && dz === 0);
    });
    this.movers = next;
  }

  /** Re-seat every body on the terrain surface (exaggeration change). */
  resnap(): void {
    if (this.disposed) return;
    this.movers.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      if (!body) return;
      this.pose(body, mover, this.kinds[i] ?? "flash", Number.POSITIVE_INFINITY, i, false);
    });
  }

  /**
   * Seat one body: live X/Z, surface height + hull pitch/roll from the seat
   * (flat `groundY + 0.5` fallback), yaw from the mover. `YXZ` order so the
   * pitch/roll apply in the hull frame after yawing — nose up uphill. Tilt
   * slews toward the seat at `HULL_TILT_SLEW` (suspension settling instead
   * of a snap when cresting a grade break); height applies instantly so
   * tracks never float or sink, and re-snaps pass infinite `dt` to land
   * exactly. Last tick's breathing sway is always shed first (even when the
   * fresh one is skipped for driving hulls, wrecks, and re-snaps), so the
   * sway never leaks into the slew state or survives a re-seat.
   */
  private pose(body: THREE.Group, mover: Mover, kind: UnitKind, dt: number, index: number, tremble: boolean): void {
    // Shed last tick's breathing sway first (exact — combat nudge tilts
    // un-apply their own offsets, so only the sway remains on top of the
    // slewed grade pose); the seat then absolute-sets position.
    clearIdleTremble(body);
    const seat = this.env.seat?.(mover.x, mover.z, mover.hull, kind);
    body.position.set(mover.x, seat?.y ?? this.env.groundY(mover.x, mover.z) + 0.5, mover.z);
    body.rotation.order = "YXZ";
    body.rotation.y = mover.hull;
    const maxStep = HULL_TILT_SLEW * dt;
    body.rotation.x = seat ? slewTilt(body.rotation.x, seat.pitch, maxStep) : 0;
    body.rotation.z = seat ? slewTilt(body.rotation.z, seat.roll, maxStep) : 0;
    // Engine idling: a faint slow tilt sway on the seated hull. Driving
    // hulls already read as alive through locomotion and wrecks hold
    // still, so only live hulls at rest breathe — visual only, the mover
    // never moves.
    if (tremble) applyIdleTremble(body, index, this.elapsed);
  }

  dispose(): void {
    this.disposed = true;
  }
}
