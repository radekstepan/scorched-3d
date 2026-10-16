import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HQ_SPAWN_ROSTER } from "@scorched-3d/core";
import { buildSpawnedUnit } from "./units";
import {
  buildHq,
  doorLiftOf,
  foundationDepthOf,
  getHqBeacon,
  getHqBeaconBulb,
  getHqBeaconGlow,
  getHqBeaconLight,
  getHqDoor,
  hqBeaconGlowAlpha,
  hqDoorBaseY,
  hqExitWorld,
  hqFacingFor,
  hqFoundationDropWorld,
  makeHqBeaconGlowTextureData,
  poseHqWreck,
  setDoorLift,
  setHqBeaconLevel,
  setHqFoundation,
  HQ_BASE_D,
  HQ_BASE_W,
  HQ_BEACON_COLOR,
  HQ_BEACON_DECAY,
  HQ_BEACON_DISTANCE,
  HQ_BEACON_GLOW_OPACITY,
  HQ_BEACON_GLOW_SIZE,
  HQ_BEACON_GLOW_TEX_SIZE,
  HQ_BEACON_PEAK,
  HQ_BEACON_RADIUS,
  HQ_BEACON_X,
  HQ_BEACON_Y,
  HQ_DOOR_H,
  HQ_DOOR_TRAVEL,
  HQ_DOOR_W,
  HQ_EXIT_OFFSET,
  HQ_FOUNDATION_DEPTH,
  HQ_FOUNDATION_MARGIN,
  HQ_HALL_LEN,
  HQ_SPAWN_OFFSET,
  HQ_WALL_H,
  hqSpawnWorld,
} from "./hq";

describe("buildHq", () => {
  it("builds a door-faced bunker with hall, trim, and team ring", () => {
    for (const team of [0, 1] as const) {
      const group = buildHq(team);
      expect(group.name).toBe("hq");
      expect(group.userData.hqTeam).toBe(team);
      const door = getHqDoor(group);
      expect(door, "sliding door must exist").not.toBeNull();
      // Door seated on the slab, centered in the front opening.
      expect(door!.position.y).toBeCloseTo(hqDoorBaseY(), 9);
      expect(Math.abs(door!.position.z)).toBeLessThan(HQ_DOOR_W / 2);
      // Door faces local +X (the canvas mirrors team 1 toward center).
      expect(door!.position.x).toBeGreaterThan(0);
      // Hall runs out of the mouth past the bunker face.
      expect(HQ_EXIT_OFFSET).toBeGreaterThan(HQ_BASE_W / 2);
      const exit = hqExitWorld({ x: 0, z: 0 }, hqFacingFor(team));
      expect(exit.x).toBe(team === 0 ? HQ_EXIT_OFFSET : -HQ_EXIT_OFFSET);
      // Team identity without hull tint: a scaled team ring + trim stripe.
      expect(group.getObjectByName("team-ring")).not.toBeNull();
    }
  });

  it("slides the door up and clamps the travel", () => {
    const group = buildHq(0);
    expect(doorLiftOf(group)).toBe(0);
    setDoorLift(group, 10);
    expect(doorLiftOf(group)).toBe(10);
    setDoorLift(group, 999);
    expect(doorLiftOf(group)).toBe(HQ_DOOR_TRAVEL);
    setDoorLift(group, -5);
    expect(doorLiftOf(group)).toBe(0);
    expect(HQ_DOOR_H).toBeLessThan(HQ_WALL_H);
  });

  it("reads as a factory: halls, stacks, silo, annex, framed door", () => {
    for (const team of [0, 1] as const) {
      const group = buildHq(team);
      // Twin chimney stacks with caps.
      const stacks = group.children.filter((c) => c.name === "hq-chimney");
      expect(stacks, "twin chimney stacks").toHaveLength(2);
      // Silo tank + workshop annex + monitor roof crown.
      expect(group.getObjectByName("hq-silo")).not.toBeNull();
      expect(group.getObjectByName("hq-annex")).not.toBeNull();
      expect(group.getObjectByName("hq-monitor")).not.toBeNull();
      // Factory massing: well beyond the old pillbox box count.
      const solids = group.children.filter((c) => c.type === "Mesh").length;
      expect(solids).toBeGreaterThan(18);
      // Every factory-built surface is a shared-style Lambert (the team
      // ring keeps its own marker material; the beacon halo is a billboard
      // sprite, not a factory surface) with the highlight guard.
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.type !== "Mesh") return;
        if (child.name !== "team-ring") {
          expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
        }
        expect(child.userData.noHighlight).toBe(true);
      });
    }
  });

  it("topples the stacks exactly once with the wreck", () => {
    const group = buildHq(0);
    const stacks = group.children.filter((c) => c.name === "hq-chimney") as THREE.Mesh[];
    expect(stacks.length).toBe(2);
    const seatY = stacks[0]!.position.y;
    poseHqWreck(group);
    expect(stacks[0]!.position.y).toBeLessThan(seatY);
    expect(stacks[0]!.rotation.z).toBeCloseTo(0.14, 6);
    const again = stacks[0]!.position.y;
    poseHqWreck(group);
    expect(stacks[0]!.position.y).toBe(again);
  });

  it("wrecks in place, idempotently", () => {
    const group = buildHq(1);
    const door = getHqDoor(group)!;
    const seatY = door.position.y;
    poseHqWreck(group);
    expect(group.userData.hqWrecked).toBe(true);
    // Charred toward near-black, door slammed crooked.
    let dark = 0;
    let total = 0;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (mesh.type === "Mesh" && mat) {
        total++;
        if ((mat.color.r + mat.color.g + mat.color.b) / 3 < 0.15) dark++;
      }
    });
    expect(total).toBeGreaterThan(0);
    expect(dark).toBe(total);
    expect(door.position.y).toBeLessThan(seatY);
    const again = door.position.y;
    poseHqWreck(group);
    expect(door.position.y).toBe(again);
  });
});

