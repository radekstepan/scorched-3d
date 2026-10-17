import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  HUSK_EMBER_END,
  HUSK_SMOKE_END,
  UNIT_DEFS,
  type TNTMap,
} from "@scorched-3d/core";
import {
  applyUnitDamageTint,
  applyWreckChar,
  baseColorOf,
  CHAR_MAX_MIX,
  CHAR_TARGET,
  charredColor,
  EMBER_DUTY,
  PUFF_DUTY_HEAVY,
  PUFF_DUTY_LIGHT,
  UNIT_EMBER_PERIOD,
  UNIT_PUFF_PERIOD,
  emberPhase,
  isEmberVisible,
  isPuffVisible,
  puffDuty,
  puffPhase,
  UnitDamageFx,
  wreckCharredColor,
} from "./unitDamageFx";
import { buildUnitIconBody, buildUnits } from "./units";
import { TEAM_HULL_PAINT } from "./teamPaint";

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

const lum = (hex: number): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/** Elapsed time where unit `index` shows its puff (scan forward, always one). */
function visibleAt(index: number, heavy: boolean): number {
  for (let t = 0; t < UNIT_PUFF_PERIOD * 2; t += 0.05) {
    if (isPuffVisible(index, t, heavy)) return t;
  }
  throw new Error("no visible puff found");
}

/** Elapsed time where unit `index` hides its puff (emission gap). */
function gapAt(index: number, heavy: boolean): number {
  for (let t = 0; t < UNIT_PUFF_PERIOD * 2; t += 0.05) {
    if (!isPuffVisible(index, t, heavy)) return t;
  }
  throw new Error("no puff gap found");
}

