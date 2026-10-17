import * as THREE from "three";
import { sampleHeightField, sampleHeightBilinear, worldHeight, type UnitKind } from "@scorched-3d/core";
import { advanceLocomotion, buildTeamRing, getBarrel, getMuzzleTip } from "../renderer/units";

/** A compact Greenreach study field. Level the inspection pad under every hull. */
export function buildPreviewTerrain(): THREE.Mesh {
  const field = sampleHeightField("greenreach", 24);
  const height = (x: number, z: number) => worldHeight(sampleHeightBilinear(field, x, z), 0.38);
  const origin = height(0, 0);
  const geometry = new THREE.PlaneGeometry(1200, 1200, 96, 96);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const colors: number[] = [];
  const grass = new THREE.Color(0x66734b), rock = new THREE.Color(0x8a8870);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const y = (height(x, z) - origin) * THREE.MathUtils.smoothstep(Math.hypot(x, z), 40, 120);
    positions.setY(i, y - 0.1);
    const color = grass.clone().lerp(rock, THREE.MathUtils.clamp(Math.abs(y) / 45, 0, 1));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  return terrain;
}

/** Visual-only, deterministic workshop animation; never issues battle commands. */
export class PreviewAnimation {
  readonly effects = new THREE.Group();
  readonly ring = buildTeamRing(0);
  readonly flash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe7a1 }));
  readonly tracer = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffc76b }));
  private shotAge = Infinity;
  private firing = false;
  private barrel;
  private barrelZ: number;
  private direction = new THREE.Vector3();
  private muzzle = new THREE.Vector3();

  constructor(private body: THREE.Group, private kind: UnitKind) {
    this.barrel = getBarrel(body);
    this.barrelZ = this.barrel?.position.z ?? 0;
    this.ring.visible = false;
    this.ring.position.y = 0.15;
    this.flash.visible = this.tracer.visible = false;
    this.effects.add(this.ring, this.flash, this.tracer);
  }

  update(dt: number, motion: boolean, shooting: boolean, selection: boolean): void {
    const step = Math.max(0, Math.min(dt, 0.05));
    // Calling with zero travel settles walkers back to their neutral stance.
    advanceLocomotion(this.body, this.kind, motion ? step * 16 : 0, step);
    this.ring.visible = selection;
    if (shooting && (!this.firing || this.shotAge >= 2.4)) {
      this.shotAge = 0;
      const tip = getMuzzleTip(this.body);
      if (tip) {
        this.body.updateMatrixWorld(true);
        tip.getWorldPosition(this.muzzle);
        this.direction.set(0, 0, 1).transformDirection(tip.matrixWorld);
      }
    } else this.shotAge += step;
    this.firing = shooting;
    if (!shooting) this.shotAge = Infinity;
    const tip = getMuzzleTip(this.body);
    const age = this.shotAge;
    if (this.barrel) this.barrel.position.z = this.barrelZ - (age < 0.6 ? Math.sin(Math.min(age / 0.07, 1) * Math.PI / 2) * Math.exp(-age * 7) * 0.65 : 0);
    this.flash.visible = Boolean(tip) && age < 0.12;
    this.tracer.visible = Boolean(tip) && age < 0.65;
    if (this.flash.visible) {
      this.flash.position.copy(this.muzzle);
      this.flash.scale.setScalar(1 + (1 - age / 0.12) * 2);
    }
    if (this.tracer.visible) this.tracer.position.copy(this.muzzle).addScaledVector(this.direction, age * 140);
  }
}
