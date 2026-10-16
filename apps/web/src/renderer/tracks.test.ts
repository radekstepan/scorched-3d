import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  COMMANDER_FOOTSTEP_LENGTH,
  FOOTSTEP_LENGTH,
  FOOTSTEP_OFFSET,
  MAX_TRACKS,
  TRACK_COLOR,
  TRACK_LIFT,
  TRACK_LENGTH,
  TRACK_LIFETIME,
  TRACK_PEAK_OPACITY,
  TRACK_SPACING,
  TrackTrails,
  isDriving,
  trackAlpha,
  trackLengthFor,
  trackOffsetFor,
  trackOffsetsFor,
  trackWidthFor,
  type TrackSource,
} from "./tracks";
import { UnitMovement } from "./movement";
import type { Mover, RoutePoint } from "@scorched-3d/core";

/** Two hulls on long straight patrol legs so both drive at speed. */
function makeGroup(): { units: THREE.Group; routes: RoutePoint[][] } {
  const units = new THREE.Group();
  units.userData.units = [
    { kind: "flash", cellX: 10, cellZ: 10, rotation: 0 },
    { kind: "stump", cellX: 40, cellZ: 40, rotation: 0 },
  ];
  const starts = [
    new THREE.Vector3(0, 100, 0),
    new THREE.Vector3(600, 120, 600),
  ];
  units.userData.units.forEach((u: { rotation: number }, i: number) => {
    const body = new THREE.Group();
    body.rotation.y = u.rotation;
    body.position.copy(starts[i]!);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    units.add(body);
  });
  const routes: RoutePoint[][] = [
    [
      { x: 0, z: 0 },
      { x: 0, z: 400 },
      { x: 400, z: 400 },
      { x: 400, z: 0 },
    ],
    [
      { x: 600, z: 600 },
      { x: 600, z: 200 },
      { x: 200, z: 200 },
      { x: 200, z: 600 },
    ],
  ];
  return { units, routes };
}

/** Drive both movements forward one step and poll the trails. */
function step(movement: UnitMovement, tracks: TrackTrails, dt = 1 / 60): void {
  movement.update(dt);
  tracks.update(movement, dt);
}

describe("track helpers", () => {
  it("fades linearly from the subtle peak to zero at the lifetime", () => {
    expect(trackAlpha(0)).toBeCloseTo(TRACK_PEAK_OPACITY, 12);
    expect(trackAlpha(TRACK_LIFETIME / 2)).toBeCloseTo(TRACK_PEAK_OPACITY / 2, 12);
    expect(trackAlpha(TRACK_LIFETIME)).toBe(0);
    expect(trackAlpha(TRACK_LIFETIME + 10)).toBe(0);
    // The peak is visible yet stays under the scorch layer (0.62 opacity,
    // lift 1.2, order 2): a blast scar always wins where they overlap.
    expect(TRACK_PEAK_OPACITY).toBeGreaterThan(0.3);
    expect(TRACK_PEAK_OPACITY).toBeLessThan(0.62);
    expect(TRACK_LIFT).toBeLessThan(1.2);
  });

  it("widens treads per kind (tanks wider, the walker scuffs)", () => {
    expect(trackWidthFor("stump")).toBeGreaterThan(trackWidthFor("flash"));
    expect(trackWidthFor("hammer")).toBeGreaterThan(trackWidthFor("flash"));
    expect(trackWidthFor("commander")).toBeLessThan(trackWidthFor("flash"));
  });

  it("seats tread outer edges flush with the hull flank footprint", async () => {
    const { HULL_FOOTPRINT } = await import("@scorched-3d/core");
    for (const kind of ["flash", "stump", "hammer"] as const) {
      const fp = HULL_FOOTPRINT[kind];
      // Outer edge = center offset + half tread width lands on the flank tap.
      expect(trackOffsetFor(kind) + trackWidthFor(kind) / 2).toBeCloseTo(fp.halfWid, 9);
      expect(trackOffsetFor(kind)).toBeGreaterThan(0);
    }
    expect(trackOffsetFor("commander")).toBe(0);
  });

  it("stamps a symmetric tread pair for tanks, alternating footsteps for the walker", () => {
    for (const kind of ["flash", "stump", "hammer"] as const) {
      const pair = trackOffsetsFor(kind, 0);
      expect(pair).toHaveLength(2);
      expect(pair[0]).toBeCloseTo(-pair[1]!, 9);
      expect(pair[0]).toBeCloseTo(-trackOffsetFor(kind), 9);
      // Stride-independent: tanks never alternate.
      expect(trackOffsetsFor(kind, 7)).toEqual(pair);
    }
    // Commander: one foot per stride, alternating left/right at leg spread.
    expect(trackOffsetsFor("commander", 0)).toEqual([-FOOTSTEP_OFFSET]);
    expect(trackOffsetsFor("commander", 1)).toEqual([FOOTSTEP_OFFSET]);
    expect(trackOffsetsFor("commander", 2)).toEqual([-FOOTSTEP_OFFSET]);
    // Treads link up along travel; footsteps leave gaps between dashes.
    for (const kind of ["flash", "stump", "hammer"] as const) {
      expect(trackLengthFor(kind)).toBeGreaterThan(TRACK_SPACING);
    }
    expect(trackLengthFor("commander")).toBe(COMMANDER_FOOTSTEP_LENGTH);
    expect(trackLengthFor("commander")).toBeLessThan(TRACK_SPACING);
    // Infantry keeps the short scout scuff, gapped like the commander.
    expect(trackLengthFor("peewee")).toBe(FOOTSTEP_LENGTH);
    expect(trackLengthFor("peewee")).toBeLessThan(TRACK_SPACING);
  });

  it("gates emission on real driving only", () => {
    const driving: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    expect(isDriving(driving, false)).toBe(true);
    expect(isDriving({ ...driving, stun: 0.3 }, false)).toBe(false);
    expect(isDriving({ ...driving, hold: true }, false)).toBe(false);
    expect(isDriving(driving, true)).toBe(false);
    expect(isDriving(null, false)).toBe(false);
  });
});