describe("hq warning beacon", () => {
  it("mounts a bare red hemisphere + diffused halo on the canopy top, over the door", () => {
    for (const team of [0, 1] as const) {
      const group = buildHq(team);
      const dome = getHqBeacon(group);
      expect(dome, "beacon dome must exist").not.toBeNull();
      // Canopy top, centered over the entrance (z = 0).
      expect(dome!.position.x).toBeCloseTo(HQ_BEACON_X, 9);
      expect(dome!.position.x).toBeGreaterThan(0);
      expect(dome!.position.y).toBeCloseTo(HQ_BEACON_Y, 9);
      expect(dome!.position.y).toBeCloseTo(4 + HQ_WALL_H + 3, 9);
      expect(dome!.position.z).toBe(0);
      // A half 3D circle: upper hemisphere, not a full ball.
      const geo = dome!.geometry as THREE.SphereGeometry;
      expect(geo.parameters.thetaLength).toBeCloseTo(Math.PI / 2, 6);
      expect(geo.parameters.radius).toBeCloseTo(HQ_BEACON_RADIUS, 9);
      expect(dome!.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      const mat = dome!.material as THREE.MeshLambertMaterial;
      expect(mat.emissive.getHex()).toBe(HQ_BEACON_COLOR);
      // Clear glass so the core reads through it — never an opaque red
      // disc pasted on top of the light.
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeLessThan(0.5);
      // The hot core + wash light sit on the dome's center axis, so the
      // light reads as emanating from the center.
      const bulb = getHqBeaconBulb(group);
      expect(bulb, "hot core must exist").not.toBeNull();
      expect(bulb!.parent).toBe(group);
      expect(Math.hypot(bulb!.position.x - HQ_BEACON_X, bulb!.position.z)).toBeCloseTo(0, 9);
      expect(bulb!.position.y).toBeCloseTo(HQ_BEACON_Y + 1, 9);
      expect((bulb!.material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(HQ_BEACON_COLOR);
      const light = getHqBeaconLight(group);
      expect(light, "beacon light must exist").not.toBeNull();
      expect(light!.isPointLight).toBe(true);
      expect(light!.parent).toBe(group);
      expect(light!.color.getHex()).toBe(HQ_BEACON_COLOR);
      expect(light!.distance).toBe(HQ_BEACON_DISTANCE);
      expect(Math.hypot(light!.position.x - HQ_BEACON_X, light!.position.z)).toBeCloseTo(0, 9);
      // Diffused halo: one additive billboard sprite centered on the hot
      // core, fading past the glass — a soft glow, not directional cones.
      const glow = getHqBeaconGlow(group);
      expect(glow, "halo sprite must exist").not.toBeNull();
      expect(glow!.parent).toBe(group);
      expect(glow!.position.x).toBeCloseTo(HQ_BEACON_X, 9);
      expect(glow!.position.y).toBeCloseTo(HQ_BEACON_Y + 1, 9);
      expect(glow!.position.z).toBe(0);
      expect(glow!.scale.x).toBeCloseTo(HQ_BEACON_GLOW_SIZE, 9);
      expect(glow!.scale.y).toBeCloseTo(HQ_BEACON_GLOW_SIZE, 9);
      const glowMat = glow!.material as THREE.SpriteMaterial;
      expect(glowMat).toBeInstanceOf(THREE.SpriteMaterial);
      expect(glowMat.color.getHex()).toBe(HQ_BEACON_COLOR);
      expect(glowMat.transparent).toBe(true);
      expect(glowMat.blending).toBe(THREE.AdditiveBlending);
      expect(glowMat.depthWrite).toBe(false);
      expect(glowMat.opacity).toBeCloseTo(HQ_BEACON_GLOW_OPACITY, 9);
      expect(glow!.visible).toBe(true);
      expect(glow!.userData.noHighlight).toBe(true);
      // The halo's procedural texture is a radial DataTexture (headless
      // safe), fading to transparent at the rim — no harsh border.
      const map = glowMat.map as THREE.DataTexture;
      expect(map).toBeInstanceOf(THREE.DataTexture);
      expect(map.image.width).toBe(HQ_BEACON_GLOW_TEX_SIZE);
      expect(map.image.height).toBe(HQ_BEACON_GLOW_TEX_SIZE);
      // The halo reaches well past the glass, so the glow reads around it.
      expect(HQ_BEACON_GLOW_SIZE / 2).toBeGreaterThan(HQ_BEACON_RADIUS * 2);
      // No cone geometry anywhere in the works, and no rotor or arc motes
      // remain — the lighthouse beams are gone.
      expect(group.getObjectByName("hq-beacon-rotor")).toBeUndefined();
      expect(group.getObjectByName("hq-beacon-beam-a")).toBeUndefined();
      expect(group.getObjectByName("hq-beacon-mote-a")).toBeUndefined();
      let cones = 0;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.type === "Mesh" && mesh.geometry instanceof THREE.ConeGeometry) cones++;
      });
      expect(cones).toBe(0);
      // Guarded like every other factory surface.
      expect(dome!.userData.noHighlight).toBe(true);
    }
  });

  it("carries no mast or platform around the beacon", () => {
    for (const team of [0, 1] as const) {
      const group = buildHq(team);
      // The old mast + collar were boxes stacked above the canopy over the
      // door — no box may remain in that column.
      const boxes = group.children.filter((c) => {
        if (c.type !== "Mesh") return false;
        if (!((c as THREE.Mesh).geometry instanceof THREE.BoxGeometry)) return false;
        const p = c.position;
        return Math.abs(p.x - HQ_BEACON_X) < 5 && p.y > HQ_BEACON_Y && Math.abs(p.z) < 5;
      });
      expect(boxes, "no mast/platform boxes above the beacon seat").toHaveLength(0);
    }
  });

  it("fades the halo texture smoothly from the core to a transparent rim", () => {
    // Hot at the center, exactly gone at the rim and beyond: no harsh
    // border where the sprite ends.
    expect(hqBeaconGlowAlpha(0, 0)).toBeCloseTo(1, 9);
    expect(hqBeaconGlowAlpha(1, 0)).toBe(0);
    expect(hqBeaconGlowAlpha(0, 1)).toBe(0);
    expect(hqBeaconGlowAlpha(1, 1)).toBe(0);
    expect(hqBeaconGlowAlpha(2, 0)).toBe(0);
    // Radially symmetric and monotonically fading outward, through a soft
    // midrange rather than a hard disc edge.
    expect(hqBeaconGlowAlpha(0.5, 0)).toBeCloseTo(hqBeaconGlowAlpha(0, 0.5), 9);
    expect(hqBeaconGlowAlpha(0.3, 0.4)).toBeCloseTo(hqBeaconGlowAlpha(0.5, 0), 9);
    let prev = Infinity;
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const a = hqBeaconGlowAlpha(r, 0);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
    expect(hqBeaconGlowAlpha(0.5, 0)).toBeGreaterThan(0.2);
    expect(hqBeaconGlowAlpha(0.5, 0)).toBeLessThan(1);
    // The texture builder samples the same curve: bright center texels,
    // transparent corners and rim, correct byte length.
    const size = 8;
    const data = makeHqBeaconGlowTextureData(size);
    expect(data.length).toBe(size * size * 4);
    const at = (ix: number, iz: number): number => data[(iz * size + ix) * 4 + 3]!;
    expect(at(0, 0)).toBe(0);
    expect(at(size - 1, size - 1)).toBe(0);
    expect(at(0, 3)).toBe(0);
    expect(at(3, 3)).toBeGreaterThan(200);
    expect(at(4, 4)).toBeGreaterThan(200);
    // RGB carries no tint (the sprite material tints the halo red).
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("holds the core + halo steady across drives (no breathing)", () => {
    const group = buildHq(0);
    const bulb = getHqBeaconBulb(group)!;
    const bulbMat = bulb.material as THREE.MeshLambertMaterial;
    const glow = getHqBeaconGlow(group)!;
    const glowMat = glow.material as THREE.SpriteMaterial;
    // Repeated full-level drives (one per tick): the core never swells,
    // brightens, bobs, or drifts, and the halo never changes opacity.
    const seatY = bulb.position.y;
    for (let n = 0; n < 5; n++) {
      setHqBeaconLevel(group, 1);
      expect(bulbMat.emissiveIntensity).toBeCloseTo(3.2, 9);
      expect(bulb.scale.x).toBe(1);
      expect(bulb.position.y).toBe(seatY);
      expect(glowMat.opacity).toBeCloseTo(HQ_BEACON_GLOW_OPACITY, 9);
      expect(glow.visible).toBe(true);
    }
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK, 9);
  });

  it("seats the core + halo from the level while the wash holds steady", () => {
    const group = buildHq(0);
    const bulb = getHqBeaconBulb(group)!;
    const bulbMat = bulb.material as THREE.MeshLambertMaterial;
    const glow = getHqBeaconGlow(group)!;
    const glowMat = glow.material as THREE.SpriteMaterial;
    // Full level: steady hot core, halo on, wash at peak.
    setHqBeaconLevel(group, 1);
    expect(bulbMat.emissiveIntensity).toBeCloseTo(3.2, 9);
    expect(bulb.scale.x).toBe(1);
    expect(glow.visible).toBe(true);
    expect(glowMat.opacity).toBeCloseTo(HQ_BEACON_GLOW_OPACITY, 9);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK, 9);
    // Half level halves the burn and the halo together.
    setHqBeaconLevel(group, 0.5);
    expect(bulbMat.emissiveIntensity).toBeCloseTo(1.6, 9);
    expect(glowMat.opacity).toBeCloseTo(HQ_BEACON_GLOW_OPACITY / 2, 9);
    expect(glow.visible).toBe(true);
    // Level 0 parks the whole stack dark and hides the halo.
    setHqBeaconLevel(group, 0);
    expect(bulbMat.emissiveIntensity).toBe(0);
    expect(glow.visible).toBe(false);
    expect(glowMat.opacity).toBe(0);
  });

  it("drives the lens + wash light from the level, clamped", () => {
    const group = buildHq(0);
    setHqBeaconLevel(group, 1);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK, 9);
    setHqBeaconLevel(group, 0);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
    const mat = getHqBeacon(group)!.material as THREE.MeshLambertMaterial;
    const darkEmissive = mat.emissiveIntensity;
    setHqBeaconLevel(group, 1);
    expect((getHqBeacon(group)!.material as THREE.MeshLambertMaterial).emissiveIntensity).toBeGreaterThan(
      darkEmissive,
    );
    // Clamped, never negative or over peak.
    setHqBeaconLevel(group, 99);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK, 9);
    setHqBeaconLevel(group, -99);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
  });

  it("scales the wash light to a caller peak (night boost), wrecks stay dark", () => {
    const group = buildHq(0);
    setHqBeaconLevel(group, 1, HQ_BEACON_PEAK * 1.6);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK * 1.6, 9);
    setHqBeaconLevel(group, 0.5, HQ_BEACON_PEAK * 1.6);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK * 0.8, 9);
    // Omitted peak keeps the legacy day behavior.
    setHqBeaconLevel(group, 1);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK, 9);
    // A boosted drive never re-lights a wreck.
    poseHqWreck(group);
    setHqBeaconLevel(group, 1, HQ_BEACON_PEAK * 1.6);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
  });

  it("washes a wide staging area around the works, not just the canopy", () => {
    const group = buildHq(0);
    const light = getHqBeaconLight(group)!;
    expect(light.distance).toBe(HQ_BEACON_DISTANCE);
    expect(light.decay).toBe(HQ_BEACON_DECAY);
    // Range covers the full hall plus a staging apron past the mouth, with
    // room to spare — the faded wash travels well past the works.
    const mouthDist = Math.abs(HQ_EXIT_OFFSET - HQ_BEACON_X);
    expect(HQ_BEACON_DISTANCE).toBeGreaterThan(mouthDist * 3);
    // Peak compensates physical falloff, so the wash still reads at range:
    // strong at the hall mouth, visible at the old 340 cutoff, faint but
    // non-dark at the new cutoff edge (a faded glow, not a hard disc).
    const at = (d: number): number => HQ_BEACON_PEAK / Math.pow(d, HQ_BEACON_DECAY);
    expect(at(mouthDist)).toBeGreaterThan(0.5);
    expect(at(340)).toBeGreaterThan(0.05);
    expect(at(HQ_BEACON_DISTANCE)).toBeGreaterThan(0.02);
  });

  it("kills the beacon with the wreck and never re-lights", () => {
    const group = buildHq(0);
    poseHqWreck(group);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
    const mat = getHqBeacon(group)!.material as THREE.MeshLambertMaterial;
    expect(mat.emissive.getHex()).toBe(0x000000);
    expect(mat.emissiveIntensity).toBe(0);
    const bulbMat = (group.getObjectByName("hq-beacon-bulb") as THREE.Mesh)!
      .material as THREE.MeshLambertMaterial;
    expect(bulbMat.emissive.getHex()).toBe(0x000000);
    const glow = getHqBeaconGlow(group)!;
    const glowMat = glow.material as THREE.SpriteMaterial;
    expect(glow.visible).toBe(false);
    expect(glowMat.opacity).toBe(0);
    // Even a full-flash drive stays dark once wrecked.
    setHqBeaconLevel(group, 1);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
    expect((getHqBeacon(group)!.material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(0x000000);
    expect(bulbMat.emissiveIntensity).toBe(0);
    expect(glow.visible).toBe(false);
    expect(glowMat.opacity).toBe(0);
  });
});

