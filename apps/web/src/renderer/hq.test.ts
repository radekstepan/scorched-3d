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
  getHqBeaconHalo,
  getHqBeaconLight,
  getHqBeaconMotes,
  getHqBeaconRotor,
  getHqDoor,
  hqBeaconAngleAt,
  hqBeaconAngleOf,
  hqBeaconPulseAt,
  hqDoorBaseY,
  hqExitWorld,
  hqFacingFor,
  hqFoundationDropWorld,
  poseHqWreck,
  setDoorLift,
  setHqBeaconAngle,
  setHqBeaconLevel,
  setHqBeaconPulse,
  setHqFoundation,
  HQ_BASE_D,
  HQ_BASE_W,
  HQ_BEACON_BOB,
  HQ_BEACON_COLOR,
  HQ_BEACON_DECAY,
  HQ_BEACON_DISTANCE,
  HQ_BEACON_HALO_SCALE,
  HQ_BEACON_ORBIT,
  HQ_BEACON_PEAK,
  HQ_BEACON_PERIOD,
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
      // ring keeps its own marker material, and the beacon halo is an
      // additive Basic per the combat/fire glow convention — a light
      // effect, not a factory surface) with the highlight guard.
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.type !== "Mesh") return;
        if (child.name !== "team-ring" && child.name !== "hq-beacon-halo") {
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
  it("mounts a bare red hemisphere + internal rotor on the canopy top, over the door", () => {
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
      // Twin arc motes ride the rotor around the core: the visible sweep
      // inside the glass.
      const rotor = getHqBeaconRotor(group);
      expect(rotor, "beacon rotor must exist").not.toBeNull();
      expect(rotor!.position.equals(dome!.position)).toBe(true);
      const motes = getHqBeaconMotes(group);
      expect(motes, "twin arc motes").toHaveLength(2);
      for (const mote of motes) {
        expect(mote.parent).toBe(rotor);
        expect(Math.hypot(mote.position.x, mote.position.z)).toBeCloseTo(HQ_BEACON_ORBIT, 9);
      }
      expect(motes[0]!.position.x).toBeCloseTo(-motes[1]!.position.x, 9);
      // A faint additive halo shell breathes past the lens: light radiating
      // outward, following the combat/fire glow convention.
      const halo = getHqBeaconHalo(group);
      expect(halo, "beacon halo must exist").not.toBeNull();
      expect(halo!.position.equals(dome!.position)).toBe(true);
      const haloGeo = halo!.geometry as THREE.SphereGeometry;
      expect(haloGeo.parameters.radius).toBeCloseTo(HQ_BEACON_RADIUS * HQ_BEACON_HALO_SCALE, 9);
      const haloMat = halo!.material as THREE.MeshBasicMaterial;
      expect(haloMat.blending).toBe(THREE.AdditiveBlending);
      expect(haloMat.depthWrite).toBe(false);
      expect(haloMat.opacity).toBeLessThan(0.5);
      expect(halo!.visible).toBe(true);
      // Guarded like every other factory surface.
      expect(dome!.userData.noHighlight).toBe(true);
      expect(halo!.userData.noHighlight).toBe(true);
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

  it("sweeps one full turn per period (pure function of time)", () => {
    expect(hqBeaconAngleAt(0)).toBeCloseTo(0, 9);
    expect(hqBeaconAngleAt(HQ_BEACON_PERIOD * 0.25)).toBeCloseTo(Math.PI / 2, 9);
    expect(hqBeaconAngleAt(HQ_BEACON_PERIOD * 0.5)).toBeCloseTo(Math.PI, 9);
    expect(hqBeaconAngleAt(HQ_BEACON_PERIOD * 0.75)).toBeCloseTo(Math.PI * 1.5, 9);
    // Wraps every period.
    expect(hqBeaconAngleAt(HQ_BEACON_PERIOD)).toBeCloseTo(0, 9);
    expect(hqBeaconAngleAt(HQ_BEACON_PERIOD * 2.5)).toBeCloseTo(Math.PI, 9);
    // Degenerate input parks the rotor instead of spinning it somewhere.
    expect(hqBeaconAngleAt(-1)).toBe(0);
    expect(hqBeaconAngleAt(NaN)).toBe(0);
  });

  it("points the rotor at the driven angle", () => {
    const group = buildHq(0);
    expect(hqBeaconAngleOf(group)).toBeCloseTo(0, 9);
    setHqBeaconAngle(group, Math.PI);
    expect(hqBeaconAngleOf(group)).toBeCloseTo(Math.PI, 9);
    // An arc mote orbits with the rotor: a half turn mirrors its offset.
    const mote = getHqBeaconMotes(group)[0]!;
    const rotor = getHqBeaconRotor(group)!;
    const pivot = rotor.getWorldPosition(new THREE.Vector3());
    setHqBeaconAngle(group, 0);
    const parked = mote.getWorldPosition(new THREE.Vector3());
    setHqBeaconAngle(group, Math.PI);
    const flipped = mote.getWorldPosition(new THREE.Vector3());
    expect(flipped.x - pivot.x).toBeCloseTo(-(parked.x - pivot.x), 6);
    expect(flipped.z - pivot.z).toBeCloseTo(-(parked.z - pivot.z), 6);
  });

  it("breathes one smooth swell per period (pure function of time)", () => {
    // Seam parked dim, full at the half, smooth between.
    expect(hqBeaconPulseAt(0)).toBeCloseTo(0, 9);
    expect(hqBeaconPulseAt(HQ_BEACON_PERIOD * 0.5)).toBeCloseTo(1, 9);
    const quarter = hqBeaconPulseAt(HQ_BEACON_PERIOD * 0.25);
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(1);
    // Wraps every period.
    expect(hqBeaconPulseAt(HQ_BEACON_PERIOD)).toBeCloseTo(0, 9);
    expect(hqBeaconPulseAt(HQ_BEACON_PERIOD * 1.5)).toBeCloseTo(1, 9);
    // Degenerate input parks the core dim instead of flashing it somewhere.
    expect(hqBeaconPulseAt(-1)).toBe(0);
    expect(hqBeaconPulseAt(NaN)).toBe(0);
  });

  it("breathes the core + halo from the pulse while the wash holds steady", () => {
    const group = buildHq(0);
    setHqBeaconLevel(group, 1);
    const bulb = getHqBeaconBulb(group)!;
    const halo = getHqBeaconHalo(group)!;
    const bulbMat = bulb.material as THREE.MeshLambertMaterial;
    const haloMat = halo.material as THREE.MeshBasicMaterial;
    setHqBeaconPulse(group, 0);
    const dimEmissive = bulbMat.emissiveIntensity;
    const dimOpacity = haloMat.opacity;
    const dimScale = halo.scale.x;
    const dimY = bulb.position.y;
    setHqBeaconPulse(group, 1);
    // The core swells, brightens, and rises on the dome axis; the halo
    // swells and brightens past the lens — while the wash light never
    // breathes (no blink dark half).
    expect(bulbMat.emissiveIntensity).toBeGreaterThan(dimEmissive);
    expect(bulb.scale.x).toBeGreaterThan(1);
    expect(bulb.position.y - dimY).toBeCloseTo(HQ_BEACON_BOB, 9);
    expect(haloMat.opacity).toBeGreaterThan(dimOpacity);
    expect(halo.scale.x).toBeGreaterThan(dimScale);
    expect(halo.visible).toBe(true);
    expect(getHqBeaconLight(group)!.intensity).toBeCloseTo(HQ_BEACON_PEAK, 9);
    // Clamped, never negative or over the faint-halo ceiling.
    setHqBeaconPulse(group, 99);
    expect(haloMat.opacity).toBeLessThanOrEqual(0.5);
    setHqBeaconPulse(group, -99);
    expect(haloMat.opacity).toBeGreaterThanOrEqual(0);
    expect(bulb.scale.x).toBeCloseTo(1, 9);
    // Level 0 parks the whole stack dark and hides the halo.
    setHqBeaconLevel(group, 0);
    setHqBeaconPulse(group, 1);
    expect(haloMat.opacity).toBe(0);
    expect(halo.visible).toBe(false);
    expect(bulbMat.emissiveIntensity).toBe(0);
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
    // Range covers the full hall plus a staging apron past the mouth.
    const mouthDist = Math.abs(HQ_EXIT_OFFSET - HQ_BEACON_X);
    expect(HQ_BEACON_DISTANCE).toBeGreaterThan(mouthDist * 2);
    // Peak compensates physical falloff, so the wash still reads at range:
    // strong at the hall mouth, visible at the old 170 cutoff, non-dark at
    // the new cutoff edge (no wide-but-black falloff).
    const at = (d: number): number => HQ_BEACON_PEAK / Math.pow(d, HQ_BEACON_DECAY);
    expect(at(mouthDist)).toBeGreaterThan(0.5);
    expect(at(170)).toBeGreaterThan(0.25);
    expect(at(HQ_BEACON_DISTANCE)).toBeGreaterThan(0.05);
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
    const moteMat = (group.getObjectByName("hq-beacon-mote-a") as THREE.Mesh)!
      .material as THREE.MeshLambertMaterial;
    expect(moteMat.emissive.getHex()).toBe(0x000000);
    const halo = getHqBeaconHalo(group)!;
    expect(halo.visible).toBe(false);
    // Even a full-flash drive stays dark once wrecked.
    setHqBeaconLevel(group, 1);
    setHqBeaconPulse(group, 1);
    expect(getHqBeaconLight(group)!.intensity).toBe(0);
    expect((getHqBeacon(group)!.material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(0x000000);
    expect(bulbMat.emissiveIntensity).toBe(0);
    expect(halo.visible).toBe(false);
    expect((halo.material as THREE.MeshBasicMaterial).opacity).toBe(0);
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
