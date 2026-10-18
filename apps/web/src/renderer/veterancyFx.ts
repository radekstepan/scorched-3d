import * as THREE from "three";
import { MAX_VETERAN_RANK } from "@scorched-3d/core";
import { HEALTH_BAR_LIFT, HEALTH_BAR_RENDER_ORDER } from "./healthBars";

/**
 * Veterancy chevrons: the view half of unit veterancy (see core
 * `veterancy.ts` for the ranks + multipliers and `CombatFx` for the kill
 * counts). Every ranked hull wears a persistent gold chevron badge floating
 * just above its overhead health bar — one ∧ per pip, up to the ace three —
 * and a promotion plays a brief flourish: the new rank's chevrons at a
 * slightly larger scale, spinning in place over the hull before fading.
 *
 * Badges are per-tick views of combat state — they own one `THREE.Group`
 * in the scene, billboard toward the camera, and hide for rookies, wrecks,
 * and while the Health toggle is off (they live with the bars). The
 * flourish is a transient over the promotion position (captured at the
 * `onUnitPromoted` hook — hulls barely move in its 1.5 s life). It spins in
 * world space, never billboarded, so the rotation reads. `dispose()` drops
 * the group and frees every material.
 */

/** Badge gold: medal brass, hue-family of amber HUD chrome but smaller than fire. */
export const VETERAN_BADGE_COLOR = 0xfbbf24;
/** Badge lift above the body origin: clears the overhead health bar. */
export const VETERAN_BADGE_LIFT = HEALTH_BAR_LIFT + 8;
/** Badge compositing: above the health fill and the occlusion ghost. */
export const VETERAN_BADGE_RENDER_ORDER = HEALTH_BAR_RENDER_ORDER + 3;
/** Chevron stripe width (the ∧ spans ~10u, under half the bar width). */
export const VETERAN_CHEVRON_LENGTH = 7.4;
/** Chevron stripe thickness. */
export const VETERAN_CHEVRON_BAR = 1.7;
/** Vertical stack step between rank pips. */
export const VETERAN_CHEVRON_STACK = 3.4;
/** Flourish life, seconds. */
export const VETERAN_FLOURISH_DURATION = 1.5;
/** Flourish chevrons run slightly larger than the badge. */
export const VETERAN_FLOURISH_SCALE = 1.6;
/** Flourish spin rate, rad/s (a bit over one full turn per life). */
export const VETERAN_FLOURISH_SPIN = 4.5;
/** Flourish rise over its life, world units. */
export const VETERAN_FLOURISH_RISE = 14;

/** Minimal veterancy-state source (CombatFx satisfies this). */
export interface VeterancySource {
  rankAt(index: number): number;
  isDestroyedAt(index: number): boolean;
  isHuskGoneAt?(index: number): boolean;
}

interface Flourish {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  y0: number;
  t: number;
}

