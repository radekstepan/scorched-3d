import * as THREE from "three";
import { getTurret, setBarrelElevation } from "../renderer/units";
import { applyUnitDamageTint, applyWreckChar } from "../renderer/unitDamageFx";

export type Livery = "olive" | "sand" | "arctic";
export interface InspectionSettings {
  livery: Livery;
  turret: number;
  elevation: number;
  damage: number;
  wreck: boolean;
  night: boolean;
  legacy: boolean;
}
export const DEFAULT_INSPECTION: InspectionSettings = {
  livery: "olive", turret: 0, elevation: 3, damage: 0, wreck: false, night: false, legacy: false,
};

/** Capture production finishes once so every preview adjustment is reversible. */
export class InspectionModel {
  private finishes: { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial; color: number }[] = [];
  constructor(private body: THREE.Group) {
    body.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.noHighlight) return;
      const material = object.material;
      if (Array.isArray(material) || !("color" in material) || !("emissive" in material)) return;
      this.finishes.push({ mesh: object, material: material as THREE.MeshLambertMaterial, color: (material.color as THREE.Color).getHex() });
    });
  }
  update(settings: InspectionSettings, wireframe: boolean): void {
    for (const { mesh, material, color } of this.finishes) {
      material.color.setHex(color);
      // Production models tag functional metals/rubber as noCamo; retain those finishes.
      if (settings.livery !== "olive" && !mesh.userData.noCamo && !material.vertexColors) {
        const lightness = material.color.getHSL({ h: 0, s: 0, l: 0 }).l;
        material.color.setHex(settings.livery === "sand" ? 0xaa9270 : 0xa1aea5);
        material.color.multiplyScalar(0.65 + lightness);
      }
      mesh.userData.baseColor = material.color.getHex();
      material.wireframe = wireframe;
    }
    applyUnitDamageTint(this.body, settings.damage / 100);
    if (settings.wreck) applyWreckChar(this.body);
    this.body.userData.wreckCharred = settings.wreck;
    const turret = getTurret(this.body);
    if (turret) turret.rotation.set(settings.wreck ? 0.08 : 0, THREE.MathUtils.degToRad(settings.turret), settings.wreck ? 0.16 : 0);
    setBarrelElevation(this.body, THREE.MathUtils.degToRad(settings.elevation));
    this.body.rotation.x = settings.wreck ? 0.035 : 0;
    this.body.position.y = settings.wreck ? -0.4 : 0;
  }
}

export function applyStudyLighting(scene: THREE.Scene, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, rim: THREE.DirectionalLight, terrain: boolean, night: boolean): number {
  sun.intensity = (terrain ? 1.15 : 1.8) * (night ? 0.5 : 1);
  hemi.intensity = (terrain ? 0.45 : 0.85) * (night ? 0.6 : 1);
  rim.intensity = terrain ? 0 : 0.8;
  sun.position.set(...(terrain ? [-48, 60, 15] : [-35, 65, 40]) as [number, number, number]);
  sun.color.setHex(night ? 0xa6c7e0 : 0xfff0d0);
  rim.color.setHex(night ? 0x84a5c8 : 0xc5dab3);
  scene.background = new THREE.Color(terrain ? (night ? 0x252f39 : 0x6a7a60) : 0x20271c);
  scene.fog = terrain ? new THREE.Fog(night ? 0x35414b : 0x899780, 260, 1150) : null;
  return terrain ? 1.05 : 1.15;
}
