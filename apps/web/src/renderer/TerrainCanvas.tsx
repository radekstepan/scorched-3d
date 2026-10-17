import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  applyBlastToRocks,
  applyBlastToTrees,
  blastSlopeAt,
  CELL_PIXELS,
  createDamageField,
  craterDepthAt,
  crushTree,
  effectiveExaggeration,
  FEATURE_EMPTY,
  FEATURE_FRINGE,
  composeAlbedo,
  composeHeight,
  featureName,
  hqAnchor,
  igniteTree,
  mulberry32,
  planRoutes,
  placeHqs,
  sampleHeightBilinear,
  seatHull,
  THREAT_ENGAGE_RADIUS,
  tickDamage,
  worldHeight,
  worldSize,
  type BlastSlope,
  type Crater,
  type HoverInfo,
  type InfluenceUnit,
  type PlacedUnit,
  type TNTMap,
  type TreeStand,
  type UnitKind,
  type ViewOptions,
} from "@scorched-3d/core";
import {
  skyFragment,
  skyVertex,
  terrainFragment,
  terrainVertex,
  waterFragment,
  waterVertex,
} from "./shaders";
import { buildUnits, buildSpawnedUnit, hideUnitCircles, setTeamRingSelected } from "./units";
import { CombatFx } from "./combatFx";
import { hqFacingFor, hqStagingRoute, type HqStagingSide } from "./hq";
import { HqFx, type HqStatus } from "./hqFx";
import { applyCraters } from "./craters";
import { FireFx } from "./fireFx";
import {
  buildRocks,
  buildTrees,
  decaySink,
  placeFeatures,
  rockPositions,
  treePositions,
  writeRockPose,
  writeTreePose,
} from "./features";
import { UnitMovement } from "./movement";
import { TrackTrails } from "./tracks";
import { HealthBars } from "./healthBars";
import { WaypointFx } from "./waypoints";
import { TerritoryFx, type TerritoryMinimap } from "./territory";
import {
  applyPan,
  clampCameraAboveSurface,
  clampCameraToWorld,
  clampCameraToWorldWithTarget,
  clampPanTargetWithCamera,
  clampTargetAboveSurface,
  effectivePanSpeed,
  effectiveZoomSpeed,
  isCameraOutsideWorld,
  isPanKey,
  isRigidPan,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  panInputFromCodes,
  panOffset,
  panStepDistance,
  shouldIgnoreKeyEvent,
} from "./cameraPan";
import {
  CLICK_DRAG_PX,
  boxPick,
  boxSelect,
  clickSelect,
  normalizeRect,
  pickNearest,
} from "./selection";
import {
  buildSelectionMarker,
  disposeSelectionAssets,
  markerVisibility,
  updateSelectionMarker,
} from "./selectionFx";
import {
  MOVE_PING_DURATION,
  MOVE_PING_MAX,
  buildMovePing,
  buildMovePingGeometry,
  movePingOpacity,
  movePingScale,
} from "./movePing";
import { OcclusionFx, disposeOcclusionAssets } from "./occlusionFx";
import { StandsCache } from "./stands";
import { computeUnitVisibility } from "./viewCull";
import { commanderCameraPose, pickStartUnit, resnapHeightDelta } from "./cameraStart";
import { jumpCameraTo } from "./minimap";
import { createFpsSampler, formatFps } from "./fps";
import { createHoverGate, hoverInfoKey, pickTerrainPoint } from "./hoverProbe";
import { applyDayNight, dayNightLighting } from "./night";
import { FIREFLY_COUNT, FireflyFx, placeFireflies } from "./fireflies";
import { DAY_FOG_COUNT, DAY_FOG_SEED_XOR, DayFogFx, placeDayFog } from "./dayFog";
import { setUnitFog, unitFogUniforms } from "./unitFog";

const SUN = new THREE.Vector3(-0.8, 1.0, 0.25).normalize();

interface Props {
  map: TNTMap;
  options: ViewOptions;
  onHover: (info: HoverInfo | null) => void;
  /** Fired when the RTS selection changes (sorted unit indices). */
  onSelection?: (indices: number[]) => void;
  /** Live unit X/Z broadcast (~4 Hz) for the minimap overlay. */
  onPositions?: (positions: { x: number; z: number; alive: boolean }[]) => void;
  /** Live HQ status broadcast (~4 Hz) for minimap markers. */
  onHq?: (hqs: HqStatus[]) => void;
  /**
   * Territory paint broadcast (~4 Hz while the overlay is on, null while
   * off) for the minimap canvas. The 3D terrain reads the same paint
   * straight off the shared texture — no React round-trip.
   */
  onTerritory?: (shot: TerritoryMinimap | null) => void;
  /**
   * Minimap click-to-move request (world X/Z + sequence). Consumed in the
   * render tick: the orbit target translates there with the camera offset
   * preserved, so yaw/pitch/zoom never reset.
   */
  jumpTo?: { x: number; z: number; seq: number } | null;
}

