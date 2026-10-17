import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import { worldHeight } from "@scorched-3d/core";
import {
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  clampCameraAboveSurface,
  clampCameraToWorld,
  clampCameraToWorldWithTarget,
  clampPanTargetWithCamera,
  clampTargetAboveSurface,
  isRigidPan,
} from "./cameraPan";
import {
  RTS_ELEVATION,
  RTS_VIEW_OFFSET,
  START_BEYOND_EDGE,
  commanderCameraPose,
  pickStartUnit,
  resnapHeightDelta,
  startGroundY,
  type StartField,
} from "./cameraStart";

function field(over: Partial<StartField> = {}): StartField {
  const width = 160;
  const height = 128;
  const heights = new Uint8Array(width * height).fill(100);
  return {
    width,
    height,
    heights,
    seaLevel: 75,
    units: [],
    ...over,
  };
}

const CELL = 16;
const HD = ((128 - 1) / 2) * CELL;

describe("pickStartUnit", () => {
  it("prefers the first commander over earlier other kinds", () => {
    const units = [
      { kind: "flash", cellX: 10, cellZ: 10 },
      { kind: "commander", cellX: 20, cellZ: 20 },
      { kind: "commander", cellX: 30, cellZ: 30 },
    ];
    expect(pickStartUnit(units)).toEqual(units[1]);
  });

  it("falls back to the first unit when no commander exists", () => {
    const units = [
      { kind: "stump", cellX: 10, cellZ: 10 },
      { kind: "hammer", cellX: 20, cellZ: 20 },
    ];
    expect(pickStartUnit(units)).toEqual(units[0]);
  });

  it("returns null for an empty roster", () => {
    expect(pickStartUnit([])).toBeNull();
  });
});

describe("commanderCameraPose", () => {
  const commander = { kind: "commander", cellX: 120, cellZ: 90 };

  it("targets the commander ground anchor", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    expect(pose.target.x).toBeCloseTo((120 - (160 - 1) / 2) * CELL, 10);
    expect(pose.target.z).toBeCloseTo((90 - (128 - 1) / 2) * CELL, 10);
    expect(pose.target.y).toBeCloseTo(worldHeight(100, 1), 10);
  });

  it("places the camera outside the map, due south of the commander", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    // Outside the rectangle: past the south edge (task 139 replaced the
    // center-through-commander ray — whose yaw varied with the spawn side
    // and misaligned the view with the minimap — with a fixed south yaw).
    expect(pose.position.x).toBeCloseTo(pose.target.x, 10);
    expect(pose.position.z).toBeCloseTo(HD + START_BEYOND_EDGE, 10);
    // South of the commander, which sits inside the map.
    expect(pose.position.z).toBeGreaterThan(pose.target.z);
    expect(Math.abs(pose.target.z)).toBeLessThanOrEqual(HD);
  });

  it("looks inward: due-north view from outside the south edge", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    // View direction has no east/west component and points north (−Z).
    expect(pose.target.x - pose.position.x).toBeCloseTo(0, 10);
    expect(pose.target.z - pose.position.z).toBeLessThan(0);
    // The whole map interior lies ahead of the camera.
    expect(pose.position.z).toBeGreaterThan(HD);
  });

  it("lifts the camera above the anchor", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
  });

  it("falls back to any unit when no commander is placed", () => {
    const stump = { kind: "stump", cellX: 40, cellZ: 30 };
    const f = field({ units: [stump] });
    const pose = commanderCameraPose(f, 1);
    expect(pose.target.x).toBeCloseTo((40 - (160 - 1) / 2) * CELL, 10);
    expect(pose.target.z).toBeCloseTo((30 - (128 - 1) / 2) * CELL, 10);
  });

  it("falls back to the map center viewed from the south with no units", () => {
    const f = field({ units: [] });
    const pose = commanderCameraPose(f, 2);
    expect(pose.target).toEqual({ x: 0, y: worldHeight(75, 2), z: 0 });
    expect(pose.position.x).toBeCloseTo(0, 10);
    expect(pose.position.z).toBeCloseTo(HD + START_BEYOND_EDGE, 10);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
  });

  it("handles a commander dead center via the south default", () => {
    // Even cell-symmetric grids rarely hit exact center; force it.
    const tiny: StartField = {
      width: 5,
      height: 5,
      heights: new Uint8Array(25).fill(100),
      seaLevel: 0,
      units: [{ kind: "commander", cellX: 2, cellZ: 2 }],
    };
    const pose = commanderCameraPose(tiny, 1);
    expect(pose.target.x).toBeCloseTo(0, 10);
    expect(pose.target.z).toBeCloseTo(0, 10);
    expect(pose.position.x).toBeCloseTo(0, 10);
    expect(pose.position.z).toBeGreaterThan((5 - 1) / 2 * CELL);
  });

  it("scales anchor height with exaggeration", () => {
    const f = field({ units: [commander] });
    const lo = commanderCameraPose(f, 1);
    const hi = commanderCameraPose(f, 2);
    expect(hi.target.y).toBeCloseTo(lo.target.y * 2, 10);
    expect(hi.target.x).toEqual(lo.target.x);
    expect(hi.target.z).toEqual(lo.target.z);
    expect(hi.position.x).toEqual(lo.position.x);
    expect(hi.position.z).toEqual(lo.position.z);
  });

  it("is deterministic per field", () => {
    const f = field({ units: [commander] });
    expect(commanderCameraPose(f, 1)).toEqual(commanderCameraPose(f, 1));
  });
});

