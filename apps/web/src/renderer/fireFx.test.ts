import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BURN_DURATION,
  createDamageField,
  igniteTree,
  MAX_FIRES,
  MAX_SMOKE,
  SMOULDER_DURATION,
} from "@scorched-3d/core";
import {
  burnProgress,
  coreFlameTint,
  FireFx,
  MAX_FIRE_EMBERS,
  outerFlameTint,
  SMOKE_PER_BURNING,
} from "./fireFx";

function positions(n: number): { x: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * 100, z: 0 }));
}

describe("FireFx", () => {
  it("shows layered flames + embers + glow + smoke column for burning, smoke + ember for smoulder", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(3, 0);
    expect(igniteTree(field, 0)).toBe(true);
    field.trees[1] = "smouldering";
    fire.update(field, positions(3), () => 100, 1.5);
    // One burning tree: outer + core + ground glow.
    expect(fire.flameCount).toBe(1);
    expect(fire.coreCount).toBe(1);
    expect(fire.glowCount).toBe(1);
    // Burning tree gets a two-puff column plus one smoulder puff.
    expect(fire.smokeCount).toBe(SMOKE_PER_BURNING + 1);
    // Burning spark plus a dim leftover ember on the smouldering wreck.
    expect(fire.emberCount).toBe(2);
    fire.dispose();
  });

  it("caps every layer at its instance budget", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(MAX_FIRES + 10, 0);
    // Bypass the core ignite cap to prove the view budget holds regardless.
    for (let i = 0; i < field.trees.length; i++) field.trees[i] = "burning";
    fire.update(field, positions(field.trees.length), () => 100, 2.5);
    expect(fire.flameCount).toBe(MAX_FIRES);
    expect(fire.coreCount).toBe(MAX_FIRES);
    expect(fire.glowCount).toBe(MAX_FIRES);
    expect(fire.emberCount).toBeLessThanOrEqual(MAX_FIRE_EMBERS);
    expect(fire.smokeCount).toBeLessThanOrEqual(MAX_SMOKE);
    fire.dispose();
  });

  it("caps mixed smoke: burning columns plus smoulder singles stay in budget", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(MAX_SMOKE, 0);
    for (let i = 0; i < field.trees.length; i++) {
      field.trees[i] = i % 2 === 0 ? "burning" : "smouldering";
    }
    fire.update(field, positions(field.trees.length), () => 100, 0.5);
    expect(fire.smokeCount).toBeLessThanOrEqual(MAX_SMOKE);
    expect(fire.emberCount).toBeLessThanOrEqual(MAX_FIRE_EMBERS);
    fire.dispose();
  });

  it("dies flames down with burn age but keeps the instances alive", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(1, 0);
    expect(igniteTree(field, 0)).toBe(true);
    field.treeAge[0] = SMOULDER_DURATION; // well past the burn duration
    fire.update(field, positions(1), () => 100, 1.5);
    // Still burning (core owns the transition), so all layers still show —
    // the view never pops flames early, it just renders them low and amber.
    expect(fire.flameCount).toBe(1);
    expect(fire.coreCount).toBe(1);
    expect(burnProgress(field.treeAge[0]!)).toBe(1);
    fire.dispose();
  });

  it("clears transients yet rebuilds from the persistent field", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(2, 0);
    expect(igniteTree(field, 0)).toBe(true);
    fire.update(field, positions(2), () => 100, 0.5);
    expect(fire.flameCount).toBe(1);
    fire.clearTransients();
    expect(fire.flameCount).toBe(0);
    expect(fire.coreCount).toBe(0);
    expect(fire.emberCount).toBe(0);
    expect(fire.smokeCount).toBe(0);
    expect(fire.glowCount).toBe(0);
    // Field untouched: next tick rebuilds the same flames (re-snap path).
    fire.update(field, positions(2), () => 200, 0.6);
    expect(fire.flameCount).toBe(1);
    expect(fire.coreCount).toBe(1);
    fire.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("burnProgress clamps fresh ignitions to 0 and old burns to 1", () => {
    expect(burnProgress(0)).toBe(0);
    expect(burnProgress(-3)).toBe(0);
    expect(burnProgress(BURN_DURATION / 2)).toBeGreaterThan(0);
    expect(burnProgress(BURN_DURATION / 2)).toBeLessThan(1);
    expect(burnProgress(BURN_DURATION)).toBe(1);
    expect(burnProgress(999)).toBe(1);
  });

  it("stays subtle: small soft flames, dim embers/smoke/glow", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const internals = fire as unknown as {
      outerMesh: THREE.InstancedMesh;
      coreMesh: THREE.InstancedMesh;
      emberMesh: THREE.InstancedMesh;
      smokeMesh: THREE.InstancedMesh;
      glowMesh: THREE.InstancedMesh;
    };
    // Modest cones, never the old traffic-cone silhouette.
    const outerGeo = internals.outerMesh.geometry as THREE.ConeGeometry;
    expect(outerGeo.parameters.radius).toBeLessThanOrEqual(8);
    expect(outerGeo.parameters.height).toBeLessThanOrEqual(26);
    const coreGeo = internals.coreMesh.geometry as THREE.ConeGeometry;
    expect(coreGeo.parameters.radius).toBeLessThanOrEqual(4.5);
    expect(coreGeo.parameters.height).toBeLessThanOrEqual(18);
    expect((internals.outerMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.4);
    expect((internals.coreMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.65);
    expect((internals.emberMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.75);
    expect((internals.smokeMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.25);
    expect((internals.glowMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.22);
    // Small soft puffs/sparks, never near-black smoke.
    expect((internals.smokeMesh.geometry as THREE.SphereGeometry).parameters.radius).toBeLessThanOrEqual(8);
    expect((internals.emberMesh.geometry as THREE.SphereGeometry).parameters.radius).toBeLessThanOrEqual(1.6);
    fire.dispose();
  });

  it("tracks the longer burn: 7-second-old fires still flame mid-progress", () => {
    expect(BURN_DURATION).toBeGreaterThanOrEqual(12);
    expect(SMOULDER_DURATION).toBeGreaterThanOrEqual(18);
    // 7 s used to be past the burn; now it reads as a half-died flame.
    expect(burnProgress(7)).toBeGreaterThan(0);
    expect(burnProgress(7)).toBeLessThan(1);
  });

  it("cools flame tints monotonically: young fires burn brighter", () => {
    const [or0, og0, ob0] = outerFlameTint(0);
    const [or1, og1, ob1] = outerFlameTint(1);
    expect(or0).toBe(1);
    expect(or1).toBe(1);
    expect(og0).toBeGreaterThan(og1);
    expect(ob0).toBeGreaterThan(ob1);
    const [, cg0, cb0] = coreFlameTint(0);
    const [, cg1, cb1] = coreFlameTint(1);
    expect(cg0).toBeGreaterThan(cg1);
    expect(cb0).toBeGreaterThan(cb1);
    // Core always reads hotter (brighter) than the outer shell.
    expect(cg0).toBeGreaterThan(og0);
    expect(cb0).toBeGreaterThan(ob0);
  });
});
