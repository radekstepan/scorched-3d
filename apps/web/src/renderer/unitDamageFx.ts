import * as THREE from "three";
import {
  charMix,
  isHeavilyDamaged,
  isSmoking,
  UNIT_HEAVY_DAMAGE,
  UNIT_SMOKE_DAMAGE,
} from "@scorched-3d/core";

export { UNIT_HEAVY_DAMAGE, UNIT_SMOKE_DAMAGE };

/**
 * Visible battle damage on unit hulls: soft progressive charring (body colors
 * lerp a capped way toward warm brown with accumulated damage — hulls stay
 * readable, never near-black) plus small intermittent smoke puffs above
 * scorched hulls (phased emission windows with gaps) and a soft blinking
 * ember spark over heavily-damaged hulls.
 *
 * Cheap by construction: charring rewrites existing Lambert colors in place
 * (only when a blast lands, never per frame) and smoke/embers are two single
 * instanced draws (no per-unit objects, no per-frame allocations — one shared
 * dummy, compact in-place fill). Motion is phase-hashed by unit index so
 * neighbours desync without rng, keeping replays deterministic. Damage state
 * itself lives in core (`unitDamage.ts`); everything here is a transient view
 * of it, rebuilt every tick — exaggeration re-snaps and `clearTransients`
 * never touch it.
 */

/** Burnt-umber target the hull colors char toward (warm brown, never black). */
export const CHAR_TARGET = 0x4a3a2c;
/** Cap on the effective char lerp: hulls keep their hue, never go near-black. */
export const CHAR_MAX_MIX = 0.45;
/** Hull height the smoke puff rises across one emission window, world units. */
export const UNIT_SMOKE_RISE = 32;
/** Perf cap: one smoke puff per hull is plenty (rosters are small). */
export const MAX_UNIT_SMOKE = 32;
/** Perf cap: one ember flicker per heavily-damaged hull. */
export const MAX_UNIT_EMBERS = 32;
/** Puff emission period: each smoking hull emits intermittently, desynced. */
export const UNIT_PUFF_PERIOD = 3.6;
/** Fraction of each period a light-damage hull shows its puff. */
export const PUFF_DUTY_LIGHT = 0.42;
/** Fraction of each period a heavily-damaged hull shows its puff. */
export const PUFF_DUTY_HEAVY = 0.6;
/** Ember blink period (faster than smoke puffs). */
export const UNIT_EMBER_PERIOD = 2.1;
/** Fraction of each ember period the spark is visible. */
export const EMBER_DUTY = 0.65;

const _base = new THREE.Color();
const _char = new THREE.Color(CHAR_TARGET);
const _out = new THREE.Color();

/**
 * Charred color for a base hull color at `damage` 0..1: lerp toward the char
 * target by the core char mix, capped at `CHAR_MAX_MIX` so fully battered
 * hulls stay a readable brown instead of near-black. Pure for tests.
 */
export function charredColor(baseHex: number, damage: number): number {
  const k = charMix(damage) * CHAR_MAX_MIX;
  if (k <= 0) return baseHex;
  _base.setHex(baseHex);
  _out.copy(_base).lerp(_char, k);
  return _out.getHex();
}

/** Emission duty (visible fraction of each puff period) by damage weight. */
export function puffDuty(heavy: boolean): number {
  return heavy ? PUFF_DUTY_HEAVY : PUFF_DUTY_LIGHT;
}

/**
 * Puff cycle phase 0..1 for a unit index at `elapsed`: golden-ratio offset
 * desyncs neighbours deterministically (no rng). Pure for tests.
 */
export function puffPhase(index: number, elapsed: number): number {
  const offset = ((index * 0.61803398875) % 1 + 1) % 1;
  return (((elapsed / UNIT_PUFF_PERIOD + offset) % 1) + 1) % 1;
}

/** True while the smoke puff for a hull is visible (emission gaps else). */
export function isPuffVisible(index: number, elapsed: number, heavy: boolean): boolean {
  return puffPhase(index, elapsed) < puffDuty(heavy);
}

/**
 * Ember blink phase 0..1: separate period/hash from smoke so sparks and
 * puffs never pulse together. Pure for tests.
 */
export function emberPhase(index: number, elapsed: number): number {
  const offset = ((index * 0.38196601125 + 0.25) % 1 + 1) % 1;
  return (((elapsed / UNIT_EMBER_PERIOD + offset) % 1) + 1) % 1;
}

/** True while the ember spark for a hull is visible (blink gaps else). */
export function isEmberVisible(index: number, elapsed: number): boolean {
  return emberPhase(index, elapsed) < EMBER_DUTY;
}

/**
 * Tint one unit body for `damage`: every Lambert hull mesh lerps from its
 * stashed base color toward burnt umber. Base colors are stashed once per
 * mesh (`userData.baseColor`), so re-applying is stable and selection
 * markers (Basic materials, `noHighlight`) are never touched. Headless-test
 * groups without meshes are a no-op.
 */