describe("start view matches the minimap (task 139)", () => {
  // Minimap mapping: u left→right is world −X→+X, v top→bottom is world
  // −Z→+Z (minimap.ts). The opening frame must share that orientation:
  // screen-right is world +X and away-from-viewer is world −Z, so moving
  // right on the minimap pans the main view right. That means the camera
  // always starts due south of its target, wherever the commander spawned.
  /** Screen-right unit vector of a lookAt-style pose (camera up is +Y). */
  function screenRightOf(pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) {
    const fx = pose.target.x - pose.position.x;
    const fz = pose.target.z - pose.position.z;
    // right = normalize(forward × up) with up = (0,1,0): (-fz, 0, fx).
    const cx = -fz;
    const cz = fx;
    const len = Math.hypot(cx, cz);
    return { x: cx / len, y: 0, z: cz / len };
  }

  const spots = {
    north: { kind: "commander", cellX: 80, cellZ: 10 },
    south: { kind: "commander", cellX: 80, cellZ: 117 },
    east: { kind: "commander", cellX: 150, cellZ: 64 },
    west: { kind: "commander", cellX: 9, cellZ: 64 },
    corner: { kind: "commander", cellX: 150, cellZ: 10 },
  } as const;

  for (const [name, commander] of Object.entries(spots)) {
    it(`starts due south of a ${name}-spawned commander, outside the map`, () => {
      const f = field({ units: [{ ...commander }] });
      const pose = commanderCameraPose(f, 1);
      // Target stays on the commander ground anchor.
      expect(pose.target.x).toBeCloseTo((commander.cellX - (160 - 1) / 2) * CELL, 10);
      expect(pose.target.z).toBeCloseTo((commander.cellZ - (128 - 1) / 2) * CELL, 10);
      // Camera due south of the target: same X, past the south map edge.
      expect(pose.position.x).toBeCloseTo(pose.target.x, 10);
      expect(pose.position.z).toBeCloseTo(HD + START_BEYOND_EDGE, 10);
      expect(pose.position.y).toBeGreaterThan(pose.target.y);
    });

    it(`screen-right is world +X (minimap right) for a ${name} spawn`, () => {
      const f = field({ units: [{ ...commander }] });
      const pose = commanderCameraPose(f, 1);
      const right = screenRightOf(pose);
      expect(right.x).toBeCloseTo(1, 9);
      expect(right.y).toBeCloseTo(0, 9);
      expect(right.z).toBeCloseTo(0, 9);
    });
  }
});

describe("RTS opening elevation (sibling redesign-stumpy-tank-model)", () => {
  // Source: POSES.rts in the sibling viewer's src/viewer.ts — the
  // "Battlefield scale / GAMEPLAY READABILITY" study:
  //   rts: { position: [116, 165, 146], target: [0, 0, 0] }
  // Only the elevation transfers (the viewer's southeast yaw is a
  // single-model 3/4 framing; the game keeps its due-south minimap yaw).
  /** Elevation above the horizon of a pose (radians). */
  function elevationOf(pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) {
    return Math.atan2(
      pose.position.y - pose.target.y,
      Math.hypot(pose.position.x - pose.target.x, pose.position.z - pose.target.z),
    );
  }

  it("quotes the sibling RTS offset verbatim", () => {
    expect(RTS_VIEW_OFFSET).toEqual({ x: 116, y: 165, z: 146 });
  });

  it("derives the elevation from the sibling offset (~41.5°)", () => {
    expect(RTS_ELEVATION).toBeCloseTo(Math.atan2(165, Math.hypot(116, 146)), 12);
    expect((RTS_ELEVATION * 180) / Math.PI).toBeCloseTo(41.5, 2);
  });

  const spots = {
    north: { kind: "commander", cellX: 80, cellZ: 10 },
    south: { kind: "commander", cellX: 80, cellZ: 117 },
    east: { kind: "commander", cellX: 150, cellZ: 64 },
    west: { kind: "commander", cellX: 9, cellZ: 64 },
    corner: { kind: "commander", cellX: 150, cellZ: 10 },
  } as const;

  for (const [name, commander] of Object.entries(spots)) {
    it(`opens at the RTS elevation for a ${name}-spawned commander`, () => {
      const f = field({ units: [{ ...commander }] });
      const pose = commanderCameraPose(f, 1);
      expect(elevationOf(pose)).toBeCloseTo(RTS_ELEVATION, 9);
    });
  }

  it("opens at the RTS elevation with no units (map center fallback)", () => {
    const f = field({ units: [] });
    expect(elevationOf(commanderCameraPose(f, 2))).toBeCloseTo(RTS_ELEVATION, 9);
  });
});

