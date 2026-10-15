import * as THREE from "three";

/**
 * Overhead health bars for the View menu: one billboarded bar per live unit,
 * floating above the hull and filled by remaining health (1 - damage), plus
 * one wider bar per live HQ works floating above the roofline and filled
 * from the same green → amber → red ramp.
 *
 * Bars are per-tick views of damage state — `CombatFx` for units, `HqFx`
 * for forts — they own one `THREE.Group` in the scene, billboard toward
 * the camera, and hide for wrecks (destroyed units, fully decayed husks,
 * or wrecked HQs) and while the toggle is off. `dispose()` removes the
 * group and frees per-bar materials.
 */

/** Bar width in world units (a touch wider than a tank hull). */
export const HEALTH_BAR_WIDTH = 24;
/** Bar height in world units. */
export const HEALTH_BAR_HEIGHT = 3.5;
/** Fill inset inside the background frame. */
export const HEALTH_BAR_INSET = 0.75;
/** Height above the body origin (clears the commander antenna + beacon). */
export const HEALTH_BAR_LIFT = 60;
/** Above selection markers (10-12), so bars read through the beacon layer. */
export const HEALTH_BAR_RENDER_ORDER = 13;
/** HQ bar width in world units (narrower than the 96-wide works slab). */
export const HQ_HEALTH_BAR_WIDTH = 72;
/** HQ bar height in world units (a touch taller — forts sit at map ends). */
export const HQ_HEALTH_BAR_HEIGHT = 5;
/** Height above the HQ anchor (clears the monitor roof + chimney caps). */
export const HQ_HEALTH_BAR_LIFT = 64;
/** Background frame color (near-black, always the same). */
export const HEALTH_BG_COLOR = 0x0b0f14;
/** Fill color at high health. */
export const HEALTH_FULL_COLOR = 0x4ade80;
/** Fill color at middling health. */
export const HEALTH_MID_COLOR = 0xfbbf24;
/** Fill color at critical health. */
export const HEALTH_LOW_COLOR = 0xef4444;
/** Fraction at/below which the fill drops from green to amber. */
export const HEALTH_MID_FRACTION = 0.55;
/** Fraction at/below which the fill drops from amber to red. */
export const HEALTH_LOW_FRACTION = 0.28;

/** Remaining health 0..1 for a damage fraction (clamped, never heals). */
export function healthFraction(damage: number): number {
  if (!(damage > 0)) return 1;
  return Math.min(Math.max(1 - damage, 0), 1);
}

/** Fill color for a health fraction: green → amber → red. */
export function healthColorFor(fraction: number): number {
  if (fraction <= HEALTH_LOW_FRACTION) return HEALTH_LOW_COLOR;
  if (fraction <= HEALTH_MID_FRACTION) return HEALTH_MID_COLOR;
  return HEALTH_FULL_COLOR;
}

/** Minimal damage-state source (CombatFx satisfies this). */
export interface HealthSource {
  unitDamageAt(index: number): number;
  isDestroyedAt(index: number): boolean;
  isHuskGoneAt?(index: number): boolean;
}

/** Minimal HQ damage-state source (HqFx satisfies this). */
export interface HqHealthSource {
  damageAt(index: number): number;
  isDestroyedAt(index: number): boolean;
}

interface HealthBar {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
}

