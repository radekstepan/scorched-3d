import * as THREE from "three";
import { BURN_DURATION, MAX_FIRES, MAX_SMOKE, type DamageField } from "@scorched-3d/core";

/** Burning trees emit a two-puff smoke column (lower + upper); smoulder gets one. */
export const SMOKE_PER_BURNING = 2;
/** Perf cap: fire embers (one per burning tree plus dim leftovers on smoulder). */
export const MAX_FIRE_EMBERS = 48;
/** Smoke column height for burning trees, world units. */
export const FIRE_SMOKE_RISE = 70;
/** Smoke column height for smouldering trees, world units. */
export const SMOULDER_SMOKE_RISE = 46;
/** Ember spark rise height above the canopy, world units. */
export const EMBER_RISE = 44;

/**
 * Burn progress 0 (fresh ignition, tall white-hot flames) .. 1 (about to
 * collapse to smoulder, low amber flames). Clamped; pure for tests.
 */
export function burnProgress(ageSeconds: number): number {
  if (!(ageSeconds > 0)) return 0;
  return Math.min(ageSeconds / BURN_DURATION, 1);
}

/**
 * Outer-flame tint at `progress`: fresh fires glow bright orange, dying fires
 * sink toward deep ember red. Pure (tuple, no scene state) for tests.
 */
export function outerFlameTint(progress: number): [number, number, number] {
  const p = Math.min(Math.max(progress, 0), 1);
  return [1, 0.42 - 0.24 * p, 0.1 - 0.04 * p];
}

/**
 * Core-flame tint at `progress`: near-white-yellow heart when young, amber
 * when dying. Pure (tuple, no scene state) for tests.
 */
export function coreFlameTint(progress: number): [number, number, number] {
  const p = Math.min(Math.max(progress, 0), 1);
  return [1, 0.82 - 0.3 * p, 0.42 - 0.22 * p];
}

/**
 * Layered tree-fire view over the persistent core `DamageField`.
 *
 * Nanolathe inspiration (adapted to three.js, no sprites/GAF here): nanolathe
 * pairs every explosion sprite with an additive flash shell plus a rising
 * smoke column and spark debris (`internal/effects`), never a single opaque
 * blob. Each burning tree gets the same treatment here — five pooled
 * instanced draws, no per-tree objects, no per-frame allocations:
 *
 * - outer flame: big translucent additive cone engulfing the canopy,
 * - core flame: smaller bright additive cone for the white-hot heart,
 * - embers: additive sparks spiralling up out of the flames (plus one dim
 *   leftover spark per smouldering wreck so wrecks still read as hot),
 * - smoke: a two-puff dark column per burning tree, one lighter puff per
 *   smouldering tree,
 * - glow: an additive ground disc so the fire lights the earth beneath it.
 *
 * Flames die down with burn age (tall/bright on ignition, low/amber before
 * the smoulder collapse) via the pure `burnProgress` curve; all flicker and
 * rise is phase-hashed by tree index, so neighbours desync with no rng and
 * replays stay deterministic. Fire light still reuses the combat 2-light
 * pool (`CombatFx.glowAt()` on ignition), so this class owns no lights.
 * Everything is transient: `clearTransients()` hides all instances (e.g. on
 * exaggeration re-snap) and the next `update()` rebuilds them from the
 * still-persistent field; `dispose()` removes the meshes for regen.
 */
