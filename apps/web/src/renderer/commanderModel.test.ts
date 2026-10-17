import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { advanceLocomotion, buildSpawnedUnit, buildUnitIconBody, getBarrel, getLegs, getMuzzleTip, getTurret, getWheels, muzzleWorld, setUnitAim } from "./units";
import { applyUnitDamageTint, applyWreckChar } from "./unitDamageFx";
import { CombatFx, muzzlePoint } from "./combatFx";
import { getCamoTexture } from "./camo";
import { OcclusionFx, disposeOcclusionAssets } from "./occlusionFx";

describe("Commander model contract", () => {
  it("preserves hip seats, the stable foot envelope and the claw-mounted muzzle", () => {
    const body = buildUnitIconBody("commander"), feet = new THREE.Box3();
    getLegs(body).forEach(leg => feet.union(new THREE.Box3().setFromObject(leg)));
    const size = feet.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(14); expect(size.z).toBeLessThanOrEqual(8);
    expect(feet.min.y).toBeCloseTo(0);
    expect(getLegs(body).map(leg => leg.position.toArray())).toEqual([[-4, 14, 0], [4, 14, 0]]);
    expect(getWheels(body)).toHaveLength(0); expect(getBarrel(body)).toBeNull();
    const tip = getMuzzleTip(body)!;
    expect(tip.parent!.name).toBe("commander-weapon");
    expect(tip.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([-7.1, 16.9, 8.95]);
    const weapon = tip.parent!;
    const bounds = new THREE.Box3().setFromObject(weapon);
    expect(bounds.max.z).toBeLessThan(8.95);
    expect(bounds.max.z).toBeGreaterThan(8.85);
    expect(bounds.min.x).toBeLessThan(-7.1);
    expect(bounds.max.x).toBeGreaterThan(-7.1);
    expect(new THREE.Box3().setFromObject(body).max.y).toBeLessThanOrEqual(47.1);
    setUnitAim(body, 0.7, -0.2);
    expect(muzzleWorld(body)!.direction.x).toBeCloseTo(Math.sin(0.5));
  });
  it.each([0, Math.PI / 2, Math.PI, -0.7])("keeps fallback and live claw muzzles aligned at yaw %s", yaw => {
    const body = buildSpawnedUnit("commander", 0, 11, 17, yaw, () => 20);
    const live = muzzleWorld(body)!;
    const fallback = muzzlePoint(body.position, yaw, "commander");
    for (const axis of ["x", "y", "z"] as const) expect(live.position[axis]).toBeCloseTo(fallback[axis], 7);
    const weapon = getMuzzleTip(body)!.parent!;
    setUnitAim(body, yaw, 0.4);
    getTurret(body)!.rotation.set(-0.07, 0.4, 0.08);
    body.rotation.x = 0.12;
    const position = muzzleWorld(body)!.position;
    const local = weapon.worldToLocal(new THREE.Vector3(position.x, position.y, position.z));
    expect(local.x).toBeCloseTo(0); expect(local.y).toBeCloseTo(0); expect(local.z).toBeCloseTo(4.95);
  });
  it("launches the battlefield bolt from the same claw bore as its visible model", () => {
    const units = new THREE.Group();
    units.userData.units = [
      { kind: "commander", cellX: 0, cellZ: 0, rotation: 0, team: 0 },
      { kind: "stump", cellX: 0, cellZ: 50, rotation: Math.PI, team: 1 },
    ];
    const body = buildSpawnedUnit("commander", 0, 0, 0, 0, () => 100);
    units.add(body, buildSpawnedUnit("stump", 1, 0, 500, Math.PI, () => 100));
    const fx = new CombatFx(new THREE.Scene(), units, () => 0.5);
    try {
      fx.update(1 / 60); // Populate the live roster aim state before the explicit volley.
      const internals = fx as unknown as {
        fireAtUnit(attacker: number, target: number): boolean;
        shots: {start: THREE.Vector3; mesh: THREE.Mesh}[];
      };
      expect(internals.fireAtUnit(0, 1)).toBe(true);
      const shot = internals.shots[0]!;
      const position = muzzleWorld(body)!.position;
      expect(shot.start.distanceTo(new THREE.Vector3(position.x, position.y, position.z))).toBeLessThan(0.001);
      expect(shot.mesh.position.distanceTo(shot.start)).toBeLessThan(0.001);
      expect(shot.start.x).toBeCloseTo(-7.1);
      expect(shot.start.y).toBeCloseTo(body.position.y + 16.9);
    } finally {fx.dispose();}
  });
  it("retains antiphase gait and the torso brace / wreck transform paths", () => {
    const body = buildSpawnedUnit("commander", 0, 0, 0, 0, () => 0), torso = getTurret(body)!;
    const before = muzzleWorld(body)!;
    torso.rotation.x = -0.07;
    setUnitAim(body, 0, 0);
    expect(torso.rotation.x).toBeCloseTo(-0.07);
    expect(muzzleWorld(body)!.direction.y).toBeCloseTo(Math.sin(0.07));
    expect(muzzleWorld(body)!.position.z).toBeLessThan(before.position.z);
    torso.rotation.set(0, 0, 0);
    advanceLocomotion(body, "commander", 2, 0.3);
    const legs = getLegs(body);
    expect(legs[0]!.rotation.x).toBeGreaterThan(0.2);
    expect(legs[0]!.rotation.x).toBeCloseTo(-legs[1]!.rotation.x);
    for (let i = 0; i < 60; i++) advanceLocomotion(body, "commander", 0, 1 / 60);
    legs.forEach(leg => { expect(leg.rotation.x).toBeCloseTo(0); expect(leg.position.y).toBeCloseTo(14); });
    torso.rotation.set(0.5, 0.6, 0.3); torso.position.y -= 4;
    expect(muzzleWorld(body)!.position.y).toBeLessThan(before.position.y);
  });
  it("keeps independent paint and resources within the model budget", () => {
    const a = buildUnitIconBody("commander"), b = buildUnitIconBody("commander");
    const am = getLegs(a)[0]! as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    const bm = getLegs(b)[0]! as typeof am, pristine = bm.material.color.getHex();
    expect(am.geometry).not.toBe(bm.geometry); expect(am.material).not.toBe(bm.material);
    applyUnitDamageTint(a, 0.8); applyWreckChar(a);
    expect(am.material.color.getHex()).not.toBe(pristine); expect(bm.material.color.getHex()).toBe(pristine);
    expect(bm.material.map).toBe(getCamoTexture("commander"));
    let triangles = 0, draws = 0;
    b.traverse(o => { if (o instanceof THREE.Mesh) {
      draws++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
      expect(o.geometry.getAttribute("normal")).toBeDefined();
      if (o.userData.noCamo) expect((o.material as THREE.MeshLambertMaterial).map).toBeNull();
    }});
    expect(triangles).toBeLessThan(3600); // Four batched cannon finishes follow the claw as a single assembly.
    expect(draws).toBeLessThanOrEqual(22);
  });
});

describe("articulated walker occlusion silhouettes", () => {
  for (const kind of ["commander", "peewee"] as const) it(`mirrors every ${kind} leg finish and its gait pose`, () => {
    const body = buildUnitIconBody(kind), scene = new THREE.Scene(), fx = new OcclusionFx(scene, [kind]);
    const cam = {x:0, y:80, z:-300};
    const env = {groundY: (_x:number, z:number) => z < -80 && z > -120 ? 120 : 0, stands:[]};
    try {
      advanceLocomotion(body, kind, 2, 0.3);
      body.rotation.y = 0.3; body.position.set(5, 1, 4);
      fx.update(cam, [body], env, {isDestroyedAt:()=>false});
      body.updateMatrixWorld(true); fx.group.updateMatrixWorld(true);
      const sources: THREE.Mesh[] = [], fills: THREE.Mesh[] = [];
      body.traverse(o => {if (o instanceof THREE.Mesh) sources.push(o);});
      fx.group.traverse(o => {if (o instanceof THREE.Mesh && o.name === "occlusion-fill") fills.push(o);});
      expect(fx.isShown(0)).toBe(true); expect(fills.length).toBe(sources.length);
      for (const source of sources) {
        const fill = fills.find(f => f.geometry === source.geometry)!;
        expect(fill).toBeDefined();
        fill.matrixWorld.elements.forEach((v, i) => expect(v).toBeCloseTo(source.matrixWorld.elements[i]!, 5));
      }
    } finally {fx.dispose(); disposeOcclusionAssets();}
  });
});
