import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MAX_VETERAN_RANK } from "@scorched-3d/core";
import {
  VETERAN_BADGE_COLOR,
  VETERAN_BADGE_LIFT,
  VETERAN_BADGE_RENDER_ORDER,
  VETERAN_CHEVRON_BAR,
  VETERAN_CHEVRON_LENGTH,
  VETERAN_CHEVRON_STACK,
  VETERAN_FLOURISH_DURATION,
  VETERAN_FLOURISH_RISE,
  VETERAN_FLOURISH_SCALE,
  VETERAN_FLOURISH_SPIN,
  VeterancyFx,
  type VeterancySource,
} from "./veterancyFx";
import {
  HEALTH_BAR_HEIGHT,
  HEALTH_BAR_LIFT,
  HEALTH_BAR_RENDER_ORDER,
  HEALTH_BAR_WIDTH,
} from "./healthBars";
import { SELECTION_CORE, hueDistance } from "./selectionFx";

function makeBodies(count: number): THREE.Group[] {
  return Array.from({ length: count }, (_, i) => {
    const body = new THREE.Group();
    body.position.set(i * 100, 100 + i * 10, i * 50);
    return body;
  });
}

function makeSource(ranks: number[], destroyed: boolean[] = []): VeterancySource {
  return {
    rankAt: (i: number) => ranks[i] ?? 0,
    isDestroyedAt: (i: number) => destroyed[i] ?? false,
  };
}

function makeCamera(): THREE.Camera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 500, 1000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe("veteran badges", () => {
  it("lights one chevron per pip, nothing for rookies", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 4);
    try {
      const bodies = makeBodies(4);
      fx.update(makeSource([0, 1, 2, 3]), bodies, makeCamera(), 1 / 60);
      expect(fx.isShown(0)).toBe(false);
      expect(fx.chevronsShown(0)).toBe(0);
      expect(fx.isShown(1)).toBe(true);
      expect(fx.chevronsShown(1)).toBe(1);
      expect(fx.chevronsShown(2)).toBe(2);
      expect(fx.chevronsShown(3)).toBe(3);
      expect(MAX_VETERAN_RANK).toBe(3);
    } finally {
      fx.dispose();
    }
  });

  it("floats billboarded just above the health bar", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 1);
    try {
      const bodies = makeBodies(1);
      const camera = makeCamera();
      fx.update(makeSource([2]), bodies, camera, 1 / 60);
      const holder = scene.getObjectByName("veteran-badge")!;
      // Badge anchor clears the bar top (bar center + half height).
      expect(VETERAN_BADGE_LIFT).toBeGreaterThan(HEALTH_BAR_LIFT + HEALTH_BAR_HEIGHT / 2);
      expect(holder.position.x).toBe(bodies[0]!.position.x);
      expect(holder.position.y).toBe(bodies[0]!.position.y + VETERAN_BADGE_LIFT);
      expect(holder.position.z).toBe(bodies[0]!.position.z);
      expect(holder.quaternion.equals(camera.quaternion)).toBe(true);
    } finally {
      fx.dispose();
    }
  });

  it("hides for wrecks, gone husks, missing bodies, and off-screen hulls", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 3);
    try {
      const bodies = makeBodies(2);
      const camera = makeCamera();
      const source: VeterancySource = {
        rankAt: () => 2,
        isDestroyedAt: (i: number) => i === 0,
        isHuskGoneAt: (i: number) => i === 1,
      };
      fx.update(source, bodies, camera, 1 / 60);
      expect(fx.isShown(0)).toBe(false);
      expect(fx.isShown(1)).toBe(false);
      expect(fx.isShown(2)).toBe(false);
      // Same ranks, all live — only the frustum gate hides one.
      fx.update(makeSource([2, 2, 2]), [...bodies, makeBodies(1)[0]!], camera, 1 / 60, [
        true,
        false,
        true,
      ]);
      expect(fx.isShown(0)).toBe(true);
      expect(fx.isShown(1)).toBe(false);
      expect(fx.isShown(2)).toBe(true);
    } finally {
      fx.dispose();
    }
  });

  it("rides the Health toggle and resizes with the roster", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 2);
    try {
      const bodies = makeBodies(2);
      const camera = makeCamera();
      fx.update(makeSource([1, 1]), bodies, camera, 1 / 60);
      expect(fx.isShown(0)).toBe(true);
      fx.setVisible(false);
      fx.update(makeSource([1, 1]), bodies, camera, 1 / 60);
      expect(fx.isShown(0)).toBe(false);
      fx.setVisible(true);
      fx.setCount(3);
      expect(fx.count).toBe(3);
      fx.update(makeSource([1, 1, 1]), makeBodies(3), camera, 1 / 60);
      expect(fx.isShown(2)).toBe(true);
      fx.setCount(1);
      expect(fx.count).toBe(1);
    } finally {
      fx.dispose();
    }
  });

  it("keeps the badge gold distinct from selection cyan, above the bar layer", () => {
    // Gold chevrons must never read as the selection beacon.
    expect(hueDistance(VETERAN_BADGE_COLOR, SELECTION_CORE)).toBeGreaterThan(90);
    expect(VETERAN_BADGE_RENDER_ORDER).toBeGreaterThan(HEALTH_BAR_RENDER_ORDER + 1);
  });
});

