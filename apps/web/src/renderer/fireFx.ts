import * as THREE from "three";
import { MAX_FIRES, MAX_SMOKE, type DamageField } from "@scorched-3d/core";

/**
 * Transient fire/smoke views over the persistent core `DamageField`.
 * Burning trees get a flickering flame cone + smoke puff; smouldering trees
 * get smoke only. Both are single instanced draws (no per-tree objects, no
 * per-frame allocations — one shared dummy, compact in-place fill), capped
 * at MAX_FIRES flames / MAX_SMOKE puffs with the field order winning (older
 * damage first, so long battles shed the newest smoke, never the state).
 *
 * Fire light reuses the combat 2-light pool: the owner kicks
 * `CombatFx.glowAt()` on ignition events, so this class owns no lights.
 * Everything here is transient: `clearTransients()` hides all instances
 * (e.g. on exaggeration re-snap) and the next `update()` rebuilds them from
 * the still-persistent field; `dispose()` removes the meshes for regen.
 */
export class FireFx {
  private scene: THREE.Scene;
  private flameMesh: THREE.InstancedMesh;
  private smokeMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const flameGeo = new THREE.ConeGeometry(7, 26, 7);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff7a22,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flameMesh = new THREE.InstancedMesh(flameGeo, flameMat, MAX_FIRES);
    this.flameMesh.count = 0;
    this.flameMesh.frustumCulled = false;
    this.flameMesh.renderOrder = 3;
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
    // Pre-fill tints so instanceColor exists before the first setColorAt.
    for (let i = 0; i < MAX_FIRES; i++) this.flameMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    for (let i = 0; i < MAX_SMOKE; i++) this.smokeMesh.setColorAt(i, this.tint.setRGB(1, 1, 1));
    this.scene.add(this.flameMesh, this.smokeMesh);
  }

  /** Visible flame count (== burning trees shown, bounded by MAX_FIRES). */
  get flameCount(): number {
    return this.flameMesh.count;
  }

  /** Visible smoke puff count (bounded by MAX_SMOKE). */
  get smokeCount(): number {
    return this.smokeMesh.count;
  }

  /**
   * Rebuild flame/smoke instances from the damage field. `positions` carries
   * base X/Z per tree id; `groundY` seats heights live (exaggeration-safe).
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
    let smoke = 0;
    const n = Math.min(field.trees.length, positions.length);
    for (let i = 0; i < n; i++) {
      const state = field.trees[i]!;
      if (state !== "burning" && state !== "smouldering") continue;
      const p = positions[i]!;
      const y = groundY(p.x, p.z);
      if (state === "burning" && flames < MAX_FIRES) {
        // Flicker without rng: phase-hash the index so neighbours desync.
        const flicker = 0.9 + 0.25 * Math.sin(elapsed * 13 + i * 1.7);
        dummy.position.set(p.x, y + 16 * flicker, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(flicker, flicker * (1 + 0.15 * Math.sin(elapsed * 17 + i)), flicker);
        dummy.updateMatrix();
        this.flameMesh.setMatrixAt(flames, dummy.matrix);
        // Yellow-white core variation across the burn (age 0 → 1 over burn).
        const heat = 1 - Math.min(field.treeAge[i]! / 6, 1) * 0.4;
        this.flameMesh.setColorAt(flames, this.tint.setRGB(1, 0.45 + 0.3 * heat, 0.12));
        flames++;
      }
      if (smoke < MAX_SMOKE) {
        // Puffs loop upward: phase-hash keeps a steady column per tree.
        const rise = (elapsed * 14 + (i * 37) % 46) % 46;
        dummy.position.set(p.x + Math.sin(elapsed * 0.9 + i) * 4, y + 30 + rise, p.z);
        dummy.rotation.set(0, 0, 0);
        const s = (state === "burning" ? 1.1 : 0.8) * (0.7 + rise / 46);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(smoke, dummy.matrix);
        if (state === "burning") this.smokeMesh.setColorAt(smoke, this.tint.setRGB(0.22, 0.2, 0.18));
        else this.smokeMesh.setColorAt(smoke, this.tint.setRGB(0.55, 0.52, 0.48));
        smoke++;
      }
    }
    this.flameMesh.count = flames;
    this.smokeMesh.count = smoke;
    this.flameMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    if (this.flameMesh.instanceColor) this.flameMesh.instanceColor.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
  }

  /** Hide all flames/smoke; the field persists and rebuilds them next tick. */
  clearTransients(): void {
    this.flameMesh.count = 0;
    this.smokeMesh.count = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.flameMesh, this.smokeMesh);
    this.flameMesh.geometry.dispose();
    (this.flameMesh.material as THREE.Material).dispose();
    this.smokeMesh.geometry.dispose();
    (this.smokeMesh.material as THREE.Material).dispose();
  }
}
