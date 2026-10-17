import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { UNIT_KINDS } from "@scorched-3d/core";
import { muzzleWorld, getBarrel, getLegs, getMuzzleTip, getWheels } from "../renderer/units";
import { buildStudioBody, disposeStudioObject } from "./studio";
import { buildPreviewTerrain, PreviewAnimation } from "./preview";

describe("terrain study", () => {
  it("builds a deterministic rolling field with a level pad below the unit", () => {
    const field = buildPreviewTerrain(), other = buildPreviewTerrain();
    const positions = field.geometry.getAttribute("position");
    expect(Array.from(positions.array)).toEqual(Array.from(other.geometry.getAttribute("position").array));
    const heights = [];
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getZ(i));
      if (radius < 40) expect(positions.getY(i)).toBeCloseTo(-0.1);
      heights.push(positions.getY(i));
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
    expect(field.geometry.getAttribute("normal").count).toBe(positions.count);
    const group = new THREE.Group(); group.add(field, other); disposeStudioObject(group);
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