describe("opening frame survives the tick chain (no first-frame snap)", () => {
  // Headless tick-chain through REAL OrbitControls with the canvas settings
  // (damping, polar clamp, zoom limits, zoom-to-cursor), mirroring the
  // TerrainCanvas post-update order: snapshot → update → rigid-pan branch
  // → XZ clamps → eye/focus surface floors. A quiet opening (no input)
  // must leave the start pose untouched for every spawn side.
  function makeStartRig(pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) {
    const doc = { addEventListener() {}, removeEventListener() {} };
    const el = {
      style: {},
      clientWidth: 1200,
      clientHeight: 800,
      ownerDocument: doc,
      getRootNode: () => doc,
      addEventListener() {},
      removeEventListener() {},
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    };
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 2, 14000);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    const controls = new OrbitControls(camera, el as unknown as HTMLElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.zoomToCursor = true;
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    return { camera, controls };
  }

  function quietTick(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    worldW: number,
    worldD: number,
    groundY: number,
  ): void {
    camera.updateMatrixWorld();
    const preTargetX = controls.target.x;
    const preTargetZ = controls.target.z;
    const prePosX = camera.position.x;
    const prePosZ = camera.position.z;
    controls.update();
    const rigid = isRigidPan(
      controls.target.x - preTargetX,
      controls.target.z - preTargetZ,
      camera.position.x - prePosX,
      camera.position.z - prePosZ,
    );
    clampPanTargetWithCamera(controls.target, camera.position, worldW, worldD);
    if (rigid) clampCameraToWorldWithTarget(camera.position, controls.target, worldW, worldD);
    else clampCameraToWorld(camera.position, worldW, worldD);
    clampCameraAboveSurface(camera.position, groundY);
    clampTargetAboveSurface(controls.target, groundY);
  }

  // Real game size: generateMap always builds 320x256 (core MAP_WIDTH /
  // MAP_HEIGHT), and the 350-unit beyond-edge stand-off only fits inside
  // the tick clamp rectangle (25% margin) at that scale — smaller test
  // fields snap even the old pose, which is unreachable in-game.
  function gameField(commander: { kind: string; cellX: number; cellZ: number }): StartField {
    const width = 320;
    const height = 256;
    return {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      seaLevel: 75,
      units: [{ ...commander }],
    };
  }

  const spots = {
    center: { kind: "commander", cellX: 160, cellZ: 128 },
    north: { kind: "commander", cellX: 160, cellZ: 20 },
    south: { kind: "commander", cellX: 160, cellZ: 235 },
    east: { kind: "commander", cellX: 300, cellZ: 128 },
    west: { kind: "commander", cellX: 19, cellZ: 128 },
  } as const;

  for (const [name, commander] of Object.entries(spots)) {
    it(`holds the ${name}-spawn start pose steady through quiet ticks`, () => {
      const f = gameField(commander);
      const pose = commanderCameraPose(f, 1);
      const { camera, controls } = makeStartRig(pose);
      const worldW = (f.width - 1) * CELL;
      const worldD = (f.height - 1) * CELL;
      const groundY = worldHeight(100, 1);
      for (let tick = 0; tick < 5; tick++) {
        quietTick(camera, controls, worldW, worldD, groundY);
        expect(camera.position.x).toBeCloseTo(pose.position.x, 6);
        expect(camera.position.y).toBeCloseTo(pose.position.y, 6);
        expect(camera.position.z).toBeCloseTo(pose.position.z, 6);
        expect(controls.target.x).toBeCloseTo(pose.target.x, 6);
        expect(controls.target.y).toBeCloseTo(pose.target.y, 6);
        expect(controls.target.z).toBeCloseTo(pose.target.z, 6);
      }
    });
  }
});

describe("startGroundY / resnapHeightDelta", () => {
  it("tracks the anchor height across exaggeration", () => {
    const f = field({ units: [{ kind: "commander", cellX: 120, cellZ: 90 }] });
    expect(startGroundY(f, f.units[0]!, 1)).toBeCloseTo(worldHeight(100, 1), 10);
    expect(startGroundY(f, f.units[0]!, 2)).toBeCloseTo(worldHeight(100, 2), 10);
    expect(resnapHeightDelta(f, f.units[0]!, 1, 2)).toBeCloseTo(worldHeight(100, 1), 10);
  });

  it("falls back to sea level without a unit", () => {
    const f = field({ units: [] });
    expect(startGroundY(f, null, 2)).toBeCloseTo(worldHeight(75, 2), 10);
    expect(resnapHeightDelta(f, null, 1, 2)).toBeCloseTo(worldHeight(75, 1), 10);
  });
});