export class HealthBars {
  private scene: THREE.Scene;
  private bars: HealthBar[] = [];
  private hqBars: HealthBar[] = [];
  private visible = true;
  private bgGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
  private fillGeo = new THREE.PlaneGeometry(
    HEALTH_BAR_WIDTH - HEALTH_BAR_INSET * 2,
    HEALTH_BAR_HEIGHT - HEALTH_BAR_INSET * 2,
  );
  private hqBgGeo = new THREE.PlaneGeometry(HQ_HEALTH_BAR_WIDTH, HQ_HEALTH_BAR_HEIGHT);
  private hqFillGeo = new THREE.PlaneGeometry(
    HQ_HEALTH_BAR_WIDTH - HEALTH_BAR_INSET * 2,
    HQ_HEALTH_BAR_HEIGHT - HEALTH_BAR_INSET * 2,
  );
  private bgMat = new THREE.MeshBasicMaterial({
    color: HEALTH_BG_COLOR,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  private disposed = false;
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, count: number) {
    this.scene = scene;
    this.group.name = "healthbars";
    this.scene.add(this.group);
    this.setCount(count);
  }

  /** Bar count (one per roster unit). */
  get count(): number {
    return this.bars.length;
  }

  /** HQ bar count (one per team fort). */
  get hqCount(): number {
    return this.hqBars.length;
  }

  /** Fill fraction currently drawn for a unit (0 when hidden), for tests. */
  fraction(index: number): number {
    const bar = this.bars[index];
    if (!bar || !bar.group.visible) return 0;
    return bar.fill.scale.x;
  }

  /** Whether a unit's bar is currently drawn. */
  isShown(index: number): boolean {
    return this.bars[index]?.group.visible ?? false;
  }

  /** Fill fraction currently drawn for an HQ (0 when hidden), for tests. */
  hqFraction(index: number): number {
    const bar = this.hqBars[index];
    if (!bar || !bar.group.visible) return 0;
    return bar.fill.scale.x;
  }

  /** Whether an HQ's bar is currently drawn. */
  isHqShown(index: number): boolean {
    return this.hqBars[index]?.group.visible ?? false;
  }

  /** Resize the roster (regen); preserves visibility. */
  setCount(count: number): void {
    const n = Math.max(Math.floor(count), 0);
    while (this.bars.length < n) this.bars.push(this.makeBar("healthbar", this.bgGeo, this.fillGeo));
    while (this.bars.length > n) {
      const bar = this.bars.pop()!;
      this.group.remove(bar.group);
      bar.fillMat.dispose();
    }
    this.applyVisibility();
  }

  /** Resize the HQ roster (one per team fort); preserves visibility. */
  setHqCount(count: number): void {
    const n = Math.max(Math.floor(count), 0);
    while (this.hqBars.length < n) this.hqBars.push(this.makeBar("hq-healthbar", this.hqBgGeo, this.hqFillGeo));
    while (this.hqBars.length > n) {
      const bar = this.hqBars.pop()!;
      this.group.remove(bar.group);
      bar.fillMat.dispose();
    }
    this.applyVisibility();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
  }

  /**
   * Per-tick refresh: re-seat each bar above its body, billboard it toward
   * `camera`, and refill from live damage. Wrecks (destroyed or gone husks)
   * show nothing. While the toggle is off every bar is hidden up front and
   * the re-seat/billboard work is skipped — same hidden result, no per-tick
   * transform churn.
   */
  update(source: HealthSource, bodies: readonly THREE.Object3D[], camera: THREE.Camera): void {
    if (this.disposed) return;
    if (!this.visible) {
      for (let i = 0; i < this.bars.length; i++) this.bars[i]!.group.visible = false;
      return;
    }
    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i]!;
      const body = bodies[i];
      const gone = source.isHuskGoneAt?.(i) ?? false;
      if (!body || source.isDestroyedAt(i) || gone) {
        bar.group.visible = false;
        continue;
      }
      const frac = healthFraction(source.unitDamageAt(i));
      bar.group.visible = this.visible;
      bar.group.position.set(body.position.x, body.position.y + HEALTH_BAR_LIFT, body.position.z);
      bar.group.quaternion.copy(camera.quaternion);
      // Left-aligned drain: scaling shrinks about the center, so shift the
      // fill left by the drained half-width to pin its left edge.
      const fillWidth = HEALTH_BAR_WIDTH - HEALTH_BAR_INSET * 2;
      bar.fill.scale.set(Math.max(frac, 1e-4), 1, 1);
      bar.fill.position.x = -((1 - frac) * fillWidth) / 2;
      bar.fillMat.color.setHex(healthColorFor(frac));
    }
  }

  /**
   * Per-tick refresh for the HQ roster: same toggle, same ramp, same
   * billboard policy as units, but seated above the works roofline with
   * the wider fort bar. Wrecked forts show nothing. While the toggle is
   * off every HQ bar is hidden up front and the re-seat work is skipped.
   */
  updateHq(
    source: HqHealthSource,
    bodies: readonly (THREE.Object3D | null | undefined)[],
    camera: THREE.Camera,
  ): void {
    if (this.disposed) return;
    if (!this.visible) {
      for (let i = 0; i < this.hqBars.length; i++) this.hqBars[i]!.group.visible = false;
      return;
    }
    for (let i = 0; i < this.hqBars.length; i++) {
      const bar = this.hqBars[i]!;
      const body = bodies[i];
      if (!body || source.isDestroyedAt(i)) {
        bar.group.visible = false;
        continue;
      }
      const frac = healthFraction(source.damageAt(i));
      bar.group.visible = this.visible;
      bar.group.position.set(body.position.x, body.position.y + HQ_HEALTH_BAR_LIFT, body.position.z);
      bar.group.quaternion.copy(camera.quaternion);
      const fillWidth = HQ_HEALTH_BAR_WIDTH - HEALTH_BAR_INSET * 2;
      bar.fill.scale.set(Math.max(frac, 1e-4), 1, 1);
      bar.fill.position.x = -((1 - frac) * fillWidth) / 2;
      bar.fillMat.color.setHex(healthColorFor(frac));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.bgGeo.dispose();
    this.fillGeo.dispose();
    this.hqBgGeo.dispose();
    this.hqFillGeo.dispose();
    this.bgMat.dispose();
    for (const bar of this.bars) bar.fillMat.dispose();
    for (const bar of this.hqBars) bar.fillMat.dispose();
    this.bars = [];
    this.hqBars = [];
    this.group.clear();
  }

  private makeBar(name: string, bgGeo: THREE.PlaneGeometry, fillGeo: THREE.PlaneGeometry): HealthBar {
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    const bg = new THREE.Mesh(bgGeo, this.bgMat);
    bg.name = "healthbar-bg";
    bg.renderOrder = HEALTH_BAR_RENDER_ORDER;
    group.add(bg);
    const fillMat = new THREE.MeshBasicMaterial({
      color: HEALTH_FULL_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.name = "healthbar-fill";
    fill.position.z = 0.1;
    fill.renderOrder = HEALTH_BAR_RENDER_ORDER + 1;
    group.add(fill);
    this.group.add(group);
    return { group, fill, fillMat };
  }

  private applyVisibility(): void {
    this.group.visible = this.visible;
  }
}
