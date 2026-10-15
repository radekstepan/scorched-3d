import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildHq,
  doorLiftOf,
  getHqDoor,
  hqDoorBaseY,
  hqExitWorld,
  hqFacingFor,
  poseHqWreck,
  setDoorLift,
  HQ_BASE_W,
  HQ_DOOR_H,
  HQ_DOOR_TRAVEL,
  HQ_DOOR_W,
  HQ_EXIT_OFFSET,
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