describe("badge size and centering", () => {
  it("keeps the chevrons small next to the health bar", () => {
    // ∧ span incl. stripe thickness: (L + T/2)·√2.
    const span = (VETERAN_CHEVRON_LENGTH + VETERAN_CHEVRON_BAR / 2) * Math.SQRT2;
    expect(span).toBeLessThan(HEALTH_BAR_WIDTH / 3);
    expect(VETERAN_CHEVRON_BAR).toBeLessThan(HEALTH_BAR_HEIGHT * 0.35);
    // Pips still nest: the stack step overlaps each chevron's height.
    const chevronHeight = (VETERAN_CHEVRON_LENGTH / 2 + VETERAN_CHEVRON_BAR) * Math.SQRT2;
    expect(VETERAN_CHEVRON_STACK).toBeLessThan(chevronHeight);
    expect(VETERAN_CHEVRON_STACK).toBeGreaterThan(chevronHeight / 3);
  });

  it("centers every rank's stack on the bar anchor", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 1);
    try {
      const bodies = makeBodies(1);
      const camera = makeCamera();
      for (const rank of [1, 2, 3]) {
        fx.update(makeSource([rank]), bodies, camera, 1 / 60);
        const holder = scene.getObjectByName("veteran-badge")!;
        expect(holder.position.x).toBe(bodies[0]!.position.x);
        expect(holder.position.z).toBe(bodies[0]!.position.z);
        // Visible pips balance about the anchor (rank 1 sits on it).
        const shown = holder.children.filter((c) => c.visible);
        expect(shown.length).toBe(rank);
        expect(shown[0]!.position.x).toBe(0);
        const mean = shown.reduce((sum, c) => sum + c.position.y, 0) / shown.length;
        expect(mean).toBeCloseTo(0, 12);
        // Each ∧ centers on its own origin with a meeting apex.
        for (const chevron of shown) {
          const left = chevron.children[0]!;
          const right = chevron.children[1]!;
          expect(left.position.y).toBe(0);
          expect(right.position.y).toBe(0);
          expect(left.position.x).toBeCloseTo(-right.position.x, 12);
          expect(Math.abs(left.position.x)).toBeCloseTo(
            (VETERAN_CHEVRON_LENGTH * Math.SQRT1_2) / 2,
            12,
          );
        }
      }
      // Even the ace stack clears the bar top.
      const halfStack =
        VETERAN_CHEVRON_STACK +
        (VETERAN_CHEVRON_LENGTH / 2 + VETERAN_CHEVRON_BAR) * Math.SQRT1_2;
      expect(VETERAN_BADGE_LIFT - halfStack).toBeGreaterThan(
        HEALTH_BAR_LIFT + HEALTH_BAR_HEIGHT / 2,
      );
    } finally {
      fx.dispose();
    }
  });

  it("centers the flourish pips on the promotion anchor", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 1);
    try {
      const bodies = makeBodies(1);
      fx.promote(0, 3, bodies[0]);
      const group = scene.getObjectByName("veteran-flourish") as THREE.Group;
      const ys = group.children.map((c) => c.position.y);
      expect(ys).toHaveLength(3);
      expect(ys[0]).toBeCloseTo(-VETERAN_CHEVRON_STACK, 12);
      expect(ys[1]).toBeCloseTo(0, 12);
      expect(ys[2]).toBeCloseTo(VETERAN_CHEVRON_STACK, 12);
    } finally {
      fx.dispose();
    }
  });
});

describe("promotion flourish", () => {
  it("spins slightly larger chevrons, then fades them out", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 1);
    try {
      const bodies = makeBodies(1);
      const camera = makeCamera();
      fx.promote(0, 2, bodies[0]);
      expect(fx.flourishCount).toBe(1);
      const group = scene.getObjectByName("veteran-flourish") as THREE.Group;
      expect(group.children.length).toBe(2);
      expect(group.scale.x).toBeCloseTo(VETERAN_FLOURISH_SCALE, 12);
      expect(VETERAN_FLOURISH_SCALE).toBeGreaterThan(1);
      // Mid-life: spun, risen, half-faded — and never billboarded.
      fx.update(makeSource([2]), bodies, camera, VETERAN_FLOURISH_DURATION / 2);
      expect(group.rotation.y).toBeCloseTo(
        VETERAN_FLOURISH_SPIN * (VETERAN_FLOURISH_DURATION / 2),
        10,
      );
      expect(group.position.y).toBeCloseTo(
        bodies[0]!.position.y + VETERAN_BADGE_LIFT + VETERAN_FLOURISH_RISE / 2,
        10,
      );
      expect(group.quaternion.equals(camera.quaternion)).toBe(false);
      const mat = group.children
        .flatMap((c) => c.children)
        .map((m) => (m as THREE.Mesh).material as THREE.MeshBasicMaterial);
      expect(mat.length).toBeGreaterThan(0);
      for (const m of mat) expect(m.opacity).toBeCloseTo(0.5, 10);
      // Past the beat the flourish is gone (badge stays lit).
      fx.update(makeSource([2]), bodies, camera, VETERAN_FLOURISH_DURATION);
      expect(fx.flourishCount).toBe(0);
      expect(scene.getObjectByName("veteran-flourish")).toBeUndefined();
      expect(fx.isShown(0)).toBe(true);
    } finally {
      fx.dispose();
    }
  });

  it("skips hidden toggles and missing bodies; transients clear on demand", () => {
    const scene = new THREE.Scene();
    const fx = new VeterancyFx(scene, 1);
    try {
      const bodies = makeBodies(1);
      fx.setVisible(false);
      fx.promote(0, 1, bodies[0]);
      expect(fx.flourishCount).toBe(0);
      fx.setVisible(true);
      fx.promote(0, 1, undefined);
      expect(fx.flourishCount).toBe(0);
      fx.promote(0, 1, bodies[0]);
      expect(fx.flourishCount).toBe(1);
      fx.clearTransients();
      expect(fx.flourishCount).toBe(0);
      expect(scene.getObjectByName("veteran-flourish")).toBeUndefined();
    } finally {
      fx.dispose();
    }
  });
});
