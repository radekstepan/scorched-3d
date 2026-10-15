import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  HEALTH_BAR_LIFT,
  HEALTH_FULL_COLOR,
  HEALTH_LOW_COLOR,
  HEALTH_MID_COLOR,
  HealthBars,
  healthColorFor,
  healthFraction,
  type HealthSource,
} from "./healthBars";

function source(
  damage: number[] = [],
  destroyed: boolean[] = [],
  gone: boolean[] = [],
): HealthSource {
  return {
    unitDamageAt: (i: number) => damage[i] ?? 0,
    isDestroyedAt: (i: number) => destroyed[i] ?? false,
    isHuskGoneAt: (i: number) => gone[i] ?? false,
  };
}

function bodies(count: number, y = 10): THREE.Group[] {
  return Array.from({ length: count }, (_, i) => {
    const g = new THREE.Group();
    g.position.set(i * 100, y, i * 50);
    return g;
  });
}

function makeBars(count: number): { scene: THREE.Scene; bars: HealthBars; camera: THREE.Camera } {
  const scene = new THREE.Scene();
  const bars = new HealthBars(scene, count);
  const camera = new THREE.PerspectiveCamera();
  return { scene, bars, camera };
}

describe("health helpers", () => {
  it("derives remaining health from damage, clamped", () => {
    expect(healthFraction(0)).toBe(1);
    expect(healthFraction(0.25)).toBeCloseTo(0.75, 6);
    expect(healthFraction(1)).toBe(0);
    expect(healthFraction(1.5)).toBe(0);
    expect(healthFraction(-0.5)).toBe(1);
  });

  it("colors fills green, then amber, then red", () => {
    expect(healthColorFor(1)).toBe(HEALTH_FULL_COLOR);
    expect(healthColorFor(0.56)).toBe(HEALTH_FULL_COLOR);
    expect(healthColorFor(0.55)).toBe(HEALTH_MID_COLOR);
    expect(healthColorFor(0.29)).toBe(HEALTH_MID_COLOR);
    expect(healthColorFor(0.28)).toBe(HEALTH_LOW_COLOR);
    expect(healthColorFor(0)).toBe(HEALTH_LOW_COLOR);
  });
});

describe("HealthBars", () => {
  it("shows a full green bar above every live body", () => {
    const { scene, bars, camera } = makeBars(2);
    expect(scene.getObjectByName("healthbars")).toBe(bars.group);
    bars.update(source([0, 0]), bodies(2), camera);
    expect(bars.isShown(0)).toBe(true);
    expect(bars.isShown(1)).toBe(true);
    expect(bars.fraction(0)).toBeCloseTo(1, 6);
    bars.dispose();
  });

  it("seats bars above the hull and billboards them at the camera", () => {
    const { bars, camera } = makeBars(1);
    camera.quaternion.setFromEuler(new THREE.Euler(0.3, 0.7, 0));
    const [body] = bodies(1, 12);
    bars.update(source([0]), [body!], camera);
    const bar = bars.group.children[0]!;
    expect(bar.position.x).toBe(body!.position.x);
    expect(bar.position.y).toBe(12 + HEALTH_BAR_LIFT);
    expect(bar.position.z).toBe(body!.position.z);
    expect(bar.quaternion.equals(camera.quaternion)).toBe(true);
    bars.dispose();
  });

  it("drains and recolors the fill as damage accumulates", () => {
    const { bars, camera } = makeBars(1);
    const fills = bars.group.children.map(
      (g) => g.getObjectByName("healthbar-fill") as THREE.Mesh,
    );
    bars.update(source([0.8]), bodies(1), camera);
    expect(bars.fraction(0)).toBeCloseTo(0.2, 6);
    const mat = fills[0]!.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(HEALTH_LOW_COLOR);
    bars.update(source([0.5]), bodies(1), camera);
    expect(mat.color.getHex()).toBe(HEALTH_MID_COLOR);
    bars.update(source([0]), bodies(1), camera);
    expect(mat.color.getHex()).toBe(HEALTH_FULL_COLOR);
    bars.dispose();
  });

  it("hides bars for wrecks, gone husks, and while toggled off", () => {
    const { bars, camera } = makeBars(3);
    bars.update(source([0.2, 0.2, 0], [false, true, false], [false, false, true]), bodies(3), camera);
    expect(bars.isShown(0)).toBe(true);
    expect(bars.isShown(1)).toBe(false);
    expect(bars.isShown(2)).toBe(false);
    expect(bars.fraction(1)).toBe(0);
    bars.setVisible(false);
    bars.update(source([0, 0, 0]), bodies(3), camera);
    expect(bars.isShown(0)).toBe(false);
    expect(bars.group.visible).toBe(false);
    bars.setVisible(true);
    bars.update(source([0, 0, 0]), bodies(3), camera);
    expect(bars.isShown(0)).toBe(true);
    bars.dispose();
  });

  it("hides bars past the roster and disposes cleanly", () => {
    const scene = new THREE.Scene();
    const bars = new HealthBars(scene, 2);
    const camera = new THREE.PerspectiveCamera();
    bars.update(source([0]), bodies(1), camera);
    expect(bars.isShown(0)).toBe(true);
    expect(bars.isShown(1)).toBe(false);
    bars.setCount(1);
    expect(bars.count).toBe(1);
    bars.dispose();
    expect(scene.getObjectByName("healthbars")).toBeUndefined();
  });
});