describe("hq foundations", () => {
  it("hangs concrete footings under the slab and hall", () => {
    const group = buildHq(0);
    const slab = group.getObjectByName("hq-foundation") as THREE.Mesh;
    const hall = group.getObjectByName("hq-hall-foundation") as THREE.Mesh;
    expect(slab, "slab footing").toBeDefined();
    expect(hall, "hall footing").toBeDefined();
    // Seated flush under the slab underside (local y=0), tops hidden.
    expect(slab.position.y).toBeCloseTo(-HQ_FOUNDATION_DEPTH / 2, 9);
    expect(foundationDepthOf(group)).toBeCloseTo(HQ_FOUNDATION_DEPTH, 9);
    // Inset inside the slab/hall outline so the footing reads as a base.
    const slabGeo = slab.geometry as THREE.BoxGeometry;
    expect(slabGeo.parameters.width).toBeLessThan(HQ_BASE_W);
    expect(slabGeo.parameters.depth).toBeLessThan(HQ_BASE_D);
    const hallGeo = hall.geometry as THREE.BoxGeometry;
    expect(hallGeo.parameters.width).toBeCloseTo(HQ_HALL_LEN, 9);
    // Tagged like every other factory surface (no highlight, chars dead).
    expect(slab.userData.noHighlight).toBe(true);
    expect(hall.userData.noHighlight).toBe(true);
  });

  it("sizes the footings to the measured drop", () => {
    const group = buildHq(1);
    setHqFoundation(group, 90);
    expect(foundationDepthOf(group)).toBeCloseTo(90, 9);
    const slab = group.getObjectByName("hq-foundation") as THREE.Mesh;
    const hall = group.getObjectByName("hq-hall-foundation") as THREE.Mesh;
    // Both bottoms reach the drop; tops stay pinned at the slab underside.
    expect(slab.position.y + ((slab.geometry as THREE.BoxGeometry).parameters.height * slab.scale.y) / 2).toBeCloseTo(0, 9);
    expect(hall.position.y + ((hall.geometry as THREE.BoxGeometry).parameters.height * hall.scale.y) / 2).toBeCloseTo(0, 9);
    expect(slab.position.y).toBeCloseTo(-45, 9);
    // Flat-ground re-seat never inverts the footing.
    setHqFoundation(group, 0);
    expect(foundationDepthOf(group)).toBe(0);
  });

  it("measures the drop to the lowest footprint corner plus margin", () => {
    // Flat: anchor height everywhere, just the burial margin.
    expect(hqFoundationDropWorld({ x: 0, y: 80, z: 0 }, 1, () => 80)).toBeCloseTo(
      HQ_FOUNDATION_MARGIN,
      9,
    );
    // Steady downhill toward the map center: the hall mouth is the low
    // corner, so the drop covers its fall plus the margin.
    const fall = (x: number): number => 80 - (x / HQ_HALL_LEN) * 30;
    const drop = hqFoundationDropWorld({ x: 0, y: 80, z: 0 }, 1, (x) => fall(x));
    expect(drop).toBeCloseTo(30 * (HQ_BASE_W / 2 + HQ_HALL_LEN) / HQ_HALL_LEN + HQ_FOUNDATION_MARGIN, 9);
    // Uphill everywhere: nothing to bridge, margin only.
    expect(hqFoundationDropWorld({ x: 0, y: 80, z: 0 }, 1, (x) => 80 + Math.abs(x) * 0.5)).toBeCloseTo(
      HQ_FOUNDATION_MARGIN,
      9,
    );
  });

  it("chars the footings with the wreck", () => {
    const group = buildHq(0);
    setHqFoundation(group, 60);
    poseHqWreck(group);
    for (const name of ["hq-foundation", "hq-hall-foundation"]) {
      const mesh = group.getObjectByName(name) as THREE.Mesh;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      expect((mat.color.r + mat.color.g + mat.color.b) / 3).toBeLessThan(0.15);
    }
    // The wreck keeps the deep seat — foundations survive posing.
    expect(foundationDepthOf(group)).toBeCloseTo(60, 9);
  });
});