export default function TerrainCanvas({ map, options, onHover, onSelection, onPositions, onHq, onTerritory, jumpTo }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const optsRef = useRef(options);
  const hoverRef = useRef(onHover);
  const selectionRef = useRef(onSelection);
  const positionsRef = useRef(onPositions);
  const hqRef = useRef(onHq);
  const territoryRef = useRef(onTerritory);
  const jumpRef = useRef(jumpTo);
  optsRef.current = options;
  hoverRef.current = onHover;
  selectionRef.current = onSelection;
  positionsRef.current = onPositions;
  hqRef.current = onHq;
  territoryRef.current = onTerritory;
  jumpRef.current = jumpTo;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6aa0c8);

    const camera = new THREE.PerspectiveCamera(48, 1, 2, 14000);
    const { worldW, worldD } = worldSize(map);
    // Territory overlay (View menu): one shared influence field + texture —
    // the terrain shader samples it by UV, the minimap gets RGBA copies.
    // Created up front so the terrain material can bind the texture.
    const territory = new TerritoryFx(worldW, worldD);
    // Opening frame: due south of a command unit, outside the map looking
    // north in (fixed yaw matches the minimap orientation).
    const startPose = commanderCameraPose(map, options.exaggeration);
    const startUnit = pickStartUnit(map.units);
    camera.position.set(startPose.position.x, startPose.position.y, startPose.position.z);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    wrap.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.panSpeed = effectivePanSpeed(options.panSpeed);
    controls.zoomSpeed = effectiveZoomSpeed(options.zoomSpeed);
    // Cursor-anchored zoom: wheel/pinch dolly toward the ground point under
    // the cursor instead of the screen center, so zooming feels like leaning
    // into the spot being looked at. Stock OrbitControls behavior otherwise
    // (min/max distance, zoomSpeed, polar clamp all still apply); the target
    // it migrates is re-clamped to the map every tick below.
    controls.zoomToCursor = true;
    controls.target.set(startPose.target.x, startPose.target.y, startPose.target.z);

    const fogColor = new THREE.Color(0x8eb4c8);
    // Fog range comes from the active day/night preset (day runs denser);
    // applyDayNight re-applies it below and on every toggle, so the ranges
    // below only seed the opening frame.
    const fogPreset = dayNightLighting(options.nightMode);
    const fogNear = fogPreset.fogNear;
    const fogFar = fogPreset.fogFar;

    const albedoData = composeAlbedo(map);
    const heightData = composeHeight(map);
    const albedoTex = imageDataTexture(albedoData, true);
    const heightTex = imageDataTexture(heightData, false);
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;

    const terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        mapTex: { value: albedoTex },
        heightTex: { value: heightTex },
        seaLevel: { value: map.seaLevel },
        exaggeration: { value: effectiveExaggeration(options.exaggeration) },
        showContours: { value: 0 },
        showWater: { value: options.showWater && map.seaLevel > 0 ? 1 : 0 },
        time: { value: 0 },
        sunDir: { value: SUN.clone() },
        sunColor: { value: new THREE.Color(1.0, 0.93, 0.78) },
        skyColor: { value: new THREE.Color(0.55, 0.7, 0.88) },
        groundColor: { value: new THREE.Color(0.18, 0.16, 0.1) },
        fogColor: { value: fogColor },
        fogNear: { value: fogNear },
        fogFar: { value: fogFar },
        valleyFog: { value: fogPreset.valleyFog },
        influenceTex: { value: territory.texture },
        showTerritory: { value: 0 },
        fireflyPools: { value: Array.from({ length: FIREFLY_COUNT }, () => new THREE.Vector3()) },
        fireflyGlows: { value: new Array<number>(FIREFLY_COUNT).fill(0) },
      },
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
    });

    const geometry = buildTerrainGeometry(map, options.exaggeration);
    const terrain = new THREE.Mesh(geometry, terrainMat);
    terrain.name = "terrain";
    scene.add(terrain);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        heightTex: { value: heightTex },
        seaLevel: { value: map.seaLevel },
        exaggeration: { value: effectiveExaggeration(options.exaggeration) },
        time: { value: 0 },
        sunDir: { value: SUN.clone() },
        sunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
        fogColor: { value: fogColor },
        fogNear: { value: fogNear },
        fogFar: { value: fogFar },
      },
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      transparent: true,
      depthWrite: false,
    });
    const waterGeo = new THREE.PlaneGeometry(worldW, worldD, 192, 144);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = worldHeight(map.seaLevel, options.exaggeration) + 0.6;
    water.renderOrder = 1;
    scene.add(water);
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDir: { value: SUN.clone() },
        nightMix: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 20), skyMat);
    scene.add(sky);

    const hemi = new THREE.HemisphereLight(0xb8d4f0, 0x3a3424, 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.15);
    sun.position.copy(SUN).multiplyScalar(1800);
    scene.add(sun);
    // Day/night comes from the View menu via ref (no effect re-runs), so the
    // preset applies here for the opening frame and re-applies on change in
    // the tick — object identities never change, no shader recompiles.
    const dayNightTargets = { scene, fogColor, hemi, sun, terrainMat, waterMat, skyMat };
    applyDayNight(dayNightTargets, options.nightMode);
    // Unit hulls haze with the terrain's valley term (see unitFog.ts): bind
    // the shared field once — color aliases this fog color, so day/night
    // retints propagate; strength re-applies via applyDayNight on toggle.
    setUnitFog({
      color: fogColor,
      valley: fogPreset.valleyFog,
      waterY: worldHeight(map.seaLevel, options.exaggeration),
      exaggeration: effectiveExaggeration(options.exaggeration),
    });

    // The tree materials alias the terrain's firefly-field uniforms, so
    // the single per-tick mirror below reflects every mote on both.
    const trees = buildTrees(map, options.exaggeration, {
      pools: terrainMat.uniforms.fireflyPools!,
      glows: terrainMat.uniforms.fireflyGlows!,
    });
    const rocks = buildRocks(map, options.exaggeration);
    const units = buildUnits(map, options.exaggeration);
    scene.add(trees, rocks, units);

    // Ambient skirmish: units trade tracer/shell fire with muzzle flashes,
    // impact explosions, and recoil kicks, driven by the render-loop clock.
    // Impacts scar the ground (persistent capped scorch decals with charred
    // centers and irregular edges, re-seated on exaggeration change, plus a
    // tiny visual crater dent in the terrain mesh) and damage the environment
    // in graduated stages —
    // blast cores flatten trees to toppled/stump/snag and bury rocks, while
    // the fringe ignites burning → smouldering → terminal states with spread;
    // splashed units rock with a decaying directional nudge (renderer-side
    // only — blasts never displace movers, so drive/pathing never see the
    // kick) and hesitate their drive briefly while the rock plays.
    // Bilinear surface sampling (continuous across cell edges, so hulls,
    // scorch, and probes never pop by whole height steps mid-cell) tracking
    // the live exaggeration slider, minus the accumulated crater bowls.
    const craters: Crater[] = [];
    const groundY = (x: number, z: number): number =>
      worldHeight(sampleHeightBilinear(map, x, z) - craterDepthAt(craters, x, z), optsRef.current.exaggeration);
    const seat = (x: number, z: number, hull: number, kind: UnitKind) =>
      seatHull(map, kind, x, z, hull, optsRef.current.exaggeration);
    // Night swarm: seeded on the map seed, clustered around forest stands.
    const fireflies = new FireflyFx(
      scene,
      placeFireflies(
        mulberry32(map.seed ^ 0xf1e5),
        treePositions(trees).map((p) => ({ x: p.x, z: p.z })),
        FIREFLY_COUNT,
        groundY,
      ),
      groundY,
    );
    fireflies.setNight(options.nightMode);
    // Day ground-fog: a sparse scatter of white mist banks pooled in the
    // hollows (the fireflies' day-shift mirror: seeded on the map seed with
    // its own stream, hidden at night). The rest surface folds the water
    // sheet in, so banks over lakes read as lake mist instead of sinking
    // under the sheet; the closure reads live heights, so resnaps track.
    // Fold the sheet in only while it renders (same condition as the
    // water mesh): with water hidden there is no sheet to stay out of.
    const fogSurface = (x: number, z: number): number => {
      const g = groundY(x, z);
      return optsRef.current.showWater && map.seaLevel > 0 ? Math.max(g, water.position.y) : g;
    };
    const dayFog = new DayFogFx(
      scene,
      placeDayFog(mulberry32(map.seed ^ DAY_FOG_SEED_XOR), worldW, worldD, DAY_FOG_COUNT, fogSurface),
      fogSurface,
    );
    dayFog.setNight(options.nightMode);
    // Graduated collateral state: caller-owned core DamageField indexed by
    // feature id. Poses and fire visuals are transient views of this field,
    // so exaggeration re-snaps preserve burns instead of resurrecting them.
    const damage = createDamageField(
      (trees.userData.all as THREE.Vector3[]).length,
      (rocks.userData.positions as THREE.Vector3[]).length,
    );
    // Fallen (terminal, non-gone) tree fids, re-posed every tick so the
    // decay sink reads as continuous settling instead of a pop at `gone`.
    // Entries arrive from blast flattens, burn resolutions, and hull crushes
    // below; `gone` transitions remove them.
    const fallen = new Set<number>();
    const allTrees = treePositions(trees);
    const rockPts = rockPositions(rocks);
    const fire = new FireFx(scene);
    const featureDummy = new THREE.Object3D();
    const poseTree = (fid: number): void => {
      const p = allTrees[fid]!;
      const state = damage.trees[fid] ?? "intact";
      writeTreePose(
        trees,
        featureDummy,
        fid,
        groundY(p.x, p.z),
        state,
        decaySink(state, damage.treeAge[fid] ?? 0),
      );
    };
    const poseRock = (i: number): void => {
      const p = rockPts[i]!;
      writeRockPose(rocks, featureDummy, i, groundY(p.x, p.z), damage.rocks[i] ?? 0);
    };
    const glowFire = (fid: number): void => {
      const p = allTrees[fid]!;
      combat.glowAt({ x: p.x, y: groundY(p.x, p.z) + 18, z: p.z }, 0xff7a22);
    };
    const blastFeatures = (x: number, z: number, radius: number, slope?: BlastSlope): void => {
      const treeRes = applyBlastToTrees(damage, allTrees, x, z, radius, Math.random, undefined, slope);
      const rockChanged = applyBlastToRocks(damage, rockPts, x, z, radius, undefined, slope);
      for (const fid of treeRes.flattened) {
        poseTree(fid);
        fallen.add(fid);
      }
      for (const fid of treeRes.ignited) {
        poseTree(fid);
        glowFire(fid);
      }
      for (const i of rockChanged) poseRock(i);
      if (treeRes.flattened.length > 0) dirtyStands();
    };
    // Shallow visual crater per impact (≤0.6 height units each, oldest evicted
    // with the scorch cap so the bowl count never grows unbounded). On graded
    // ground the bowl carries its downhill wash (stretched down the fall
    // line, cut short uphill) instead of denting a flat circle. The dent
    // lives only in the terrain mesh + groundY seating: core pathing and unit
    // seating read the static heightfield, so bowls never trap units.
    const dentTerrain = (x: number, z: number, radius: number, depth: number, slope?: BlastSlope): void => {
      craters.push(
        slope && slope.skew > 0
          ? { x, z, radius, depth, sx: slope.sx, sz: slope.sz, skew: slope.skew }
          : { x, z, radius, depth },
      );
      if (craters.length > 48) craters.shift();
      applyCraters(geometry, map, craters, optsRef.current.exaggeration);
      // Fresh dent moves the dirt under nearby trees: the stands snapshot
      // reads live heights, so invalidate it (otherwise occlusion and
      // interception would sample pre-crater ground until the next fell).
      dirtyStands();
    };
    // Tree-stands snapshot, shared by the occlusion x-ray, the combat
    // tree-interception rolls, and hunt visibility: one build per
    // invalidation instead of one per tick (~15k groundY probes per build on
    // Ashen Pass, so quiet ticks now cost zero). Mutators that flip
    // `standing` mid-tick (blast flattens, hull crushes, burn resolutions)
    // dirty it so later readers in the same tick still see live wood, and so
    // do the two height movers below (crater dents, exaggeration re-snaps);
    // ignitions never dirty it (burning still stands, heights unchanged).
    const stands = new StandsCache(allTrees, damage, groundY);
    const getStands = (): TreeStand[] => stands.get();
    const dirtyStands = (): void => {
      stands.dirty();
    };
    // HQ structures (assigned below, after movement exists): ambient guns
    // shell live enemy HQs inside admitted range, and every blast splashes
    // them through the HQ damage state. Guarded — combat ticks before the
    // assignment only on regen teardown, never with live shots.
    let hq: HqFx | null = null;
    const combat = new CombatFx(scene, units, Math.random, {
      groundY,
      slopeAt: (x, z) => blastSlopeAt(map, x, z),
      blastFeatures,
      dentTerrain,
      // Projectile tree interception: live crowns/trunks catch rounds
      // (stuck bolt embers, shell early bursts) and block flat lines of
      // fire so guns lob over the canopy. Felled/stump/snag/gone wood has
      // no crown left to catch — only standing trees intercept. The same
      // stands feed the occlusion x-ray below, so view-blocking wood and
      // round-blocking wood can never disagree.
      treeStands: getStands,
      strikeTree: (fid: number) => {
        if (igniteTree(damage, fid)) {
          poseTree(fid);
          glowFire(fid);
        }
      },
      // Gun-tube crush: a traversing cannon that touches a standing bole
      // knocks it flat (the hull-crush parallel) instead of clipping
      // through it. Same fell/pose/decay path as hull crush and blasts.
      fellTree: (fid: number) => {
        if (crushTree(damage, fid)) {
          poseTree(fid);
          fallen.add(fid);
          dirtyStands();
        }
      },
      // Structure fire: live enemy HQs draw aimed volleys inside admitted
      // range (range caps keep cross-map lobs impossible), and every blast
      // — aimed or collateral — splashes them through the HQ damage state.
      hqTargets: () => hq?.targets() ?? [],
      damageStructures: (at, kind, shooter, _hostile, attack) => {
        hq?.splash(at.x, at.z, kind, shooter, attack);
      },
      // Self-defense first: a fort-shelling gun answering a live enemy holds
      // structure fire until the grudge clears (the hull duel aims it
      // meanwhile). `movement` is assigned below; the hook only runs on
      // later ticks, so the closure reads it live.
      isEngaged: (index: number) => movement.isFighting(index),
    });
    // Patrol movement: each unit loops seeded dry/gentle waypoints at
    // per-kind speed with the hull facing travel; combat keeps the turrets
    // (external hulls) so units fire on the move. Recoil anchors follow the
    // hulls so the kick restore never snaps a driving unit backward. Hulls
    // crush through standing trees at a crawl (felling them into the
    // decaying `fallen` set) instead of pinning on wood.
    const routes = planRoutes(map, map.units, map.seed);
    const movement = new UnitMovement(units, routes, {
      groundY,
      seat,
      onShift: (index, dx, dz) => combat.shiftRecoilBase(index, dx, dz),
      // Hunt visibility reads the same per-tick stands as projectile
      // interception and the occlusion x-ray: sight-blocking wood and
      // round-blocking wood can never disagree.
      treeStands: getStands,
    }, map, {
      field: damage,
      points: allTrees,
      onCrush: (fids) => {
        for (const fid of fids) {
          poseTree(fid);
          fallen.add(fid);
        }
        if (fids.length > 0) dirtyStands();
      },
    });
    combat.setExternalHull(true);
    // Team HQs: one fortified bunker per side at its map end (Blue west,
    // Orange east, doors facing the map center). Each live HQ slides its
    // door up every interval and releases a reinforcement at its door that
    // walks the hall out of the mouth to join the hunt; enemy fire — aimed volleys
    // inside admitted range plus honest splash from any nearby blast — can
    // wreck the fort, which stops the clock and leaves a charred husk.
    // Release count per team: successive releases stage on alternating
    // sides of the exit lane so no two stagings stack on the entrance.
    const spawnCounts = [0, 0];
    hq = new HqFx(
      scene,
      // The map ships its sited forts (`generateMap` leveled and dirt-seated
      // the pads and cleared the exit lanes for exactly these cells); fall
      // back to a fresh siting only for synthetic maps that predate the field.
      (map.hqs ?? placeHqs(map, map.seed)).map((site) => ({
        ...hqAnchor(map, site, optsRef.current.exaggeration),
        team: site.team,
      })),
      {
        groundY,
        onSpawn: (team, kind, x, z, exit) => {
          // New hull, same systems as the mustered roster: body + selection
          // marker, placement entry (team/kind for targeting + HUD), mover
          // on a door-to-staging patrol (the release appears just outside
          // the door and walks the hall out of the mouth while the hunt
          // sweep acquires enemies same-tick), and roster growth for
          // bars/ghosts/trails.
          const yaw = team === 0 ? Math.PI / 2 : -Math.PI / 2;
          const body = buildSpawnedUnit(kind, team, x, z, yaw, groundY);
          const marker = buildSelectionMarker();
          updateSelectionMarker(marker, 0, false);
          body.add(marker);
          units.add(body);
          const placed = units.userData.units as PlacedUnit[];
          placed.push({
            kind,
            team,
            cellX: Math.min(Math.max(Math.round(x / CELL_PIXELS + (map.width - 1) / 2), 0), map.width - 1),
            cellZ: Math.min(Math.max(Math.round(z / CELL_PIXELS + (map.height - 1) / 2), 0), map.height - 1),
            rotation: yaw,
          });
          // Staging route past the mouth: a one-shot departure walks the
          // hall's full length straight out, then the release joins an
          // off-lane staging loop that never returns to the road or the
          // door — the entrance stays passable. Successive releases
          // alternate sides so stagings spread instead of stacking.
          const side: HqStagingSide = spawnCounts[team]! % 2 === 0 ? 1 : -1;
          spawnCounts[team]! += 1;
          const staging = hqStagingRoute(exit, hqFacingFor(team), side);
          movement.addUnit(x, z, yaw, staging.loop, kind, staging.leadIn);
          health.setCount(units.children.length);
          occlusion.setKinds(placed.map((u) => u.kind));
          waypoints.setRoutes(routes);
        },
        onKilled: (index) => {
          // Epic burst at the fort through the shared stack (non-hostile, so
          // survivors hesitate but blame nobody) — the wreck pose + clock
          // stop already landed in the splash.
          const p = hq?.positionAt(index);
          if (p) combat.detonateStructure(new THREE.Vector3(p.x, p.y + 10, p.z), "hammer");
        },
        onDamaged: (index, shooter) => {
          // The garrison rallies: live same-team hulls near the shelled fort
          // are pointed at the shooter through the retaliation pipeline
          // (holding hulls still refuse; ordered hulls record a self-defense
          // memory without leaving their order).
          if (shooter === null || shooter === undefined) return;
          const fort = hq?.positionAt(index);
          const spots = movement.positions();
          const gun = spots[shooter];
          if (!fort || !gun) return;
          const placed = units.userData.units as PlacedUnit[];
          const side = hq?.status()[index]?.team;
          for (let i = 0; i < units.children.length; i++) {
            if (placed[i]?.team !== side) continue;
            if (combat.isDestroyedAt(i)) continue;
            const s = spots[i];
            if (!s) continue;
            if (Math.hypot(s.x - fort.x, s.z - fort.z) <= THREAT_ENGAGE_RADIUS) {
              movement.threatenUnit(i, shooter, gun.x, gun.z);
            }
          }
        },
      },
    );
    // Fading track trails: driving hulls stamp a subtle compressed-dust
    // trace (per-kind tread width, capped pool, fading over seconds).
    // Renderer-side only — movers never see the marks.
    const tracks = new TrackTrails(scene, { groundY });
    // Waypoint overlay (View menu): static patrol loops per regen plus the
    // live driven path per unit (turn arcs + terrain gating included),
    // re-seated with the terrain.
    const waypoints = new WaypointFx(scene, routes, { groundY, field: map });
    waypoints.setVisible(optsRef.current.showWaypoints);
    // Overhead health bars (View menu): billboarded per-unit bars reading
    // live CombatFx damage, re-seated every tick from the body origins.
    const health = new HealthBars(scene, units.children.length);
    health.setVisible(optsRef.current.showHealth);
    // Fort spotting: the drive shares a scout's HQ sighting team-wide and
    // marches the side onto the works (live forts only — wrecks drop out of
    // `targets()`, so the push ends when the fort falls).
    movement.setHqProvider(() => hq?.targets() ?? []);
    // HQ forts share the same toggle: one wider bar per live works above
    // the roofline, reading live HqFx damage (wrecks show nothing).
    health.setHqCount(hq?.count ?? 0);
    // Light budgets follow the opening toggle (the tick re-applies on flip).
    combat.setNight(options.nightMode);
    fire.setNight(options.nightMode);
    hq?.setNight(options.nightMode);
    // Occlusion x-ray: a blue silhouette ghost (selection cyan: true hull
    // outline + slight transparent fill) for any unit hidden behind the
    // heightfield or a live canopy from this camera, so occluded hulls stay
    // locatable. Own scene group, depth-ignored, above the health-bar layer;
    // never a body child, so hull paint (incl. damage charring), selection
    // rings/beacons, waypoints, and picking ignore it. Sampled taps vs live
    // groundY + the shared stands — no raycaster.
    const occlusion = new OcclusionFx(
      scene,
      map.units.map((u) => u.kind),
    );

    // RTS selection: exactly one ground circle per unit — the hull's own
    // team ring, thickened + brightened on selection (see
    // `setTeamRingSelected`) — plus a static chevron beacon above the
    // hull (see selectionFx for the contrast policy: the old amber ring
    // was hue-camouflaged among amber fire on ember-brown scorch, went
    // edge-on at glancing angles, and hid under smoke/toppled trunks).
    // The markers are intentionally static (no pulse/spin/bob). The hull
    // itself is never tinted — it keeps its normal paint including damage
    // charring, so a highlighted unit never runs blue; the ring + beacon
    // (+ minimap dot) carry the signal alone. The
    // marker is a child of the body group so it rides motion and
    // exaggeration re-snaps for free; beacon ignores depth and composites
    // above the scorch layer. Shared geometry/material, one set per
    // canvas.
    units.children.forEach((child) => {
      const marker = buildSelectionMarker();
      updateSelectionMarker(marker, 0, false);
      child.add(marker);
    });
    let selection: number[] = [];
    const applySelection = (next: number[]): void => {
      // Wrecks are never selectable (belt-and-braces: picks already filter
      // them, but kills can land mid-gesture). Markers are static: pose once
      // here, no per-tick animation.
      selection = next.filter((i) => !combat.isDestroyedAt(i));
      const vis = markerVisibility(units.children.length, selection);
      units.children.forEach((child, i) => {
        const marker = child.getObjectByName("select-marker");
        if (marker) updateSelectionMarker(marker as THREE.Group, 0, vis[i] ?? false);
        // The team ring brightens on the selected hull only; the rest of
        // the field keeps the subtle marker.
        setTeamRingSelected(child as THREE.Group, vis[i] ?? false);
      });
      selectionRef.current?.([...selection]);
    };
    // Unit death: freeze the mover as a husk and drop it from the
    // selection (combat sinks, gutters, and finally hides the charred
    // instance over its slow decay; the scorch scar stays).
    combat.onUnitKilled = (index) => {
      movement.markDestroyed(index);
      // Circles drop with the hull: the team ring + selection beacon hide
      // immediately (the husk still smoulders until decay). Combat already
      // hides them in `poseWreck`; this is belt-and-braces for hook order.
      const dead = units.children[index] as THREE.Group | undefined;
      if (dead) hideUnitCircles(dead);
      if (selection.includes(index)) {
        applySelection(selection.filter((s) => s !== index));
      }
    };
    // Hit recoil: a surviving splash recoils that hull away from the blast
    // over a damage-scaled beat (the visible jerk back is the combat nudge
    // rock; this is the gameplay slide under it). Wrecks refuse the stun.
    combat.onUnitStunned = (index, damageAdd, blastX, blastZ) => {
      movement.stunUnit(index, damageAdd, blastX, blastZ);
    };
    // Retaliation: a surviving splash points the victim at its live shooter
    // so idle/patrolling hulls turn and pursue while the memory is fresh
    // (ordered hulls record a self-defense memory and keep driving —
    // pursuing on arrival — while holding hulls refuse, and wrecks and
    // self-splashes stay silent). Arcing shells investigate past the
    // retaliation gates, and the victim's turret traverses onto the live
    // shooter either way (range and terrain still gate every round). The
    // threat feeds the same core drive the patrol uses, so pursuit never
    // teleports.
    combat.onUnitThreatened = (victim, attacker, ax, az, _damageAdd, shell) => {
      movement.threatenUnit(victim, attacker, ax, az, shell);
      combat.trackThreat(victim, attacker);
    };
    // Obstructed guns: a hull whose gun cannot engage — terrain hides its
    // target, or its rounds keep sticking in wood — repositions toward it
    // (higher vantage, closer, or out of the forest) through the same
    // pursuit drive instead of shooting through the hill or the canopy.
    combat.onObstructedShot = (attacker, target, x, z) => {
      movement.seekEngage(attacker, target, x, z);
    };

    // Move-order pings: short-lived expanding rings where an order landed.
    // Same round-circle compositing as the unit selection beacon
    // (depth-test off, selection render-order band) so hilly terrain never
    // cuts the destination circle off — see `movePing.ts`.
    const pingGeo = buildMovePingGeometry();
    const pings: { mesh: THREE.Mesh; t: number }[] = [];
    const addPing = (x: number, z: number): void => {
      if (pings.length >= MOVE_PING_MAX) {
        const oldest = pings.shift();
        if (oldest) {
          scene.remove(oldest.mesh);
          (oldest.mesh.material as THREE.Material).dispose();
        }
      }
      const mesh = buildMovePing(pingGeo, x, z, groundY);
      scene.add(mesh);
      pings.push({ mesh, t: 0 });
    };

    // Drag-box overlay for shift-drag selection (pointer-events-none so the
    // hover probe and orbit keep working underneath).
    const boxEl = document.createElement("div");
    boxEl.style.cssText =
      "position:absolute;display:none;border:1px solid rgba(34,211,238,0.9);" +
      "background:rgba(34,211,238,0.12);pointer-events:none;z-index:5;";
    wrap.appendChild(boxEl);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    // Hover probe gate: pointermove only records coords + dirties the probe
    // (no raycast, no layout read in the handler); the tick samples at most
    // once per frame, and only when the pointer or the camera moved. A parked
    // cursor costs zero raycasts and zero React re-renders — previously both
    // ran every frame while the pointer was over the canvas (~50 fps lost).
    const hoverGate = createHoverGate();
    let lastHoverKey = hoverInfoKey(null);
    const markHoverDirty = (): void => {
      hoverGate.cameraMoved();
    };
    // Cached canvas rect for the hover probe: the per-probe
    // getBoundingClientRect layout read cost a forced reflow every motion
    // frame, so the probe reads this instead (refreshed in resize(), which
    // the ResizeObserver fires on every layout change). Click/pointer-up
    // paths still read the rect fresh — they run once per gesture, where a
    // stale frame after a window resize could misplace the pick.
    let cachedCanvasRect = renderer.domElement.getBoundingClientRect();
    // Scratch for the hover unproject: reused every probe, zero per-tick
    // allocation on the motion path (the old hits array is gone with the
    // mesh raycast).
    const hoverNdc = new THREE.Vector3();

    const canvasRect = (): DOMRect => renderer.domElement.getBoundingClientRect();

    /** Project every body to canvas pixels for picking. */
    const projectUnits = (): { x: number; y: number }[] => {
      const rect = canvasRect();
      const v = new THREE.Vector3();
      return movement.positions().map((p) => {
        v.set(p.x, groundY(p.x, p.z) + 6, p.z).project(camera);
        return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
      });
    };

    /**
     * Project wreck-free bodies for picking, keeping roster indices
     * alongside so box/click hits remap into selection space. Wreck
     * instances stay rendered (smouldering) but are never pickable.
     */
    const projectSelectable = (): { points: { x: number; y: number }[]; indices: number[] } => {
      const all = projectUnits();
      const points: { x: number; y: number }[] = [];
      const indices: number[] = [];
      all.forEach((p, i) => {
        if (!combat.isDestroyedAt(i)) {
          points.push(p);
          indices.push(i);
        }
      });
      return { points, indices };
    };

    const bodyIndexOf = (obj: THREE.Object3D | null): number | null => {
      let cur: THREE.Object3D | null = obj;
      while (cur && cur.parent !== units) cur = cur.parent;
      if (!cur) return null;
      const i = units.children.indexOf(cur);
      return i >= 0 ? i : null;
    };

    const pickBody = (clientX: number, clientY: number): number | null => {
      const rect = canvasRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(units.children, true);
      // Wrecks are unpickable — and must not occlude live hulls behind them.
      for (const hit of hits) {
        const i = bodyIndexOf(hit.object);
        if (i !== null && !combat.isDestroyedAt(i)) return i;
      }
      return null;
    };

    const pickGround = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = canvasRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(terrain);
      return hits.length > 0 && hits[0] ? hits[0].point : null;
    };

    // Input UX (documented in the HUD footer): left-click selects,
    // shift-click toggles, shift-drag boxes (plain left-drag keeps orbiting),
    // right-click without drag orders the selection to move (right-drag keeps
    // panning), Esc clears. Click vs drag disambiguates on a pixel threshold.
    let down: { x: number; y: number; button: number; shift: boolean } | null = null;
    let boxing = false;
    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0 && ev.button !== 2) return;
      down = { x: ev.clientX, y: ev.clientY, button: ev.button, shift: ev.shiftKey };
      boxing = false;
      // Disable orbiting up front for shift-left so a box gesture never
      // starts with an orbit jump; pointerup always restores it (a plain
      // shift-click never boxes, it just toggles).
      if (ev.button === 0 && ev.shiftKey) controls.enabled = false;
    };
    const onPointerMove = (ev: PointerEvent) => {
      // Record only: the tick consumes the latest position (one raycast per
      // frame max, none while parked). No getBoundingClientRect here — that
      // layout read happens once per consumed probe in the tick.
      hoverGate.move(ev.clientX, ev.clientY);
      if (
        down &&
        down.button === 0 &&
        down.shift &&
        !boxing &&
        Math.hypot(ev.clientX - down.x, ev.clientY - down.y) >= CLICK_DRAG_PX
      ) {
        boxing = true;
        controls.enabled = false;
      }
      if (boxing && down) {
        const wrapRect = wrap.getBoundingClientRect();
        const x0 = Math.min(down.x, ev.clientX) - wrapRect.left;
        const y0 = Math.min(down.y, ev.clientY) - wrapRect.top;
        boxEl.style.display = "block";
        boxEl.style.left = `${x0}px`;
        boxEl.style.top = `${y0}px`;
        boxEl.style.width = `${Math.abs(ev.clientX - down.x)}px`;
        boxEl.style.height = `${Math.abs(ev.clientY - down.y)}px`;
      }
    };
    const onPointerUp = (ev: PointerEvent) => {
      const wasDown = down;
      down = null;
      // Shift-drag may have disabled orbiting mid-gesture: always restore.
      const wasBoxing = boxing;
      boxing = false;
      controls.enabled = true;
      boxEl.style.display = "none";
      if (!wasDown || ev.button !== wasDown.button) return;
      const moved = Math.hypot(ev.clientX - wasDown.x, ev.clientY - wasDown.y);
      if (wasBoxing) {
        if (wasDown.button === 0) {
          const rect = canvasRect();
          const toLocal = (cx: number, cy: number): { x: number; y: number } => ({
            x: cx - rect.left,
            y: cy - rect.top,
          });
          const sel = projectSelectable();
          const hits = boxPick(
            sel.points,
            normalizeRect(toLocal(wasDown.x, wasDown.y), toLocal(ev.clientX, ev.clientY)),
          ).map((h) => sel.indices[h] ?? -1).filter((h) => h >= 0);
          applySelection(boxSelect(selection, hits, ev.shiftKey));
        }
        return;
      }
      if (moved >= CLICK_DRAG_PX) return;
      if (wasDown.button === 0) {
        // Resolve clicks in screen space too: the raycast can miss small or
        // partially occluded hulls, while the projected pick matches what the
        // player sees. Raycast wins when both hit (exact mesh), else the
        // nearest projection within the pick radius.
        const rect = canvasRect();
        const meshHit = pickBody(ev.clientX, ev.clientY);
        const sel = projectSelectable();
        const screenSlot = pickNearest(sel.points, {
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
        });
        const screenHit = screenSlot === null ? null : (sel.indices[screenSlot] ?? null);
        applySelection(clickSelect(selection, meshHit ?? screenHit, ev.shiftKey));
      } else if (wasDown.button === 2 && selection.length > 0) {
        const point = pickGround(ev.clientX, ev.clientY);
        if (point) {
          movement.orderGroup(selection, { x: point.x, z: point.z });
          addPing(point.x, point.z);
        }
      }
    };
    const onLeave = () => {
      hoverGate.leave();
      // Emit the clear only if a cell was showing: leaving with no active
      // probe must not churn React with a redundant setState(null).
      if (lastHoverKey !== hoverInfoKey(null)) {
        lastHoverKey = hoverInfoKey(null);
        hoverRef.current(null);
      }
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    // Camera motion under a parked cursor changes the probed cell: re-dirty
    // the hover gate on every orbit/zoom update (fires only while the camera
    // actually moves, so a settled camera costs nothing).
    controls.addEventListener("change", markHoverDirty);
    window.addEventListener("pointerup", onPointerUp);
    const onContextMenu = (ev: Event): void => {
      ev.preventDefault();
    };
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    // Keyboard pan: arrows / WASD translate camera + target in screen space.
    const pressed = new Set<string>();
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code === "Escape") {
        applySelection([]);
        return;
      }
      if (!isPanKey(ev.code) || shouldIgnoreKeyEvent(ev.target)) return;
      ev.preventDefault();
      pressed.add(ev.code);
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      pressed.delete(ev.code);
    };
    const onBlur = () => {
      pressed.clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      // Keep updateStyle enabled (the default): with `false` the canvas
      // keeps its pixel-ratio backing store as its CSS box (2x the wrap on
      // retina), overflows the wrap, and the root's overflow-hidden clips it
      // to the top-left quadrant — so the orbit target at NDC (0,0) renders
      // at the visible bottom-right corner and minimap jumps never center.
      // Nothing in CSS constrains the canvas (preflight max-width covers
      // img/video only), so three.js must style it here.
      renderer.setSize(w, h);
      cachedCanvasRect = renderer.domElement.getBoundingClientRect();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let lastExag = options.exaggeration;
    let lastNight = options.nightMode;
    let raf = 0;
    let posTimer = 1;
    let appliedJumpSeq = jumpRef.current?.seq ?? -1;
    // A minimap jump teleports the camera by rigid translation — its offset
    // IS the requested zoom/angle — so a jump-placed camera outside the
    // world rectangle is legitimate (its focus is in-bounds by
    // construction) and the camera clamp yields until the camera drifts
    // back inside on its own. Clamping the fresh teleport would yank it,
    // collapsing zoom and swinging the angle (task 120).
    let jumpPlacedCamera = false;
    const clock = new THREE.Clock();
    // FPS readout: sampler feeds the overlay div straight from the tick, so
    // React state never churns at frame rate.
    const fpsSampler = createFpsSampler();
    const fpsEl = fpsRef.current;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const fps = fpsSampler.frame(performance.now());
      if (fps !== null && fpsEl) fpsEl.textContent = formatFps(fps);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const opt = optsRef.current;

      if (opt.exaggeration !== lastExag) {
        // Keep the view geometry while the terrain re-snaps: shift camera and
        // target by the start anchor's ground-height delta so orbiting and
        // keyboard panning continue from the same relative frame.
        const dy = resnapHeightDelta(map, startUnit, lastExag, opt.exaggeration);
        camera.position.y += dy;
        controls.target.y += dy;
        lastExag = opt.exaggeration;
        applyCraters(geometry, map, craters, lastExag);
        geometry.computeVertexNormals();
        water.position.y = worldHeight(map.seaLevel, lastExag) + 0.6;
        // Damage survives: re-seat from the persistent field, drop in-flight
        // endpoints (sampled at old heights), re-seat patrol hulls, re-seat
        // scorch, and blank the transient flames — the next tick rebuilds
        // them from the field at the new heights.
        placeFeatures(trees, rocks, map, lastExag, damage);
        // In-flight endpoints were sampled at the old heights; drop them so
        // tracers never chase stale air, then re-seat the patrol hulls (live
        // X/Z, fresh Y) so recoil restores can't snap them back. Scorch and
        // the damage field persist — just re-seat them.
        combat.clearTransients();
        fire.clearTransients();
        movement.resnap();
        hq?.resnap();
        fireflies.resnap();
        dayFog.resnap();
        tracks.resnap();
        waypoints.resnap();
        combat.reseatScorch();
        // Heights re-scale: the stands snapshot caches live heights, so it
        // must rebuild before the next occlusion/interception read.
        dirtyStands();
        markHoverDirty();
      }

      terrainMat.uniforms.exaggeration!.value = effectiveExaggeration(opt.exaggeration);
      terrainMat.uniforms.showTerritory!.value = opt.showTerritory ? 1 : 0;
      terrainMat.uniforms.showContours!.value = opt.showContours ? 1 : 0;
      terrainMat.uniforms.showWater!.value = opt.showWater && map.seaLevel > 0 ? 1 : 0;
      terrainMat.uniforms.time!.value = t;
      waterMat.uniforms.exaggeration!.value = effectiveExaggeration(opt.exaggeration);
      waterMat.uniforms.time!.value = t;
      // Hull valley band tracks the height slider with the terrain shaders.
      unitFogUniforms.waterY.value = worldHeight(map.seaLevel, opt.exaggeration);
      unitFogUniforms.exaggeration.value = effectiveExaggeration(opt.exaggeration);
      water.visible = opt.showWater && map.seaLevel > 0;
      trees.visible = opt.showFeatures;
      rocks.visible = opt.showFeatures;
      if (opt.nightMode !== lastNight) {
        lastNight = opt.nightMode;
        applyDayNight(dayNightTargets, lastNight);
        combat.setNight(lastNight);
        fire.setNight(lastNight);
        hq?.setNight(lastNight);
      }
      skyMat.uniforms.time!.value = t;
      fireflies.setNight(opt.nightMode);
      fireflies.update(t);
      dayFog.setNight(opt.nightMode);
      dayFog.update(t);
      // Mirror the full swarm into the shared shader field (terrain owns
      // the uniforms, tree materials alias them): every mote's live
      // position plus its own pulse glow, everything dies by day.
      const poolU = terrainMat.uniforms.fireflyPools!.value as THREE.Vector3[];
      const glowU = terrainMat.uniforms.fireflyGlows!.value as number[];
      fireflies.writeField(poolU, glowU, opt.nightMode);
      terrainMat.wireframe = opt.showWire;
      const mag = opt.pixelFilter ? THREE.NearestFilter : THREE.LinearFilter;
      const min = opt.pixelFilter ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
      if (albedoTex.magFilter !== mag || albedoTex.minFilter !== min) {
        albedoTex.magFilter = mag;
        albedoTex.minFilter = min;
      }

      if (pressed.size > 0) {
        const input = panInputFromCodes(pressed);
        if (input.right !== 0 || input.forward !== 0) {
          const dist = camera.position.distanceTo(controls.target);
          const offset = panOffset(camera.position, controls.target, input, panStepDistance(dist, dt, opt.panSpeed));
          applyPan(camera.position, controls.target, offset);
          // Carry the camera with the clamped target delta so hitting an
          // edge stops forward motion instead of flipping the view (the
          // camera must never keep travelling past a stuck target), then
          // hold the camera itself inside the world rectangle — carrying
          // the target with it, so panning backwards stops at the wall
          // behind us instead of letting the target catch the pinned
          // camera and warp the angle — unless a minimap jump placed it
          // (its offset is the requested zoom).
          clampPanTargetWithCamera(controls.target, camera.position, worldW, worldD);
          if (!jumpPlacedCamera)
            clampCameraToWorldWithTarget(camera.position, controls.target, worldW, worldD);
          markHoverDirty();
        }
      }

      // View-menu sliders: OrbitControls reads panSpeed/zoomSpeed live, so
      // re-sync every tick (options arrive via ref, not effect re-runs).
      if (controls.panSpeed !== effectivePanSpeed(opt.panSpeed)) {
        controls.panSpeed = effectivePanSpeed(opt.panSpeed);
      }
      if (controls.zoomSpeed !== effectiveZoomSpeed(opt.zoomSpeed)) {
        controls.zoomSpeed = effectiveZoomSpeed(opt.zoomSpeed);
      }

      // Minimap click-to-move: translate target + camera by the same
      // offset so yaw/pitch/zoom survive (clamped to the map like pan),
      // seating the target onto the terrain height at the destination so
      // the clicked point lands in the center of the view.
      const jump = jumpRef.current;
      if (jump && jump.seq !== appliedJumpSeq) {
        appliedJumpSeq = jump.seq;
        jumpCameraTo(camera.position, controls.target, jump, worldW, worldD, groundY);
        jumpPlacedCamera = true;
        markHoverDirty();
      }

      // Snapshot the pre-update pose: right-drag pans translate target and
      // camera rigidly through controls.update(), while orbiting and
      // cursor-anchored zooming move them apart — the post-update camera
      // clamp below needs to tell them apart.
      const preTargetX = controls.target.x;
      const preTargetZ = controls.target.z;
      const prePosX = camera.position.x;
      const prePosZ = camera.position.z;
      controls.update();
      const rigidPan = isRigidPan(
        controls.target.x - preTargetX,
        controls.target.z - preTargetZ,
        camera.position.x - prePosX,
        camera.position.z - prePosZ,
      );
      // Cursor-anchored zoom migrates the orbit target toward the cursor, so
      // re-clamp it to the map after the update (keyboard pan clamps before).
      // The camera rides the clamped delta (right-drag pan included) so the
      // viewing angle survives the edge instead of flipping backwards — and
      // the camera position itself is held inside the same world rectangle,
      // so orbiting/zooming can never swing the view off the map, unless a
      // minimap jump placed it: the exemption clears once the camera drifts
      // back inside, so gradual motion is still trimmed every tick. Rigid
      // pans carry the target with the clamped camera delta (the pan-back
      // wall: the target must stop with the camera, never catch it and warp
      // the angle); orbit/zoom reel the camera in alone so the focus stays.
      clampPanTargetWithCamera(controls.target, camera.position, worldW, worldD);
      if (jumpPlacedCamera && !isCameraOutsideWorld(camera.position, worldW, worldD)) {
        jumpPlacedCamera = false;
      }
      if (!jumpPlacedCamera) {
        if (rigidPan) clampCameraToWorldWithTarget(camera.position, controls.target, worldW, worldD);
        else clampCameraToWorld(camera.position, worldW, worldD);
      }
      // Terrain collision: the eye must never sink into the dirt or slip
      // under the water sheet. Cursor-anchored zoom flies the camera down
      // the pointer ray toward the surface, and low orbits skim the target
      // plane — OrbitControls' guardrails are target-relative and know
      // nothing about the terrain, so hold the final XZ column above the
      // local surface (ground, or water when it's shown and higher). No
      // jump exemption: an underground eye is never a valid request, and a
      // legitimate pose never touches this floor. The 6-unit clearance
      // rides above the ~2-unit swell crests on top of the water level.
      const surfaceY =
        opt.showWater && map.seaLevel > 0
          ? Math.max(groundY(camera.position.x, camera.position.z), water.position.y)
          : groundY(camera.position.x, camera.position.z);
      clampCameraAboveSurface(camera.position, surfaceY);
      // Focus collision: cursor-anchored zoom re-seats the orbit target
      // along the camera's downward forward ray every tick, so without a
      // floor of its own the target sinks hundreds of units underground
      // while the eye rides the clamp above — the offset stretches far
      // past the zoom floor and the view pitches fully vertical. Pin the
      // target's final column to the terrain (like minimap jumps, which
      // seat on the dirt rather than the water sheet) so the pair stays
      // rigid and close-ups keep their angle. No jump exemption, like
      // the eye floor: an underground focus is never a valid request.
      clampTargetAboveSurface(
        controls.target,
        groundY(controls.target.x, controls.target.z),
      );

      movement.update(dt);
      // Territory stamps: every live hull plus every live fort, every tick
      // (cheap discs — the field stays warm even while the overlay hides, so
      // toggling on shows live ground). The repaint + upload run at 4 Hz
      // inside, only while visible. UV-mapped, so no resnap on exaggeration
      // change. Wrecks keep their fading history (they simply stop stamping).
      territory.setVisible(opt.showTerritory, t);
      {
        const placed = units.userData.units as PlacedUnit[];
        const spots = movement.positions();
        const roster: InfluenceUnit[] = spots.map((p, i) => ({
          x: p.x,
          z: p.z,
          team: placed[i]?.team ?? 0,
          alive: !combat.isDestroyedAt(i),
        }));
        for (const s of hq?.status() ?? []) {
          roster.push({ x: s.x, z: s.z, team: s.team, alive: s.alive });
        }
        territory.update(roster, t, opt.showTerritory);
      }
      tracks.update(movement, dt);
      waypoints.setVisible(opt.showWaypoints);
      waypoints.update(movement, units.children.length, t);
      // Frustum gate for view-only per-unit work (the camera is final by
      // now): off-screen units skip occlusion sampling, ghost pose syncs,
      // and health-bar re-seats — the simulation underneath (drive, combat,
      // damage) runs ungated, and every gated readout re-syncs the same
      // tick its unit re-enters view. HQ bars stay ungated (two forts).
      const unitVisible = computeUnitVisibility(camera, units.children);
      health.setVisible(opt.showHealth);
      health.update(combat, units.children, camera, unitVisible);
      if (hq) {
        health.updateHq(
          hq,
          Array.from({ length: hq.count }, (_, i) => hq.groupAt(i)),
          camera,
        );
      }
      occlusion.update(
        camera.position,
        units.children,
        { groundY, stands: getStands() },
        combat,
        unitVisible,
      );
      combat.update(dt);
      // Feed live damage into the movement drive so idle hulls weigh remaining
      // health when deciding whether to engage, whom to pursue, and whether
      // to wait for backup (one tick stale: movement already ran this tick).
      movement.setDamage(combat.damageList());
      // HQ clocks, door slides, and releases run after combat so a kill and
      // a due release on the same tick resolve the wreck first.
      hq?.update(dt);
      // Graduated burns: advance core timers, re-pose only transitioned
      // trees (spread ignitions kick the shared light pool), then rebuild
      // the transient flame/smoke views from the persistent field.
      const dmgEv = tickDamage(damage, allTrees, dt, Math.random);
      for (const fid of dmgEv.ignited) {
        poseTree(fid);
        glowFire(fid);
      }
      for (const fid of dmgEv.enteredSmoulder) poseTree(fid);
      for (const r of dmgEv.resolved) {
        poseTree(r.index);
        fallen.add(r.index);
      }
      if (dmgEv.resolved.length > 0) dirtyStands();
      for (const fid of dmgEv.decayed) {
        poseTree(fid);
        fallen.delete(fid);
      }
      // Fallen-tree decay sink (husk pattern): every fallen trunk re-seats a
      // little lower each tick until `gone` hides it.
      for (const fid of fallen) poseTree(fid);
      fire.update(damage, allTrees, groundY, t);

      // Selection markers are static (posed in applySelection) — nothing to
      // animate per tick.

      // Order-ping decay (0.8 s expanding rings) and the ~4 Hz live-position
      // broadcast that feeds the minimap overlay.
      for (let i = pings.length - 1; i >= 0; i--) {
        const ping = pings[i]!;
        ping.t += dt;
        const k = ping.t / MOVE_PING_DURATION;
        if (k >= 1) {
          scene.remove(ping.mesh);
          (ping.mesh.material as THREE.Material).dispose();
          pings.splice(i, 1);
        } else {
          ping.mesh.scale.setScalar(movePingScale(k));
          (ping.mesh.material as THREE.MeshBasicMaterial).opacity = movePingOpacity(k);
        }
      }
      posTimer += dt;
      if (posTimer >= 0.25) {
        posTimer = 0;
        // Wrecks ride along with alive:false so the minimap drops their dots
        // and the Units-box counts drop them (the battlefield keeps the
        // husk mesh itself as its history).
        positionsRef.current?.(
          movement.positions().map((p, i) => ({ ...p, alive: !combat.isDestroyedAt(i) })),
        );
        hqRef.current?.(hq?.status() ?? []);
        // Territory paint for the minimap overlay (null while hidden clears
        // the canvas so stale ground never flashes on the next toggle-on).
        territoryRef.current?.(opt.showTerritory ? territory.minimap() : null);
      }

      // Hover probe: at most one math pick per tick, and only when the
      // pointer or the camera moved since the last probe (a parked cursor
      // costs nothing). The pick marches the heightfield analytically
      // (~400 bilinear taps worst case) instead of raycasting the full
      // 320×256 mesh (~163k triangles, no BVH) — sweeping the cursor no
      // longer dips fps 120 → ~80. NDC comes from the cached rect (no
      // layout read per probe) and the unproject reuses a scratch vector,
      // so the motion path allocates nothing. Emission is deduped on the
      // sampled cell, so React re-renders only when the readout changes.
      const probe = hoverGate.takeProbe();
      if (probe) {
        const rect = cachedCanvasRect;
        pointer.x = ((probe.x - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((probe.y - rect.top) / rect.height) * 2 + 1;
        hoverNdc.set(pointer.x, pointer.y, 0.5).unproject(camera);
        const dx = hoverNdc.x - camera.position.x;
        const dy = hoverNdc.y - camera.position.y;
        const dz = hoverNdc.z - camera.position.z;
        const hit = pickTerrainPoint(
          map,
          opt.exaggeration,
          camera.position.x,
          camera.position.y,
          camera.position.z,
          dx,
          dy,
          dz,
        );
        const info = hit ? hitToInfo(map, hit) : null;
        const key = hoverInfoKey(info);
        if (key !== lastHoverKey) {
          lastHoverKey = key;
          hoverRef.current(info);
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      movement.dispose();
      hq?.dispose();
      territory.dispose();
      tracks.dispose();
      waypoints.dispose();
      health.dispose();
      occlusion.dispose();
      disposeOcclusionAssets();
      combat.dispose();
      fire.dispose();
      fireflies.dispose();
      dayFog.dispose();
      selectionRef.current?.([]);
      positionsRef.current?.([]);
      hqRef.current?.([]);
      territoryRef.current?.(null);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      controls.removeEventListener("change", markHoverDirty);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      controls.dispose();
      renderer.dispose();
      disposeSelectionAssets();
      pingGeo.dispose();
      for (const ping of pings) {
        scene.remove(ping.mesh);
        (ping.mesh.material as THREE.Material).dispose();
      }
      if (boxEl.parentElement === wrap) wrap.removeChild(boxEl);
      geometry.dispose();
      waterGeo.dispose();
      terrainMat.dispose();
      waterMat.dispose();
      albedoTex.dispose();
      heightTex.dispose();
      disposeObject(trees);
      disposeObject(rocks);
      disposeObject(units);
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      wrap.removeChild(renderer.domElement);
    };
  }, [map]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <div
        ref={fpsRef}
        title="Frames per second"
        className="pointer-events-none absolute bottom-3 right-4 z-10 rounded-full border border-white/10 bg-black/40 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-slate-400 tabular-nums"
      >
        -- FPS
      </div>
    </div>
  );
}

function imageDataTexture(data: ImageData, mip: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  tex.generateMipmaps = mip;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function buildTerrainGeometry(map: TNTMap, exaggeration: number): THREE.BufferGeometry {
  const w = map.width;
  const h = map.height;
  const positions = new Float32Array(w * h * 3);
  const uvs = new Float32Array(w * h * 2);
  const indices: number[] = [];

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      positions[i * 3] = (x - (w - 1) / 2) * CELL_PIXELS;
      positions[i * 3 + 1] = worldHeight(map.heights[i] ?? 0, exaggeration);
      positions[i * 3 + 2] = (z - (h - 1) / 2) * CELL_PIXELS;
      uvs[i * 2] = x / (w - 1);
      uvs[i * 2 + 1] = 1 - z / (h - 1);
    }
  }
  for (let z = 0; z < h - 1; z++) {
    for (let x = 0; x < w - 1; x++) {
      const a = z * w + x;
      const b = a + 1;
      const c = (z + 1) * w + x;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function hitToInfo(map: TNTMap, point: { x: number; z: number }): HoverInfo {
  const x = clampInt(Math.round(point.x / CELL_PIXELS + (map.width - 1) / 2), 0, map.width - 1);
  const z = clampInt(Math.round(point.z / CELL_PIXELS + (map.height - 1) / 2), 0, map.height - 1);
  const hgt = map.heights[z * map.width + x] ?? 0;
  const h00 = hgt;
  const h10 = map.heights[z * map.width + Math.min(map.width - 1, x + 1)] ?? 0;
  const h01 = map.heights[Math.min(map.height - 1, z + 1) * map.width + x] ?? 0;
  const slope = Math.max(h00, h10, h01) - Math.min(h00, h10, h01);
  const tileW = map.width / 2;
  const tileIndex = map.tileMap[(z >> 1) * tileW + (x >> 1)] ?? 0;
  const featWord = map.features[z * map.width + x] ?? FEATURE_EMPTY;
  return {
    cellX: x,
    cellZ: z,
    height: hgt,
    slope,
    underwater: hgt < map.seaLevel,
    tileKind: map.tileKinds[tileIndex] ?? "grass",
    tileIndex,
    feature: featWord === FEATURE_EMPTY || featWord === FEATURE_FRINGE ? null : featureName(map, x, z),
    worldX: point.x,
    worldZ: point.z,
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