export function applyUnitDamageTint(body: THREE.Object3D, damage: number): void {
  body.traverse((child) => {
    if (child.userData.noHighlight) return;
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (!mat || !("emissive" in mat) || !("color" in mat)) return;
    if (typeof mesh.userData.baseColor !== "number") {
      mesh.userData.baseColor = (mat.color as THREE.Color).getHex();
    }
    (mat.color as THREE.Color).setHex(
      charredColor(mesh.userData.baseColor as number, damage),
    );
  });
}

/**
 * Base (uncharred) color stashed on a mesh by `applyUnitDamageTint`, or null
 * when the mesh was never tinted. For tests.
 */
export function baseColorOf(body: THREE.Object3D): number | null {
  let found: number | null = null;
  body.traverse((child) => {
    if (found !== null) return;
    const mesh = child as THREE.Object3D & {
      material?: { color?: { getHex?: () => number } };
      userData: { baseColor?: unknown };
    };
    if (typeof mesh.userData.baseColor === "number") found = mesh.userData.baseColor;
  });
  return found;
}

export class UnitDamageFx {
  private scene: THREE.Scene;
  private smokeMesh: THREE.InstancedMesh;
  private emberMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const smokeGeo = new THREE.SphereGeometry(5.5, 8, 6);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_UNIT_SMOKE);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 3;
    const emberGeo = new THREE.SphereGeometry(2.2, 6, 5);
    const emberMat = new THREE.MeshBasicMaterial({
      color: 0xffa63c,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.emberMesh = new THREE.InstancedMesh(emberGeo, emberMat, MAX_UNIT_EMBERS);
    this.emberMesh.count = 0;
    this.emberMesh.frustumCulled = false;
    this.emberMesh.renderOrder = 3;
    for (let i = 0; i < MAX_UNIT_SMOKE; i++) this.smokeMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    for (let i = 0; i < MAX_UNIT_EMBERS; i++) this.emberMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    this.scene.add(this.smokeMesh, this.emberMesh);
  }

  /** Visible damage-smoke puff count (one per smoking hull, capped). */
  get smokeCount(): number {
    return this.smokeMesh.count;
  }

  /** Visible ember count (one per heavily-damaged hull, capped). */
  get emberCount(): number {
    return this.emberMesh.count;
  }

  /**
   * Rebuild smoke/ember instances from per-unit damage. Bodies give live
   * X/Z/Y (patrol motion rides for free); `elapsed` drives the deterministic
   * phase-hashed puff cadence — each smoking hull emits one small puff per
   * window with gaps between, so damage reads as intermittent wisps rather
   * than a constant column. No rng, so replays match frame for frame.
   */
  update(damage: readonly number[], bodies: readonly THREE.Object3D[], elapsed: number): void {
    if (this.disposed) return;
    const dummy = this.dummy;
    let smoke = 0;
    let embers = 0;
    const n = Math.min(damage.length, bodies.length);
    for (let i = 0; i < n; i++) {
      const d = damage[i]!;
      if (!isSmoking(d)) continue;
      const body = bodies[i]!;
      const heavy = isHeavilyDamaged(d);
      if (smoke < MAX_UNIT_SMOKE && isPuffVisible(i, elapsed, heavy)) {
        // One puff life per window: rises from the hull, swells, dissipates.
        const localT = puffPhase(i, elapsed) / puffDuty(heavy);
        const rise = localT * UNIT_SMOKE_RISE;
        const envelope = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, localT));
        dummy.position.set(
          body.position.x + Math.sin(elapsed * 1.1 + i * 2.3) * 3,
          body.position.y + 12 + rise,
          body.position.z + Math.cos(elapsed * 0.8 + i * 1.1) * 3,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar((heavy ? 0.62 : 0.45) * (0.5 + 0.5 * localT) * envelope);
        dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(smoke, dummy.matrix);
        // Soft greys for both tiers — heavy stays charcoal, never near-black.
        const tone = heavy ? 0.38 : 0.58;
        this.smokeMesh.setColorAt(smoke, this.tint.setRGB(tone, tone * 0.96, tone * 0.92));
        smoke++;
      }
      if (heavy && embers < MAX_UNIT_EMBERS && isEmberVisible(i, elapsed)) {
        // Ember spark dancing low over the hull: soft flicker, blinks out.
        const flicker = 0.35 + 0.25 * Math.abs(Math.sin(elapsed * 11 + i * 2.9));
        dummy.position.set(
          body.position.x + Math.sin(elapsed * 3.1 + i * 1.7) * 5,
          body.position.y + 10 + 3 * Math.abs(Math.sin(elapsed * 2.2 + i)),
          body.position.z + Math.cos(elapsed * 2.6 + i * 0.9) * 5,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(flicker);
        dummy.updateMatrix();
        this.emberMesh.setMatrixAt(embers, dummy.matrix);
        this.emberMesh.setColorAt(
          embers,
          this.tint.setRGB(1, 0.42 + 0.2 * flicker, 0.12),
        );
        embers++;
      }
    }
    this.smokeMesh.count = smoke;
    this.emberMesh.count = embers;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.emberMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    if (this.emberMesh.instanceColor) this.emberMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.smokeMesh, this.emberMesh);
    this.smokeMesh.geometry.dispose();
    (this.smokeMesh.material as THREE.Material).dispose();
    this.emberMesh.geometry.dispose();
    (this.emberMesh.material as THREE.Material).dispose();
  }
}