describe("charredColor", () => {
  it("returns the base color undamaged and a capped mix fully charred", () => {
    expect(charredColor(0x5a6b46, 0)).toBe(0x5a6b46);
    // Fully charred never reaches the raw target: the view caps the lerp.
    const full = charredColor(0x5a6b46, 1);
    expect(full).not.toBe(CHAR_TARGET);
    const expected = new THREE.Color(0x5a6b46).lerp(new THREE.Color(CHAR_TARGET), CHAR_MAX_MIX).getHex();
    expect(full).toBe(expected);
  });

  it("darkens monotonically with damage, then pins at the capped mix", () => {
    let prev = lum(charredColor(0x8a8f7a, 0));
    for (const d of [0.1, 0.2, 0.4, 0.6]) {
      const next = lum(charredColor(0x8a8f7a, d));
      expect(next).toBeLessThan(prev);
      prev = next;
    }
    // Char saturates at core UNIT_CHAR_SATURATE: 0.8 and 1.0 pin together.
    expect(charredColor(0x8a8f7a, 0.8)).toBe(charredColor(0x8a8f7a, 1));
  });

  it("never chars to near-black and keeps a warm readable hue", () => {
    expect(CHAR_MAX_MIX).toBeLessThanOrEqual(0.5);
    for (const base of [0x5a6b46, 0x8a8f7a, UNIT_DEFS.stump.color, 0xffffff]) {
      const hex = charredColor(base, 1);
      // Luminance floor: fully charred stays well above near-black.
      expect(lum(hex)).toBeGreaterThan(0.05);
      const c = new THREE.Color(hex);
      // Warm brown read: red channel leads blue.
      expect(c.r).toBeGreaterThan(c.b);
    }
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

  it("darkens built hulls softly without touching the stashed base", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group; // stump
    const before = lambertHexes(body);
    expect(before.length).toBeGreaterThan(0);
    applyUnitDamageTint(body, 0.5);
    const mid = lambertHexes(body);
    // Every hull mesh moved off its base color — but never to near-black.
    expect(mid).not.toEqual(before);
    for (const hex of mid) {
      expect(hex).not.toBe(CHAR_TARGET);
      expect(lum(hex)).toBeGreaterThan(0.03);
    }
    applyUnitDamageTint(body, 1);
    const pinned = lambertHexes(body);
    // Fully charred pins at the capped mix (stable, not double-lerped).
    applyUnitDamageTint(body, 1);
    expect(lambertHexes(body)).toEqual(pinned);
    for (const hex of pinned) expect(lum(hex)).toBeGreaterThan(0.03);
    // And the team livery describes the pristine battlefield hull (this
    // body is team-less in the fake map, so it defaults to side 0), while
    // the kind def colors still describe the neutral icon body.
    expect(before).toContain(TEAM_HULL_PAINT[0]);
    expect(lambertHexes(buildUnitIconBody("stump"))).toContain(UNIT_DEFS.stump.color);
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

describe("applyWreckChar", () => {
  it("pushes fully-charred hulls past the readable cap toward near-black", () => {
    for (const base of [UNIT_DEFS.stump.color, UNIT_DEFS.flash.color, UNIT_DEFS.commander.color]) {
      const live = charredColor(base, 1);
      const wreck = wreckCharredColor(base);
      expect(wreck).not.toBe(live);
      expect(lum(wreck)).toBeLessThan(lum(live));
      expect(lum(wreck)).toBeLessThan(0.03);
      // Pure: same base always gives the same wreck color.
      expect(wreckCharredColor(base)).toBe(wreck);
    }
  });

  it("chars a killed body past the live cap, stably and idempotently", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group; // stump
    applyUnitDamageTint(body, 1);
    const pinned = lambertHexes(body);
    for (const hex of pinned) expect(lum(hex)).toBeGreaterThan(0.03);
    applyWreckChar(body);
    expect(body.userData.wreckCharred).toBe(true);
    const wrecked = lambertHexes(body);
    expect(wrecked).not.toEqual(pinned);
    // Every hull mesh reads exactly its base-derived wreck color.
    const bases: number[] = [];
    body.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (mat && "emissive" in mat && typeof mesh.userData.baseColor === "number") {
        bases.push(mesh.userData.baseColor as number);
        expect((mat.color as THREE.Color).getHex()).toBe(
          wreckCharredColor(mesh.userData.baseColor as number),
        );
      }
    });
    expect(bases.length).toBeGreaterThan(0);
    // Re-applying (including after a post-death barrage re-tint) is stable.
    applyUnitDamageTint(body, 1);
    applyWreckChar(body);
    expect(lambertHexes(body)).toEqual(wrecked);
  });

  it("is a no-op on plain groups and skips noHighlight meshes", () => {
    const bare = new THREE.Group();
    expect(() => applyWreckChar(bare)).not.toThrow();
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    plate.userData.noHighlight = true;
    body.add(plate);
    applyWreckChar(body);
    expect((plate.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0xffffff);
    expect(typeof plate.userData.baseColor).toBe("undefined");
  });
});

describe("puff cadence", () => {
  it("phases stay in 0..1, desync neighbours, and repeat every period", () => {
    for (const t of [0, 0.7, 2.5, 10.2]) {
      const p = puffPhase(0, t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      expect(puffPhase(0, t + UNIT_PUFF_PERIOD)).toBeCloseTo(p, 10);
    }
    expect(puffPhase(0, 1.0)).not.toBeCloseTo(puffPhase(1, 1.0), 3);
    for (const t of [0, 0.4, 1.9]) {
      const p = emberPhase(2, t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      expect(emberPhase(2, t + UNIT_EMBER_PERIOD)).toBeCloseTo(p, 10);
    }
  });

  it("heavy hulls puff more often than light ones, both with gaps", () => {
    expect(puffDuty(false)).toBe(PUFF_DUTY_LIGHT);
    expect(puffDuty(true)).toBe(PUFF_DUTY_HEAVY);
    expect(PUFF_DUTY_HEAVY).toBeGreaterThan(PUFF_DUTY_LIGHT);
    for (const heavy of [false, true]) {
      let seen = 0;
      let gaps = 0;
      for (let t = 0; t < UNIT_PUFF_PERIOD; t += 0.05) {
        if (isPuffVisible(3, t, heavy)) seen++;
        else gaps++;
      }
      expect(seen).toBeGreaterThan(0);
      expect(gaps).toBeGreaterThan(0);
    }
    // Ember blinks have gaps too.
    let eSeen = 0;
    let eGaps = 0;
    for (let t = 0; t < UNIT_EMBER_PERIOD; t += 0.05) {
      if (isEmberVisible(1, t)) eSeen++;
      else eGaps++;
    }
    expect(eSeen).toBeGreaterThan(0);
    expect(eGaps).toBeGreaterThan(0);
    expect(EMBER_DUTY).toBeLessThan(1);
  });
});

describe("UnitDamageFx", () => {
  it("stays empty for pristine hulls, puffs when scorched, embers when gutted", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    fx.update([0, 0], units.children, 1.0);
    expect(fx.smokeCount).toBe(0);
    expect(fx.emberCount).toBe(0);
    // Scorched hull shows its puff inside its emission window.
    fx.update([0.35, 0], units.children, visibleAt(0, false));
    expect(fx.smokeCount).toBe(1);
    expect(fx.emberCount).toBe(0);
    // A gutted hull adds a puff plus an ember spark (pick times both show).
    let t = visibleAt(1, true);
    if (!isEmberVisible(1, t)) {
      for (let s = 0; s < UNIT_EMBER_PERIOD * 2; s += 0.05) {
        if (isPuffVisible(1, s, true) && isEmberVisible(1, s)) {
          t = s;
          break;
        }
      }
    }
    fx.update([0.35, 0.8], units.children, t);
    expect(fx.smokeCount).toBe(2);
    expect(fx.emberCount).toBe(1);
    fx.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("leaves emission gaps: smoking hulls hide between puffs", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    fx.update([0.5, 0], units.children, visibleAt(0, false));
    expect(fx.smokeCount).toBe(1);
    fx.update([0.5, 0], units.children, gapAt(0, false));
    expect(fx.smokeCount).toBe(0);
    fx.dispose();
  });

  it("keeps puffs small, soft, and never near-black", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    const internals = fx as unknown as {
      smokeMesh: THREE.InstancedMesh;
      emberMesh: THREE.InstancedMesh;
    };
    expect((internals.smokeMesh.geometry as THREE.SphereGeometry).parameters.radius).toBeLessThanOrEqual(6);
    expect((internals.smokeMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.25);
    expect((internals.emberMesh.geometry as THREE.SphereGeometry).parameters.radius).toBeLessThanOrEqual(2.5);
    expect((internals.emberMesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.75);
    // Sweep visible windows: instance scales stay small, smoke tones grey.
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    for (let t = 0; t < UNIT_PUFF_PERIOD; t += 0.1) {
      fx.update([0.9, 0.9], units.children, t);
      for (let s = 0; s < fx.smokeCount; s++) {
        internals.smokeMesh.getMatrixAt(s, m);
        m.decompose(pos, quat, scl);
        expect(scl.x).toBeLessThanOrEqual(0.75);
        internals.smokeMesh.getColorAt(s, col);
        expect((col.r + col.g + col.b) / 3).toBeGreaterThanOrEqual(0.35);
      }
      for (let e = 0; e < fx.emberCount; e++) {
        internals.emberMesh.getMatrixAt(e, m);
        m.decompose(pos, quat, scl);
        expect(scl.x).toBeLessThanOrEqual(0.65);
      }
    }
    fx.dispose();
  });

  it("rebuilds every tick from state (no latching, deterministic phases)", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    const t = visibleAt(0, true);
    const m = new THREE.Matrix4();
    fx.update([0.5, 0.9], units.children, t);
    const first = new THREE.Matrix4();
    (fx as unknown as { smokeMesh: THREE.InstancedMesh }).smokeMesh.getMatrixAt(0, first);
    // Same elapsed, same state: identical instances (deterministic).
    fx.update([0.5, 0.9], units.children, t);
    (fx as unknown as { smokeMesh: THREE.InstancedMesh }).smokeMesh.getMatrixAt(0, m);
    expect(m.equals(first)).toBe(true);
    // Healed (tests only — the sim never heals): smoke clears next tick.
    fx.update([0, 0], units.children, t + 1.0);
    expect(fx.smokeCount).toBe(0);
    expect(fx.emberCount).toBe(0);
    fx.dispose();
  });

  it("gutters husk smoke and embers through decay, live hulls puff on", () => {
    const scene = new THREE.Scene();
    const fx = new UnitDamageFx(scene);
    const units = buildUnits(fakeMap(), 1);
    // A tick where the gutted hull shows both its puff and its ember.
    let t = visibleAt(1, true);
    if (!isEmberVisible(1, t)) {
      for (let s = 0; s < UNIT_EMBER_PERIOD * 2; s += 0.05) {
        if (isPuffVisible(1, s, true) && isEmberVisible(1, s)) {
          t = s;
          break;
        }
      }
    }
    expect(isPuffVisible(1, t, true)).toBe(true);
    expect(isEmberVisible(1, t)).toBe(true);
    const mid = (HUSK_EMBER_END + HUSK_SMOKE_END) / 2; // embers out, smoke stays
    const late = (HUSK_SMOKE_END + 1) / 2; // both out
    // Fresh husk reads exactly like a live gutted hull.
    fx.update([0, 1], units.children, t, [0, 0]);
    expect(fx.smokeCount).toBe(1);
    expect(fx.emberCount).toBe(1);
    // Mid decay: the spark gutters out while wisps linger.
    fx.update([0, 1], units.children, t, [0, mid]);
    expect(fx.smokeCount).toBe(1);
    expect(fx.emberCount).toBe(0);
    // Late decay: even the smoke stops (the sunk husk burns out quietly).
    fx.update([0, 1], units.children, t, [0, late]);
    expect(fx.smokeCount).toBe(0);
    expect(fx.emberCount).toBe(0);
    // Omitted decay keeps the legacy read: battered hulls smoulder forever.
    fx.update([0, 1], units.children, t);
    expect(fx.smokeCount).toBe(1);
    expect(fx.emberCount).toBe(1);
    fx.dispose();
  });
});