describe("TrackTrails", () => {
  it("emits marks behind driving hulls, seated on the ground", () => {
    const scene = new THREE.Scene();
    const { units, routes } = makeGroup();
    const movement = new UnitMovement(units, routes, { groundY: () => 100 });
    const tracks = new TrackTrails(scene, { groundY: () => 100 });
    expect(tracks.count).toBe(0);
    for (let n = 0; n < 600; n++) step(movement, tracks);
    // Both hulls drove hundreds of units: several spacing-interval marks.
    expect(tracks.count).toBeGreaterThan(2);
    // The pool only grows to the cap; expired marks retire in place.
    expect(tracks.poolSize).toBeGreaterThanOrEqual(tracks.count);
    expect(tracks.poolSize).toBeLessThanOrEqual(MAX_TRACKS);
    // Marks sit just above the surface (slot 0 is the oldest and may have
    // expired over the 10 s drive — assert on a live one).
    let live: { x: number; y: number; z: number; live: boolean } | null = null;
    for (let s = 0; s < tracks.poolSize && !live?.live; s++) {
      const slot = tracks.slotAt(s);
      if (slot?.live) live = slot;
    }
    expect(live?.live).toBe(true);
    expect(live!.y).toBeCloseTo(100.8, 5);
    // Movers never see the marks: simulation state is untouched.
    const before = movement.moverState(0)!;
    tracks.update(movement, 1 / 60);
    expect(movement.moverState(0)).toEqual(before);
    movement.dispose();
    tracks.dispose();
  });

  it("stamps a tread pair per tank stride and alternating footsteps for the walker", () => {
    const scene = new THREE.Scene();
    // Single tank driving straight: each stride drops exactly 2 marks, one
    // per flank, symmetric about the hull centerline.
    const tank: TrackSource = {
      unitCount: 1,
      kindAt: () => "stump",
      isDestroyed: () => false,
      moverState: null as unknown as TrackSource["moverState"],
    };
    let tx = 0;
    tank.moverState = () => ({ x: (tx += TRACK_SPACING + 1), z: 0, hull: 0, leg: 1 });
    const tankTracks = new TrackTrails(scene, { groundY: () => 100 });
    tankTracks.update(tank, 1 / 60); // first sighting anchors
    tankTracks.update(tank, 1 / 60); // one stride -> one tread pair
    expect(tankTracks.count).toBe(2);
    const left = tankTracks.slotAt(0)!;
    const right = tankTracks.slotAt(1)!;
    expect(left.live).toBe(true);
    expect(right.live).toBe(true);
    // Hull faces +Z at yaw 0, so the pair splits across X, centered on tx.
    expect(left.x + right.x).toBeCloseTo(2 * tx, 6);
    expect(Math.abs(left.x - right.x)).toBeCloseTo(2 * trackOffsetFor("stump"), 6);
    expect(left.z).toBeCloseTo(right.z, 6);
    const meshes = scene.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      expect(mesh.scale.x).toBeCloseTo(trackWidthFor("stump"), 9);
      expect(mesh.scale.z).toBeCloseTo(trackLengthFor("stump"), 9);
    }
    tankTracks.dispose();

    // Walker: one footstep per stride, alternating sides with gaps.
    const scene2 = new THREE.Scene();
    const walker: TrackSource = {
      unitCount: 1,
      kindAt: () => "commander",
      isDestroyed: () => false,
      moverState: null as unknown as TrackSource["moverState"],
    };
    let wx = 0;
    walker.moverState = () => ({ x: (wx += TRACK_SPACING + 1), z: 0, hull: 0, leg: 1 });
    const walkTracks = new TrackTrails(scene2, { groundY: () => 100 });
    walkTracks.update(walker, 1 / 60);
    walkTracks.update(walker, 1 / 60);
    expect(walkTracks.count).toBe(1);
    const first = walkTracks.slotAt(0)!;
    walkTracks.update(walker, 1 / 60);
    expect(walkTracks.count).toBe(2);
    const second = walkTracks.slotAt(1)!;
    // Alternation: footsteps land on opposite sides of the centerline.
    expect(first.x - wx + (TRACK_SPACING + 1)).toBeCloseTo(-FOOTSTEP_OFFSET, 6);
    expect(second.x - wx).toBeCloseTo(FOOTSTEP_OFFSET, 6);
    const steps = scene2.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
    for (const mesh of steps) {
      expect(mesh.scale.x).toBeCloseTo(trackWidthFor("commander"), 9);
      expect(mesh.scale.z).toBe(COMMANDER_FOOTSTEP_LENGTH);
    }
    walkTracks.dispose();
  });

  it("stays silent while stunned, held, or wrecked — and stamps while driving", () => {
    const scene = new THREE.Scene();
    const { units, routes } = makeGroup();
    const movement = new UnitMovement(units, routes, { groundY: () => 100 });
    const tracks = new TrackTrails(scene, { groundY: () => 100 });
    // Wreck hull 1 up front: a frozen hull stamps nothing, ever.
    movement.markDestroyed(1);
    // Stun hull 0 for the max beat (0.45 s): the drive holds, and any
    // separation jostle is gated by mover state, not displacement.
    movement.stunUnit(0, 0.16);
    for (let n = 0; n < 13; n++) step(movement, tracks);
    expect(movement.moverState(0)!.stun).toBeGreaterThan(0);
    expect(tracks.count).toBe(0);
    // The stun expires and the hull resumes its patrol: the trail starts.
    for (let n = 0; n < 600; n++) step(movement, tracks);
    expect(movement.moverState(0)!.stun).toBeUndefined();
    expect(tracks.count).toBeGreaterThan(0);
    // Park it with a zero-length order (hold): silence again, fading out.
    const m0 = movement.moverState(0)!;
    movement.orderUnit(0, { x: m0.x, z: m0.z });
    for (let n = 0; n < Math.ceil(TRACK_LIFETIME * 60) + 60; n++) step(movement, tracks);
    expect(tracks.count).toBe(0);
    movement.dispose();
    tracks.dispose();
  });

  it("expires marks after the lifetime and recycles the oldest past the cap", () => {
    const scene = new THREE.Scene();
    const { units, routes } = makeGroup();
    const movement = new UnitMovement(units, routes, { groundY: () => 100 });
    const tracks = new TrackTrails(scene, { groundY: () => 100 });
    for (let n = 0; n < 600; n++) step(movement, tracks);
    expect(tracks.count).toBeGreaterThan(0);
    // Freeze both hulls as wrecks: no new stamps, the trail fades out.
    movement.markDestroyed(0);
    movement.markDestroyed(1);
    for (let n = 0; n < Math.ceil(TRACK_LIFETIME * 60) + 60; n++) step(movement, tracks);
    expect(tracks.count).toBe(0);
    expect(scene.children.filter((c) => c.visible).length).toBe(0);
    // Cap: a fake source driving absurd distances recycles instead of
    // growing — the pool never exceeds MAX_TRACKS.
    const far: TrackSource = {
      unitCount: 1,
      kindAt: () => "flash",
      isDestroyed: () => false,
      moverState: null as unknown as TrackSource["moverState"],
    };
    let fx = 0;
    far.moverState = () => ({ x: (fx += TRACK_SPACING + 1), z: 0, hull: 0, leg: 1 });
    for (let n = 0; n < MAX_TRACKS + 40; n++) tracks.update(far, 1 / 60);
    expect(tracks.poolSize).toBe(MAX_TRACKS);
    expect(tracks.count).toBe(MAX_TRACKS);
    movement.dispose();
    tracks.dispose();
  });

  it("re-seats live marks on resnap and clears everything on dispose", () => {
    const scene = new THREE.Scene();
    const { units, routes } = makeGroup();
    const movement = new UnitMovement(units, routes, { groundY: () => 100 });
    let height = 100;
    const tracks = new TrackTrails(scene, { groundY: () => height });
    for (let n = 0; n < 300; n++) step(movement, tracks);
    expect(tracks.count).toBeGreaterThan(0);
    const seated = tracks.slotAt(0)!;
    expect(seated.y).toBeCloseTo(100.8, 5);
    // Exaggeration change: X/Z stay, heights follow the surface.
    height = 200;
    tracks.resnap();
    const snapped = tracks.slotAt(0)!;
    expect(snapped.x).toBeCloseTo(seated.x, 9);
    expect(snapped.z).toBeCloseTo(seated.z, 9);
    expect(snapped.y).toBeCloseTo(200.8, 5);
    // Dispose drops every pooled mesh from the scene and stops updates.
    const pooled = tracks.poolSize;
    expect(pooled).toBeGreaterThan(0);
    tracks.dispose();
    expect(tracks.count).toBe(0);
    expect(tracks.poolSize).toBe(0);
    expect(scene.children.length).toBe(0);
    tracks.update(movement, 1 / 60);
    expect(tracks.count).toBe(0);
    movement.dispose();
  });

  it("renders wider, longer-lived marks under the scorch layer", () => {
    // Vehicle visibility tune pinned: 16 s ribbons, overlapping tank treads
    // (all footsteps stay gapped), all still below scorch in every dimension.
    // Globals are untouched by the vehicle bump (a shared peak/lifetime lift
    // would brighten infantry too); only vehicle widths/lengths move.
    expect(TRACK_LIFETIME).toBe(16);
    expect(TRACK_PEAK_OPACITY).toBe(0.55);
    expect(TRACK_PEAK_OPACITY).toBeLessThan(0.62);
    expect(TRACK_LENGTH).toBe(28);
    expect(TRACK_LENGTH).toBeGreaterThan(TRACK_SPACING);
    expect(COMMANDER_FOOTSTEP_LENGTH).toBe(14);
    expect(COMMANDER_FOOTSTEP_LENGTH).toBeLessThan(TRACK_SPACING);
    expect(FOOTSTEP_LENGTH).toBe(13);
    expect(FOOTSTEP_LENGTH).toBeLessThan(TRACK_SPACING);
    expect(trackWidthFor("flash")).toBe(6);
    expect(trackWidthFor("stump")).toBe(7);
    expect(trackWidthFor("hammer")).toBe(6.5);
    expect(trackWidthFor("commander")).toBe(5);
    // Infantry scuff is pinned exactly: the vehicle bump leaves it alone.
    expect(trackWidthFor("peewee")).toBe(3.5);
    const scene = new THREE.Scene();
    const far: TrackSource = {
      unitCount: 1,
      kindAt: () => "stump",
      isDestroyed: () => false,
      moverState: null as unknown as TrackSource["moverState"],
    };
    let fx = 0;
    far.moverState = () => ({ x: (fx += TRACK_SPACING + 1), z: 0, hull: 0, leg: 1 });
    const tracks = new TrackTrails(scene, { groundY: () => 100 });
    tracks.update(far, 1 / 60);
    tracks.update(far, 1 / 60);
    expect(tracks.count).toBeGreaterThan(0);
    const meshes = scene.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      // Below scorch (order 2) in draw order; lift pin lives in the fade test.
      expect(mesh.renderOrder).toBe(1);
    }
    const mark = meshes[0]!;
    expect(mark.scale.x).toBeCloseTo(trackWidthFor("stump"), 9);
    expect(mark.scale.z).toBeCloseTo(TRACK_LENGTH, 9);
    expect((mark.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(
      TRACK_PEAK_OPACITY,
    );
    // Compressed dust, never scorch: the mark material carries the cool
    // dark-grey track color at the fresh peak on emission.
    expect((mark.material as THREE.MeshBasicMaterial).color.getHex()).toBe(TRACK_COLOR);
    tracks.dispose();
  });

  it("bumps vehicle marks only — every vehicle quad beats the scout scuff", () => {
    // Vehicle-only increment over the task-79 tune (+0.5 u per vehicle
    // width, +2 u tank length, +1 u commander step); infantry is bit-identical.
    expect(trackWidthFor("flash")).toBeGreaterThan(5.5);
    expect(trackWidthFor("stump")).toBeGreaterThan(6.5);
    expect(trackWidthFor("hammer")).toBeGreaterThan(6);
    expect(trackWidthFor("commander")).toBeGreaterThan(4.5);
    expect(TRACK_LENGTH).toBeGreaterThan(26);
    expect(COMMANDER_FOOTSTEP_LENGTH).toBeGreaterThan(FOOTSTEP_LENGTH);
    // Quad area per single mark: every vehicle print covers more ground than
    // one peewee scuff, so armor lanes read heavier than scout dashes.
    const scoutArea = trackWidthFor("peewee") * trackLengthFor("peewee");
    for (const kind of ["flash", "stump", "hammer", "commander"] as const) {
      expect(trackWidthFor(kind) * trackLengthFor(kind)).toBeGreaterThan(scoutArea);
    }
    // The scout stays the narrowest mark on the field.
    for (const kind of ["flash", "stump", "hammer", "commander"] as const) {
      expect(trackWidthFor("peewee")).toBeLessThan(trackWidthFor(kind));
    }
  });
});
