import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { UNIT_KINDS } from "@scorched-3d/core";
import { muzzleWorld, getBarrel, getLegs, getMuzzleTip, getTurret, getWheels } from "../renderer/units";
import { buildStudioBody, disposeStudioObject } from "./studio";
import { buildPreviewTerrain, PreviewAnimation } from "./preview";

describe("terrain study", () => {
  // Only the browser's byte container is stubbed; use the real terrain/albedo pipeline.
  beforeAll(() => vi.stubGlobal("ImageData", class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }));
  afterAll(() => vi.unstubAllGlobals());
  it("builds a deterministic rolling field with a level pad below the unit", () => {
    const field = buildPreviewTerrain(), other = buildPreviewTerrain();
    const positions = field.geometry.getAttribute("position");
    expect(Array.from(positions.array)).toEqual(Array.from(other.geometry.getAttribute("position").array));
    const heights = [];
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getZ(i));
      if (radius < 25) expect(positions.getY(i)).toBeCloseTo(-0.06);
      heights.push(positions.getY(i));
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
    expect(field.geometry.getAttribute("normal").count).toBe(positions.count);
    const material = field.material as THREE.MeshStandardMaterial;
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.map!.flipY).toBe(true);
    expect(field.children).toHaveLength(28);
    for (const child of field.children) {
      expect(Math.hypot(child.position.x, child.position.z)).toBeGreaterThanOrEqual(47.99);
      expect(child.castShadow).toBe(true);
    }
    const textureDispose = vi.spyOn(material.map!, "dispose");
    const rockDispose = vi.spyOn((field.children[0] as THREE.Mesh).geometry, "dispose");
    const group = new THREE.Group(); group.add(field, other); disposeStudioObject(group);
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(rockDispose).toHaveBeenCalledOnce();
  });
});

describe("visual-only folio animation", () => {
  it.each(UNIT_KINDS)("animates %s in place, fires from its actual muzzle and resets on stop", (kind) => {
    const body = buildStudioBody(kind);
    const animation = new PreviewAnimation(body, kind);
    const scene = new THREE.Group(); scene.add(body, animation.effects);
    const barrel = getBarrel(body), barrelZ = barrel?.position.z;
    const limbs = [...getWheels(body), ...getLegs(body)];
    for (let i = 0; i < 10; i++) animation.update(0.05, true, false, true);
    expect(limbs.some((limb) => limb.rotation.x !== 0)).toBe(true);
    expect(body.position.toArray()).toEqual([0, 0, 0]);
    expect(animation.ring.visible).toBe(true);
    animation.update(0.05, true, true, true);
    const tip = getMuzzleTip(body)!;
    expect(animation.flash.visible).toBe(true);
    expect(animation.flash.position.distanceTo(tip.getWorldPosition(new THREE.Vector3()))).toBeLessThan(0.001);
    animation.update(0.05, true, true, true);
    expect(animation.tracer.position.distanceTo(animation.flash.position)).toBeGreaterThan(1);
    if (barrel) expect(barrel.position.z).toBeLessThan(barrelZ!);
    animation.update(0.05, false, false, false);
    expect(animation.flash.visible).toBe(false);
    expect(animation.tracer.visible).toBe(false);
    expect(animation.ring.visible).toBe(false);
    if (barrel) expect(barrel.position.z).toBe(barrelZ);
    for (let i = 0; i < 100; i++) animation.update(0.05, false, false, false);
    for (const leg of getLegs(body)) expect(leg.rotation.x).toBeCloseTo(0, 4);
    const flashDispose = vi.spyOn(animation.flash.geometry, "dispose");
    disposeStudioObject(scene);
    expect(flashDispose).toHaveBeenCalledOnce();
  });

  it("carries the scout rifle horizontally while walking and shooting in the folio", () => {
    const body = buildStudioBody("peewee");
    const animation = new PreviewAnimation(body, "peewee");
    const scene = new THREE.Group(); scene.add(body, animation.effects);
    for (const shooting of [false, true, false]) {
      for (let i = 0; i < 60; i++) animation.update(1 / 60, true, shooting, false);
      expect(muzzleWorld(body)!.direction.y).toBeCloseTo(0, 8);
    }
    disposeStudioObject(scene);
  });

  it("fires the Commander preview from the claw cannon after torso traverse", () => {
    const body = buildStudioBody("commander");
    getTurret(body)!.rotation.y = 0.6;
    body.rotation.y = 0.4;
    const animation = new PreviewAnimation(body, "commander");
    const scene = new THREE.Group(); scene.add(body, animation.effects);
    animation.update(0.05, false, true, false);
    const weapon = body.getObjectByName("commander-weapon")!;
    const tip = getMuzzleTip(body)!;
    expect(tip.parent).toBe(weapon);
    expect(animation.flash.position.distanceTo(tip.getWorldPosition(new THREE.Vector3()))).toBeLessThan(0.001);
    const local = weapon.worldToLocal(animation.flash.position.clone());
    expect(local.x).toBeCloseTo(0, 7); expect(local.y).toBeCloseTo(0, 7);
    expect(local.z).toBeCloseTo(4.95, 7);
    const start = animation.tracer.position.clone();
    animation.update(0.05, false, true, false);
    const direction = new THREE.Vector3(0, 0, 1).transformDirection(tip.matrixWorld);
    expect(animation.tracer.position.clone().sub(start).normalize().distanceTo(direction)).toBeLessThan(0.001);
    disposeStudioObject(scene);
  });

  it("repeats shooting and restarts immediately after toggling it back on", () => {
    const body = buildStudioBody("stump");
    const animation = new PreviewAnimation(body, "stump");
    let flashes = 0;
    for (let i = 0; i < 110; i++) {
      const wasVisible = animation.flash.visible;
      animation.update(0.05, false, true, false);
      if (!wasVisible && animation.flash.visible) flashes++;
    }
    expect(flashes).toBe(3);
    animation.update(0.05, false, false, false);
    animation.update(0.05, false, true, false);
    expect(animation.flash.visible).toBe(true);
    const group = new THREE.Group(); group.add(body, animation.effects); disposeStudioObject(group);
  });
});
