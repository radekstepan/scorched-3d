import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  HEALTH_BAR_LIFT,
  HEALTH_FULL_COLOR,
  HEALTH_LOW_COLOR,
  HEALTH_MID_COLOR,
  HQ_HEALTH_BAR_LIFT,
  HQ_HEALTH_BAR_WIDTH,
  HealthBars,
  healthColorFor,
  healthFraction,
  type HealthSource,
  type HqHealthSource,
} from "./healthBars";
import { buildHq } from "./hq";

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

function hqSource(damage: number[] = [], destroyed: boolean[] = []): HqHealthSource {
  return {
    damageAt: (i: number) => damage[i] ?? 0,
    isDestroyedAt: (i: number) => destroyed[i] ?? false,
  };
}

function hqBodies(): THREE.Group[] {
  return [buildHq(0), buildHq(1)].map((g, i) => {
    g.position.set(i === 0 ? -1000 : 1000, 40, 0);
    return g;
  });
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

  it("skips re-seating while toggled off (same hidden result, no transform churn)", () => {
    // Hot-loop sweep: the hidden path used to re-seat + billboard every bar
    // per tick before hiding it. Bars now hide up front and hold their pose.
    const { bars, camera } = makeBars(1);
    const [body] = bodies(1, 12);
    bars.update(source([0]), [body!], camera);
    const bar = bars.group.children[0]!;
    const y = bar.position.y;
    expect(y).toBe(12 + HEALTH_BAR_LIFT);
    bars.setVisible(false);
    body!.position.set(999, 888, 777);
    bars.update(source([0]), [body!], camera);
    expect(bars.isShown(0)).toBe(false);
    expect(bar.position.y).toBe(y);
    expect(bar.position.x).not.toBe(999);
    bars.dispose();
  });

  it("hides bars past the roster and disposes cleanly", () => {    const scene = new THREE.Scene();
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

describe("HQ health bars", () => {
  it("shows a full bar above every live HQ (both teams)", () => {
    const { bars, camera } = makeBars(0);
    bars.setHqCount(2);
    expect(bars.hqCount).toBe(2);
    bars.updateHq(hqSource([0, 0]), hqBodies(), camera);
    expect(bars.isHqShown(0)).toBe(true);
    expect(bars.isHqShown(1)).toBe(true);
    expect(bars.hqFraction(0)).toBeCloseTo(1, 6);
    expect(bars.hqFraction(1)).toBeCloseTo(1, 6);
    bars.dispose();
  });

  it("seats HQ bars above the works, wider than unit bars, billboarded", () => {
    const { bars, camera } = makeBars(1);
    bars.setHqCount(1);
    camera.quaternion.setFromEuler(new THREE.Euler(0.3, 0.7, 0));
    const [works] = hqBodies();
    bars.updateHq(hqSource([0]), [works!], camera);
    const hqBar = bars.group.children.filter((c) => c.name === "hq-healthbar")[0]!;
    expect(hqBar.position.x).toBe(works!.position.x);
    expect(hqBar.position.y).toBe(works!.position.y + HQ_HEALTH_BAR_LIFT);
    expect(hqBar.position.z).toBe(works!.position.z);
    expect(hqBar.quaternion.equals(camera.quaternion)).toBe(true);
    const bg = hqBar.getObjectByName("healthbar-bg") as THREE.Mesh;
    expect((bg.geometry as THREE.PlaneGeometry).parameters.width).toBeCloseTo(HQ_HEALTH_BAR_WIDTH, 9);
    bars.dispose();
  });

  it("drains and recolors the HQ fill as damage accumulates", () => {
    const { bars, camera } = makeBars(0);
    bars.setHqCount(1);
    const hqBar = bars.group.children.filter((c) => c.name === "hq-healthbar")[0]!;
    const mat = hqBar.getObjectByName("healthbar-fill") as THREE.Mesh;
    const fillMat = mat.material as THREE.MeshBasicMaterial;
    bars.updateHq(hqSource([0.8]), hqBodies().slice(0, 1), camera);
    expect(bars.hqFraction(0)).toBeCloseTo(0.2, 6);
    expect(fillMat.color.getHex()).toBe(HEALTH_LOW_COLOR);
    bars.updateHq(hqSource([0.5]), hqBodies().slice(0, 1), camera);
    expect(fillMat.color.getHex()).toBe(HEALTH_MID_COLOR);
    bars.updateHq(hqSource([0]), hqBodies().slice(0, 1), camera);
    expect(fillMat.color.getHex()).toBe(HEALTH_FULL_COLOR);
    bars.dispose();
  });

  it("hides wrecked HQ bars and every HQ bar while toggled off", () => {
    const { bars, camera } = makeBars(0);
    bars.setHqCount(2);
    bars.updateHq(hqSource([0.2, 0.2], [false, true]), hqBodies(), camera);
    expect(bars.isHqShown(0)).toBe(true);
    expect(bars.isHqShown(1)).toBe(false);
    expect(bars.hqFraction(1)).toBe(0);
    bars.setVisible(false);
    bars.updateHq(hqSource([0, 0]), hqBodies(), camera);
    expect(bars.isHqShown(0)).toBe(false);
    expect(bars.group.visible).toBe(false);
    bars.setVisible(true);
    bars.updateHq(hqSource([0, 0]), hqBodies(), camera);
    expect(bars.isHqShown(0)).toBe(true);
    bars.dispose();
  });

  it("resizes the HQ roster and hides bars past it", () => {
    const { bars, camera } = makeBars(0);
    bars.setHqCount(2);
    bars.updateHq(hqSource([0]), hqBodies().slice(0, 1), camera);
    expect(bars.isHqShown(0)).toBe(true);
    expect(bars.isHqShown(1)).toBe(false);
    bars.setHqCount(1);
    expect(bars.hqCount).toBe(1);
    bars.dispose();
  });
});