export class VeterancyFx {
  private scene: THREE.Scene;
  private badges: THREE.Group[][] = [];
  private flourishes: Flourish[] = [];
  private visible = true;
  private stripeGeo = new THREE.BoxGeometry(VETERAN_CHEVRON_LENGTH, VETERAN_CHEVRON_BAR, 1.2);
  private badgeMat = new THREE.MeshBasicMaterial({
    color: VETERAN_BADGE_COLOR,
    depthTest: false,
    depthWrite: false,
  });
  private disposed = false;
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, count: number) {
    this.scene = scene;
    this.group.name = "veterancy";
    this.scene.add(this.group);
    this.setCount(count);
  }

  /** Badge count (one per roster unit). */
  get count(): number {
    return this.badges.length;
  }

  /** Live promotion flourishes (for tests). */
  get flourishCount(): number {
    return this.flourishes.length;
  }

  /** Whether a unit's badge is currently drawn. */
  isShown(index: number): boolean {
    return this.badges[index]?.[0]?.parent?.visible ?? false;
  }

  /** Chevrons currently drawn for a unit (0 when hidden), for tests. */
  chevronsShown(index: number): number {
    const badge = this.badges[index];
    if (!badge?.[0]?.parent?.visible) return 0;
    return badge.filter((c) => c.visible).length;
  }

  /** Resize the roster (regen / reinforcements); preserves visibility. */
  setCount(count: number): void {
    const n = Math.max(Math.floor(count), 0);
    while (this.badges.length < n) this.badges.push(this.makeBadge());
    while (this.badges.length > n) {
      const badge = this.badges.pop()!;
      this.group.remove(badge[0]!.parent!);
    }
    this.applyVisibility();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
  }

  /**
   * Per-tick refresh: re-seat each badge above its body, billboard it
   * toward `camera`, and light its rank-many chevrons. Rookies, wrecks
   * (destroyed or gone husks), and off-frustum hulls show nothing. While
   * the toggle is off every badge hides up front and the re-seat work is
   * skipped; `visible` gates the per-unit re-seat on camera frustum
   * membership (see `viewCull`) — omitted/short entries default to visible.
   * Promotion flourishes tick on the same pass (`dt` seconds).
   */
  update(
    source: VeterancySource,
    bodies: readonly THREE.Object3D[],
    camera: THREE.Camera,
    dt: number,
    visible?: readonly boolean[],
  ): void {
    if (this.disposed) return;
    if (!this.visible) {
      for (const badge of this.badges) badge[0]!.parent!.visible = false;
    } else {
      for (let i = 0; i < this.badges.length; i++) {
        const badge = this.badges[i]!;
        const holder = badge[0]!.parent!;
        const body = bodies[i];
        const gone = source.isHuskGoneAt?.(i) ?? false;
        const seen = visible?.[i] ?? true;
        const rank = source.rankAt(i);
        if (!body || rank < 1 || source.isDestroyedAt(i) || gone || !seen) {
          holder.visible = false;
          continue;
        }
        holder.visible = true;
        holder.position.set(body.position.x, body.position.y + VETERAN_BADGE_LIFT, body.position.z);
        holder.quaternion.copy(camera.quaternion);
        for (let r = 0; r < badge.length; r++) badge[r]!.visible = r < rank;
      }
    }
    this.tickFlourishes(dt);
  }

  /**
   * Play the promotion flourish for `index` at its current world position:
   * the new rank's chevrons at a slightly larger scale, spinning in place
   * and rising before fading out. Skipped while the toggle hides the badges
   * (a hidden badge earns no visible flourish) and for unknown/wrecked
   * bodies — the rank pip still lights on the next `update`.
   */
  promote(_index: number, rank: number, body: THREE.Object3D | null | undefined): void {
    if (this.disposed || !this.visible || !body) return;
    const pips = Math.min(Math.max(Math.floor(rank), 1), MAX_VETERAN_RANK);
    const mat = new THREE.MeshBasicMaterial({
      color: VETERAN_BADGE_COLOR,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    const group = new THREE.Group();
    group.name = "veteran-flourish";
    group.position.copy(body.position);
    group.position.y += VETERAN_BADGE_LIFT;
    group.scale.setScalar(VETERAN_FLOURISH_SCALE);
    for (let r = 0; r < pips; r++) {
      const chevron = this.makeChevron(mat);
      chevron.position.y = r * VETERAN_CHEVRON_STACK;
      group.add(chevron);
    }
    this.group.add(group);
    this.flourishes.push({ group, mat, y0: group.position.y, t: 0 });
  }

  /** Drop live flourishes (e.g. on exaggeration re-snap); badges persist. */
  clearTransients(): void {
    for (const f of this.flourishes) {
      this.group.remove(f.group);
      f.mat.dispose();
    }
    this.flourishes = [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTransients();
    this.scene.remove(this.group);
    this.stripeGeo.dispose();
    this.badgeMat.dispose();
    this.badges = [];
    this.group.clear();
  }

  private tickFlourishes(dt: number): void {
    const step = dt > 0 ? dt : 0;
    for (let i = this.flourishes.length - 1; i >= 0; i--) {
      const f = this.flourishes[i]!;
      f.t += step;
      const k = f.t / VETERAN_FLOURISH_DURATION;
      if (k >= 1) {
        this.group.remove(f.group);
        f.mat.dispose();
        this.flourishes.splice(i, 1);
        continue;
      }
      // World-space spin (never billboarded — the rotation must read),
      // linear rise, linear fade.
      f.group.rotation.y = VETERAN_FLOURISH_SPIN * f.t;
      f.group.position.y = f.y0 + VETERAN_FLOURISH_RISE * k;
      f.mat.opacity = 1 - k;
    }
  }

  /** One ∧ chevron: two thin bars sharing geometry, own material. */
  private makeChevron(mat: THREE.Material): THREE.Group {
    const chevron = new THREE.Group();
    chevron.name = "veteran-chevron";
    const left = new THREE.Mesh(this.stripeGeo, mat);
    left.rotation.z = Math.PI / 4;
    left.position.set(-2.5, 2.5, 0);
    left.renderOrder = VETERAN_BADGE_RENDER_ORDER;
    const right = new THREE.Mesh(this.stripeGeo, mat);
    right.rotation.z = -Math.PI / 4;
    right.position.set(2.5, 2.5, 0);
    right.renderOrder = VETERAN_BADGE_RENDER_ORDER;
    chevron.add(left, right);
    return chevron;
  }

  /** One per-unit badge: a stacked ace-worth of chevrons, toggled by rank. */
  private makeBadge(): THREE.Group[] {
    const holder = new THREE.Group();
    holder.name = "veteran-badge";
    holder.visible = false;
    const chevrons: THREE.Group[] = [];
    for (let r = 0; r < MAX_VETERAN_RANK; r++) {
      const chevron = this.makeChevron(this.badgeMat);
      chevron.position.y = r * VETERAN_CHEVRON_STACK;
      chevron.visible = false;
      holder.add(chevron);
      chevrons.push(chevron);
    }
    this.group.add(holder);
    return chevrons;
  }

  private applyVisibility(): void {
    this.group.visible = this.visible;
  }
}