export class FireFx {
  private scene: THREE.Scene;
  private outerMesh: THREE.InstancedMesh;
  private coreMesh: THREE.InstancedMesh;
  private emberMesh: THREE.InstancedMesh;
  private smokeMesh: THREE.InstancedMesh;
  private glowMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const outerGeo = new THREE.ConeGeometry(11, 34, 7);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.outerMesh = new THREE.InstancedMesh(outerGeo, outerMat, MAX_FIRES);
    this.outerMesh.count = 0;
    this.outerMesh.frustumCulled = false;
    this.outerMesh.renderOrder = 3;
    const coreGeo = new THREE.ConeGeometry(6, 24, 6);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, MAX_FIRES);
    this.coreMesh.count = 0;
    this.coreMesh.frustumCulled = false;
    this.coreMesh.renderOrder = 4;
    const emberGeo = new THREE.SphereGeometry(2.2, 6, 5);
    const emberMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.emberMesh = new THREE.InstancedMesh(emberGeo, emberMat, MAX_FIRE_EMBERS);
    this.emberMesh.count = 0;
    this.emberMesh.frustumCulled = false;
    this.emberMesh.renderOrder = 4;
    const smokeGeo = new THREE.SphereGeometry(10, 8, 6);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_SMOKE);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 3;
    const glowGeo = new THREE.CircleGeometry(1, 16);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8a2a,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, MAX_FIRES);
    this.glowMesh.count = 0;
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 2;
    // Pre-fill tints so instanceColor exists before the first setColorAt.
    for (let i = 0; i < MAX_FIRES; i++) {
      this.outerMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
      this.coreMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
      this.glowMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    }
    for (let i = 0; i < MAX_FIRE_EMBERS; i++) this.emberMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    for (let i = 0; i < MAX_SMOKE; i++) this.smokeMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    this.scene.add(this.outerMesh, this.coreMesh, this.emberMesh, this.smokeMesh, this.glowMesh);
  }

  /** Visible burning trees with layered flames (bounded by MAX_FIRES). */
  get flameCount(): number {
    return this.outerMesh.count;
  }

  /** Visible core-flame instances (one per burning tree shown). */
  get coreCount(): number {
    return this.coreMesh.count;
  }

  /** Visible ember sparks (bounded by MAX_FIRE_EMBERS). */
  get emberCount(): number {
    return this.emberMesh.count;
  }

  /** Visible smoke puffs (bounded by MAX_SMOKE). */
  get smokeCount(): number {
    return this.smokeMesh.count;
  }

  /** Visible ground-glow discs (one per burning tree shown). */
  get glowCount(): number {
    return this.glowMesh.count;
  }

  /**
   * Rebuild flame/ember/smoke/glow instances from the damage field.
   * `positions` carries base X/Z per tree id; `groundY` seats heights live
   * (exaggeration-safe).
   */
  update(
    field: DamageField,
    positions: readonly { x: number; z: number }[],
    groundY: (x: number, z: number) => number,
    elapsed: number,
  ): void {
    if (this.disposed) return;
    const dummy = this.dummy;
    let flames = 0;
    let embers = 0;
    let smoke = 0;
    const n = Math.min(field.trees.length, positions.length);
    for (let i = 0; i < n; i++) {
      const state = field.trees[i]!;
      if (state !== "burning" && state !== "smouldering") continue;
      const p = positions[i]!;
      const y = groundY(p.x, p.z);
      if (state === "burning" && flames < MAX_FIRES) {
        // Flames die down with burn age: full height on ignition, ~55%
        // when about to collapse into smoulder.
        const progress = burnProgress(field.treeAge[i] ?? 0);
        const height = 1.1 - 0.5 * progress;
        // Flicker without rng: phase-hash the index so neighbours desync;
        // outer and core breathe at different rates so the silhouette boils
        // instead of pulsing as one cone.
        const outerFlicker = 0.92 + 0.22 * Math.sin(elapsed * 13 + i * 1.7);
        const swayX = Math.sin(elapsed * 2.3 + i * 1.3) * 2.5;
        const swayZ = Math.cos(elapsed * 1.9 + i * 0.7) * 2.5;
        dummy.position.set(p.x + swayX, y + 19 * height * outerFlicker, p.z + swayZ);
        dummy.rotation.set(Math.sin(elapsed * 3.1 + i) * 0.09, 0, Math.cos(elapsed * 2.7 + i * 1.1) * 0.09);
        dummy.scale.set(outerFlicker, height * outerFlicker, outerFlicker);
        dummy.updateMatrix();
        this.outerMesh.setMatrixAt(flames, dummy.matrix);
        const [or, og, ob] = outerFlameTint(progress);
        this.outerMesh.setColorAt(flames, this.tint.setRGB(or, og, ob));
        const coreFlicker = 0.9 + 0.3 * Math.sin(elapsed * 17 + i * 2.3 + 1.1);
        dummy.position.set(p.x - swayX * 0.5, y + 15 * height * coreFlicker, p.z - swayZ * 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(coreFlicker, height * coreFlicker * (1 + 0.12 * Math.sin(elapsed * 21 + i)), coreFlicker);
        dummy.updateMatrix();
        this.coreMesh.setMatrixAt(flames, dummy.matrix);
        const [cr, cg, cb] = coreFlameTint(progress);
        this.coreMesh.setColorAt(flames, this.tint.setRGB(cr, cg, cb));
        if (embers < MAX_FIRE_EMBERS) {
          // Ember spark spiralling out of the flames: fast rise, wide wiggle.
          const rise = (elapsed * 30 + (i * 53) % EMBER_RISE) % EMBER_RISE;
          dummy.position.set(
            p.x + Math.sin(elapsed * 4.2 + i * 2.1) * 8,
            y + 22 + rise,
            p.z + Math.cos(elapsed * 3.6 + i * 1.4) * 8,
          );
          dummy.rotation.set(0, 0, 0);
          const spark = 0.7 + 0.6 * Math.abs(Math.sin(elapsed * 9 + i * 3.1));
          dummy.scale.setScalar(spark * (1.2 - rise / EMBER_RISE / 2));
          dummy.updateMatrix();
          this.emberMesh.setMatrixAt(embers, dummy.matrix);
          this.emberMesh.setColorAt(embers, this.tint.setRGB(1, 0.45 + 0.3 * spark, 0.12));
          embers++;
        }
        // Ground glow: firelight pooling on the earth beneath the canopy.
        dummy.position.set(p.x, y + 1.5, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(24 * (0.9 + 0.2 * Math.sin(elapsed * 11 + i * 2.2)) * (1 - 0.3 * progress));
        dummy.updateMatrix();
        this.glowMesh.setMatrixAt(flames, dummy.matrix);
        this.glowMesh.setColorAt(flames, this.tint.setRGB(1, 0.62 - 0.2 * progress, 0.3 - 0.12 * progress));
        flames++;
      } else if (state === "smouldering" && embers < MAX_FIRE_EMBERS) {
        // Wrecks still read as hot: one dim ember dancing low over the char.
        const flicker = 0.45 + 0.35 * Math.abs(Math.sin(elapsed * 7 + i * 2.9));
        dummy.position.set(
          p.x + Math.sin(elapsed * 2.4 + i * 1.7) * 5,
          y + 12 + 3 * Math.abs(Math.sin(elapsed * 1.8 + i)),
          p.z + Math.cos(elapsed * 2.1 + i * 0.9) * 5,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(flicker);
        dummy.updateMatrix();
        this.emberMesh.setMatrixAt(embers, dummy.matrix);
        this.emberMesh.setColorAt(embers, this.tint.setRGB(0.9, 0.3, 0.1));
        embers++;
      }
      if (state === "burning") {
        // Two-puff column: dark fresh smoke low, greyer dissipating puff up.
        for (let k = 0; k < SMOKE_PER_BURNING && smoke < MAX_SMOKE; k++) {
          const rise = (elapsed * 14 + (i * 37 + k * (FIRE_SMOKE_RISE / 2)) % FIRE_SMOKE_RISE) % FIRE_SMOKE_RISE;
          const t = rise / FIRE_SMOKE_RISE;
          dummy.position.set(
            p.x + Math.sin(elapsed * 0.9 + i + k * 2.1) * (4 + rise * 0.25),
            y + 32 + rise,
            p.z + k * 3,
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1.1 * (0.7 + t * 1.1));
          dummy.updateMatrix();
          this.smokeMesh.setMatrixAt(smoke, dummy.matrix);
          const tone = 0.2 + t * 0.25;
          this.smokeMesh.setColorAt(smoke, this.tint.setRGB(tone, tone * 0.94, tone * 0.88));
          smoke++;
        }
      } else if (smoke < MAX_SMOKE) {
        // Smoulder: single pale puff looping low over the wreck.
        const rise = (elapsed * 10 + (i * 37) % SMOULDER_SMOKE_RISE) % SMOULDER_SMOKE_RISE;
        dummy.position.set(p.x + Math.sin(elapsed * 0.9 + i) * 4, y + 28 + rise, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.8 * (0.7 + rise / SMOULDER_SMOKE_RISE));
        dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(smoke, dummy.matrix);
        this.smokeMesh.setColorAt(smoke, this.tint.setRGB(0.55, 0.52, 0.48));
        smoke++;
      }
    }
    this.outerMesh.count = flames;
    this.coreMesh.count = flames;
    this.emberMesh.count = embers;
    this.smokeMesh.count = smoke;
    this.glowMesh.count = flames;
    this.outerMesh.instanceMatrix.needsUpdate = true;
    this.coreMesh.instanceMatrix.needsUpdate = true;
    this.emberMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    if (this.outerMesh.instanceColor) this.outerMesh.instanceColor.needsUpdate = true;
    if (this.coreMesh.instanceColor) this.coreMesh.instanceColor.needsUpdate = true;
    if (this.emberMesh.instanceColor) this.emberMesh.instanceColor.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
  }

  /** Hide all flames/embers/smoke/glow; the field persists and rebuilds next tick. */
  clearTransients(): void {
    this.outerMesh.count = 0;
    this.coreMesh.count = 0;
    this.emberMesh.count = 0;
    this.smokeMesh.count = 0;
    this.glowMesh.count = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.outerMesh, this.coreMesh, this.emberMesh, this.smokeMesh, this.glowMesh);
    this.outerMesh.geometry.dispose();
    (this.outerMesh.material as THREE.Material).dispose();
    this.coreMesh.geometry.dispose();
    (this.coreMesh.material as THREE.Material).dispose();
    this.emberMesh.geometry.dispose();
    (this.emberMesh.material as THREE.Material).dispose();
    this.smokeMesh.geometry.dispose();
    (this.smokeMesh.material as THREE.Material).dispose();
    this.glowMesh.geometry.dispose();
    (this.glowMesh.material as THREE.Material).dispose();
  }
}
