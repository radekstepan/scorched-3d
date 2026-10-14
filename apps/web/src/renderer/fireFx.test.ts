import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDamageField, igniteTree, MAX_FIRES, MAX_SMOKE } from "@scorched-3d/core";
import { FireFx } from "./fireFx";

function positions(n: number): { x: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * 100, z: 0 }));
}

describe("FireFx", () => {
  it("shows flames + smoke for burning trees, smoke only for smoulder", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(3, 0);
    expect(igniteTree(field, 0)).toBe(true);
    field.trees[1] = "smouldering";
    fire.update(field, positions(3), () => 100, 1.5);
    expect(fire.flameCount).toBe(1);
    expect(fire.smokeCount).toBe(2);
    fire.dispose();
  });

  it("caps flames and smoke at their instance budgets", () => {
    const scene = new THREE.Scene();
    const fire = new FireFx(scene);
    const field = createDamageField(MAX_FIRES + 10, 0);
    // Bypass the core ignite cap to prove the view budget holds regardless.
    for (let i = 0; i < field.trees.length; i++) field.trees[i] = "burning";
    fire.update(field, positions(field.trees.length), () => 100, 2.5);
    expect(fire.flameCount).toBe(MAX_FIRES);
    expect(fire.smokeCount).toBeLessThanOrEqual(MAX_SMOKE);
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
    expect(fire.smokeCount).toBe(0);
    // Field untouched: next tick rebuilds the same flames (re-snap path).
    fire.update(field, positions(2), () => 200, 0.6);
    expect(fire.flameCount).toBe(1);
    fire.dispose();
    expect(scene.children.length).toBe(0);
  });
});
