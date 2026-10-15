import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildHq,
  doorLiftOf,
  foundationDepthOf,
  getHqBeacon,
  getHqBeaconLight,
  getHqDoor,
  hqDoorBaseY,
  hqExitWorld,
  hqFacingFor,
  hqFoundationDropWorld,
  hqWarningBlinkAt,
  poseHqWreck,
  setDoorLift,
  setHqBeaconLevel,
  setHqFoundation,
  HQ_BASE_D,
  HQ_BASE_W,
  HQ_BEACON_COLOR,
  HQ_BEACON_DISTANCE,
  HQ_BEACON_PEAK,
  HQ_BEACON_PERIOD,
  HQ_BEACON_X,
  HQ_BEACON_Y,
  HQ_DOOR_H,
  HQ_DOOR_TRAVEL,
  HQ_DOOR_W,
  HQ_EXIT_OFFSET,
  HQ_FOUNDATION_DEPTH,
  HQ_FOUNDATION_MARGIN,
  HQ_HALL_LEN,
  HQ_WALL_H,
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
      // ring keeps its own marker material) with the highlight guard.
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
  it("mounts a red beacon dome + light on the top front, over the door", () => {
    for (const team of [0, 1] as const) {
      const group = buildHq(team);
      const dome = getHqBeacon(group);
      expect(dome, "beacon dome must exist").not.toBeNull();
      // Top front of the building, centered over the entrance (z = 0).
      expect(dome!.position.x).toBeCloseTo(HQ_BEACON_X, 9);
      expect(dome!.position.x).toBeGreaterThan(0);
      expect(dome!.position.y).toBeCloseTo(HQ_BEACON_Y, 9);
      expect(dome!.position.y).toBeGreaterThan(4 + HQ_WALL_H);
      expect(dome!.position.z).toBe(0);
      expect(dome!.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      const mat = dome!.material as THREE.MeshLambertMaterial;
      expect(mat.emissive.getHex()).toBe(HQ_BEACON_COLOR);
      const light = getHqBeaconLight(group);
      expect(light, "beacon light must exist").not.toBeNull();
      expect(light!.isPointLight).toBe(true);
      expect(light!.color.getHex()).toBe(HQ_BEACON_COLOR);
      expect(light!.distance).toBe(HQ_BEACON_DISTANCE);
      expect(light!.position.equals(dome!.position)).toBe(true);
      // Guarded like every other factory surface.
      expect(dome!.userData.noHighlight).toBe(true);
    }
  });

  it("blinks square on a fixed period (pure function of time)", () => {
    expect(hqWarningBlinkAt(0)).toBe(1);
    expect(hqWarningBlinkAt(HQ_BEACON_PERIOD * 0.25)).toBe(1);
    expect(hqWarningBlinkAt(HQ_BEACON_PERIOD * 0.5)).toBe(0);
    expect(hqWarningBlinkAt(HQ_BEACON_PERIOD * 0.75)).toBe(0);
    // Wraps every period.
    expect(hqWarningBlinkAt(HQ_BEACON_PERIOD)).toBe(1);
    expect(hqWarningBlinkAt(HQ_BEACON_PERIOD * 2.5)).toBe(0);
    // Degenerate input reads lit (start bright, never dark by accident).
    expect(hqWarningBlinkAt(-1)).toBe(1);
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

  it("kills the beacon with the wreck and never re-lights", () => {
    const group = buildHq(0);
    poseHqWreck(group);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
    const mat = getHqBeacon(group)!.material as THREE.MeshLambertMaterial;
    expect(mat.emissive.getHex()).toBe(0x000000);
    expect(mat.emissiveIntensity).toBe(0);
    // Even a full-flash drive stays dark once wrecked.
    setHqBeaconLevel(group, 1);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
    expect((getHqBeacon(group)!.material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(0x000000);
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
