import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { UNIT_DEFS, type TNTMap } from "@scorched-3d/core";
import {
  applyUnitDamageTint,
  baseColorOf,
  CHAR_TARGET,
  charredColor,
  UnitDamageFx,
} from "./unitDamageFx";
import { buildUnits } from "./units";

function fakeMap(): TNTMap {
  const width = 32;
  const height = 32;
  return {
    width,
    height,
    heights: new Uint8Array(width * height).fill(100),
    units: [
      { kind: "stump", cellX: 8, cellZ: 8, rotation: 0 },
      { kind: "flash", cellX: 12, cellZ: 12, rotation: 1 },
    ],
  } as unknown as TNTMap;
}

function lambertHexes(body: THREE.Object3D): number[] {
  const out: number[] = [];
  body.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (mat && "emissive" in mat) out.push((mat.color as THREE.Color).getHex());
  });
  return out;
}

describe("charredColor", () => {
  it("returns the base color undamaged and the char target fully charred", () => {
    expect(charredColor(0x5a6b46, 0)).toBe(0x5a6b46);
    expect(charredColor(0x5a6b46, 1)).toBe(CHAR_TARGET);
  });

  it("darkens monotonically with damage, then pins at the char target", () => {
    const lum = (hex: number): number => {
      const c = new THREE.Color(hex);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    };
    let prev = lum(charredColor(0x8a8f7a, 0));
    for (const d of [0.1, 0.2, 0.4, 0.6]) {
      const next = lum(charredColor(0x8a8f7a, d));
      expect(next).toBeLessThan(prev);
      prev = next;
    }
    // Char saturates at UNIT_CHAR_SATURATE: 0.8 and 1.0 both pin to target.
    expect(charredColor(0x8a8f7a, 0.8)).toBe(CHAR_TARGET);
    expect(charredColor(0x8a8f7a, 1)).toBe(CHAR_TARGET);
  });
});

describe("applyUnitDamageTint", () => {
  it("is a no-op on plain groups and stashes base colors on first tint", () => {
    const bare = new THREE.Group();
    expect(() => applyUnitDamageTint(bare, 0.5)).not.toThrow();
    expect(baseColorOf(bare)).toBeNull();
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group;
    expect(baseColorOf(body)).toBeNull();
    applyUnitDamageTint(body, 0.5);
    expect(baseColorOf(body)).not.toBeNull();
  });

  it("darkens built hulls toward char without touching the stashed base", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group; // stump
    const before = lambertHexes(body);
    expect(before.length).toBeGreaterThan(0);
    applyUnitDamageTint(body, 0.5);
    const mid = lambertHexes(body);
    // Every hull mesh moved off its base color toward the char target.
    expect(mid).not.toEqual(before);
    for (const hex of mid) expect(hex).not.toBe(CHAR_TARGET);
    applyUnitDamageTint(body, 1);
    for (const hex of lambertHexes(body)) expect(hex).toBe(CHAR_TARGET);
    // Re-applying the same damage is stable (base stash, not double-lerp).
    const pinned = lambertHexes(body);
    applyUnitDamageTint(body, 1);
    expect(lambertHexes(body)).toEqual(pinned);
    // And the def colors still describe the pristine hulls elsewhere.
    expect(before).toContain(UNIT_DEFS.stump.color);
  });

  it("skips selection markers (Basic materials, noHighlight)", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group;
    const marker = new THREE.Group();
    marker.name = "select-marker";
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(14, 22, 24),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
    );
    ring.userData.noHighlight = true;
    marker.add(ring);
    body.add(marker);
    applyUnitDamageTint(body, 1);
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x22d3ee);
  });
});

describe("UnitDamageFx", () => {
  it("stays empty for pristine hulls, smokes when scorched, embers when gutted", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    fx.update([0, 0], units.children, 1.0);
    expect(fx.smokeCount).toBe(0);
    expect(fx.emberCount).toBe(0);
    // One scorched hull smokes; the pristine one stays clean.
    fx.update([0.35, 0], units.children, 2.0);
    expect(fx.smokeCount).toBe(1);
    expect(fx.emberCount).toBe(0);
    // A gutted hull adds dark smoke plus an ember flicker.
    fx.update([0.35, 0.8], units.children, 3.0);
    expect(fx.smokeCount).toBe(2);
    expect(fx.emberCount).toBe(1);
    fx.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("rebuilds every tick from state (no latching, deterministic phases)", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    const m = new THREE.Matrix4();
    fx.update([0.5, 0.9], units.children, 4.0);
    const first = new THREE.Matrix4();
    (fx as unknown as { smokeMesh: THREE.InstancedMesh }).smokeMesh.getMatrixAt(0, first);
    // Same elapsed, same state: identical instances (deterministic).
    fx.update([0.5, 0.9], units.children, 4.0);
    (fx as unknown as { smokeMesh: THREE.InstancedMesh }).smokeMesh.getMatrixAt(0, m);
    expect(m.equals(first)).toBe(true);
    // Healed (tests only — the sim never heals): smoke clears next tick.
    fx.update([0, 0], units.children, 5.0);
    expect(fx.smokeCount).toBe(0);
    expect(fx.emberCount).toBe(0);
    fx.dispose();
  });
});