describe("hq reinforcement exit", () => {
  it("spawns reinforcements just outside the door so they walk the hall out the mouth", () => {
    // Door-side hall start: outside the bunker face, well short of the
    // mouth — the release drives the hall's length on foot instead of
    // popping in at the mouth.
    expect(HQ_SPAWN_OFFSET).toBeGreaterThan(HQ_BASE_W / 2);
    expect(HQ_SPAWN_OFFSET).toBeLessThan(HQ_EXIT_OFFSET);
    for (const team of [0, 1] as const) {
      const spawn = hqSpawnWorld({ x: 100, z: -40 }, hqFacingFor(team));
      expect(spawn.x).toBe(team === 0 ? 100 + HQ_SPAWN_OFFSET : 100 - HQ_SPAWN_OFFSET);
      // Centerline of the hall, so the drive out is straight.
      expect(spawn.z).toBe(-40);
      // The mouth stays ahead of the spawn toward the map center.
      const mouth = hqExitWorld({ x: 100, z: -40 }, hqFacingFor(team));
      expect(team === 0 ? mouth.x - spawn.x : spawn.x - mouth.x).toBe(
        HQ_EXIT_OFFSET - HQ_SPAWN_OFFSET,
      );
    }
  });

  it("fits every spawnable hull through the door and clear of the front wall at spawn", () => {
    // The lifted door fully clears the opening, so tall tubes never graze it.
    expect(HQ_DOOR_TRAVEL).toBeGreaterThanOrEqual(HQ_DOOR_H);
    const openingTop = 4 + HQ_DOOR_H;
    for (const kind of HQ_SPAWN_ROSTER) {
      const body = buildSpawnedUnit(kind, 0, 0, 0, Math.PI / 2, () => 0);
      body.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      body.traverse((child) => {
        if (child.type !== "Mesh") return;
        if (child.name === "team-ring") return;
        tmp.setFromObject(child);
        box.union(tmp);
      });
      expect(box.max.y - body.position.y, `${kind} clears the door head`).toBeLessThan(openingTop);
      expect(Math.abs(box.min.z), `${kind} fits the opening width`).toBeLessThan(HQ_DOOR_W / 2);
      expect(Math.abs(box.max.z), `${kind} fits the opening width`).toBeLessThan(HQ_DOOR_W / 2);
      // Rear overhang stays outside the front wall face (hence clear of the
      // door slab) at the door-side spawn.
      expect(box.min.x, `${kind} rear clears the door`).toBeGreaterThan(
        HQ_BASE_W / 2 - HQ_SPAWN_OFFSET,
      );
    }
  });

  it("stands taller than the commander", () => {
    const cmd = buildSpawnedUnit("commander", 0, 0, 0, 0, () => 0);
    cmd.updateMatrixWorld(true);
    const cmdBox = new THREE.Box3();
    const tmp = new THREE.Box3();
    cmd.traverse((child) => {
      if (child.type !== "Mesh") return;
      if (child.name === "team-ring") return;
      tmp.setFromObject(child);
      cmdBox.union(tmp);
    });
    const works = buildHq(0);
    works.updateMatrixWorld(true);
    const worksBox = new THREE.Box3().setFromObject(works);
    // Overall: stacks + caps beat the antenna tip.
    expect(worksBox.max.y).toBeGreaterThan(cmdBox.max.y);
    // Massing, not just the stacks: the roofline clears the commander's
    // torso (antenna excluded — a thin whip, not the read).
    const torso = new THREE.Box3();
    cmd.getObjectByName("turret")!.traverse((child) => {
      if (child.type !== "Mesh") return;
      if ((child as THREE.Mesh).geometry instanceof THREE.CylinderGeometry) return;
      tmp.setFromObject(child);
      torso.union(tmp);
    });
    expect(4 + HQ_WALL_H + 5).toBeGreaterThan(torso.max.y - cmd.position.y);
  });
});
