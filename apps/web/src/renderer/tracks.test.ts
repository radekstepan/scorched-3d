import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MAX_TRACKS,
  TRACK_LIFETIME,
  TRACK_PEAK_OPACITY,
  TRACK_SPACING,
  TrackTrails,
  isDriving,
  trackAlpha,
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
    // The peak stays subtle: well under the scorch layer, never opaque.
    expect(TRACK_PEAK_OPACITY).toBeLessThanOrEqual(0.3);
  });

  it("widens treads per kind (tanks wider, the walker scuffs)", () => {
    expect(trackWidthFor("stump")).toBeGreaterThan(trackWidthFor("flash"));
    expect(trackWidthFor("hammer")).toBeGreaterThan(trackWidthFor("flash"));
    expect(trackWidthFor("commander")).toBeLessThan(trackWidthFor("flash"));
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

  it("stays silent while stunned, held, or wrecked — and stamps while driving", () => {
    const scene = new THREE.Scene();
    const { units, routes } = makeGroup();
    const movement = new UnitMovement(units, routes, { groundY: () => 100 });
    const tracks = new TrackTrails(scene, { groundY: () => 100 });
    // Wreck hull 1 up front: a frozen hull stamps nothing, ever.
    movement.markDestroyed(1);
    // Stun hull 0 for the max beat (0.8 s): the drive holds, and any
    // separation jostle is gated by mover state, not displacement.
    movement.stunUnit(0, 0.16);
    for (let n = 0; n < 30; n++) step(movement, tracks);
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
});
