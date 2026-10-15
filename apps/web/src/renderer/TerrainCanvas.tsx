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
  FEATURE_EMPTY,
  FEATURE_FRINGE,
  composeAlbedo,
  composeHeight,
  featureName,
  igniteTree,
  planRoutes,
  sampleHeightBilinear,
  seatHull,
  tickDamage,
  worldSize,
  type BlastSlope,
  type Crater,
  type HoverInfo,
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
import { buildUnits } from "./units";
import { CombatFx } from "./combatFx";
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
import {
  applyPan,
  clampPanSpeed,
  clampPanTarget,
  clampZoomSpeed,
  isPanKey,
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
  SELECTION_CORE,
  buildSelectionMarker,
  disposeSelectionAssets,
  markerVisibility,
  updateSelectionMarker,
} from "./selectionFx";
import { OcclusionFx, disposeOcclusionAssets } from "./occlusionFx";
import { commanderCameraPose, pickStartUnit, resnapHeightDelta } from "./cameraStart";
import { createFpsSampler, formatFps } from "./fps";

const SUN = new THREE.Vector3(-0.8, 1.0, 0.25).normalize();

interface Props {
  map: TNTMap;
  options: ViewOptions;
  onHover: (info: HoverInfo | null) => void;
  /** Fired when the RTS selection changes (sorted unit indices). */
  onSelection?: (indices: number[]) => void;
  /** Live unit X/Z broadcast (~4 Hz) for the minimap overlay. */
  onPositions?: (positions: { x: number; z: number; alive: boolean }[]) => void;
}

export default function TerrainCanvas({ map, options, onHover, onSelection, onPositions }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const optsRef = useRef(options);
  const hoverRef = useRef(onHover);
  const selectionRef = useRef(onSelection);
  const positionsRef = useRef(onPositions);
  optsRef.current = options;
  hoverRef.current = onHover;
  selectionRef.current = onSelection;
  positionsRef.current = onPositions;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6aa0c8);

    const camera = new THREE.PerspectiveCamera(48, 1, 2, 14000);
    const { worldW, worldD } = worldSize(map);
    // Opening frame: behind a command unit, outside the map looking in.
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
    controls.minDistance = 80;
    controls.maxDistance = 4200;
    controls.panSpeed = clampPanSpeed(options.panSpeed);
    controls.zoomSpeed = clampZoomSpeed(options.zoomSpeed);
    // Cursor-anchored zoom: wheel/pinch dolly toward the ground point under
    // the cursor instead of the screen center, so zooming feels like leaning
    // into the spot being looked at. Stock OrbitControls behavior otherwise
    // (min/max distance, zoomSpeed, polar clamp all still apply); the target
    // it migrates is re-clamped to the map every tick below.
    controls.zoomToCursor = true;
    controls.target.set(startPose.target.x, startPose.target.y, startPose.target.z);

    const fogColor = new THREE.Color(0x8eb4c8);
    const fogNear = 1800;
    const fogFar = 6200;

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
        exaggeration: { value: options.exaggeration },
        showContours: { value: 0 },
        time: { value: 0 },
        sunDir: { value: SUN.clone() },
        sunColor: { value: new THREE.Color(1.0, 0.93, 0.78) },
        skyColor: { value: new THREE.Color(0.55, 0.7, 0.88) },
        groundColor: { value: new THREE.Color(0.18, 0.16, 0.1) },
        fogColor: { value: fogColor },
        fogNear: { value: fogNear },
        fogFar: { value: fogFar },
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
        exaggeration: { value: options.exaggeration },
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
    const waterGeo = new THREE.PlaneGeometry(worldW, worldD, 96, 72);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = map.seaLevel * options.exaggeration + 0.6;
    water.renderOrder = 1;
    scene.add(water);
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(8000, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: SUN.clone() } },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    scene.add(sky);

    const hemi = new THREE.HemisphereLight(0xb8d4f0, 0x3a3424, 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.15);
    sun.position.copy(SUN).multiplyScalar(1800);
    scene.add(sun);

    const trees = buildTrees(map, options.exaggeration);
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
      (sampleHeightBilinear(map, x, z) - craterDepthAt(craters, x, z)) *
      optsRef.current.exaggeration;
    const seat = (x: number, z: number, hull: number, kind: UnitKind) =>
      seatHull(map, kind, x, z, hull, optsRef.current.exaggeration);
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
    };
    const liveStands = (): TreeStand[] =>
      allTrees.map((p, fid) => {
        const state = damage.trees[fid] ?? "intact";
        return {
          x: p.x,
          z: p.z,
          groundY: groundY(p.x, p.z),
          standing: state === "intact" || state === "burning" || state === "smouldering",
        };
      });
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
      treeStands: liveStands,
      strikeTree: (fid: number) => {
        if (igniteTree(damage, fid)) {
          poseTree(fid);
          glowFire(fid);
        }
      },
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
    }, map, {
      field: damage,
      points: allTrees,
      onCrush: (fids) => {
        for (const fid of fids) {
          poseTree(fid);
          fallen.add(fid);
        }
      },
    });
    combat.setExternalHull(true);
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

    // RTS selection: a white-halo + cyan-core double ground ring plus a
    // spinning/bobbing chevron beacon above the hull (see selectionFx for
    // the contrast policy: the old amber ring was hue-camouflaged among
    // amber fire on ember-brown scorch, went edge-on at glancing angles, and
    // hid under smoke/toppled trunks). The hull itself is never tinted — it
    // keeps its normal paint including damage charring, so a highlighted
    // unit never runs blue; the ring + beacon (+ minimap dot) carry the
    // signal alone. The
    // marker is a child of the body group so it rides motion and
    // exaggeration re-snaps for free; rings/beacon ignore depth and composite
    // above the scorch layer. Shared geometries/materials, one set per
    // canvas — the tick only mutates transforms of visible markers.
    const markers: THREE.Group[] = [];
    units.children.forEach((child) => {
      const marker = buildSelectionMarker();
      child.add(marker);
      markers.push(marker);
    });
    let selection: number[] = [];
    let selTime = 0;
    const applySelection = (next: number[]): void => {
      // Wrecks are never selectable (belt-and-braces: picks already filter
      // them, but kills can land mid-gesture).
      selection = next.filter((i) => !combat.isDestroyedAt(i));
      const vis = markerVisibility(units.children.length, selection);
      units.children.forEach((child, i) => {
        const marker = child.getObjectByName("select-marker");
        if (marker) marker.visible = vis[i] ?? false;
      });
      selectionRef.current?.([...selection]);
    };
    // Unit death: freeze the mover as a husk and drop it from the
    // selection (combat sinks, gutters, and finally hides the charred
    // instance over its slow decay; the scorch scar stays).
    combat.onUnitKilled = (index) => {
      movement.markDestroyed(index);
      if (selection.includes(index)) {
        applySelection(selection.filter((s) => s !== index));
      }
    };
    // Hit-stun: a surviving splash hesitates that hull's drive for a
    // damage-scaled beat (the visible jerk back is the combat nudge rock;
    // this is the gameplay beat under it). Wrecks refuse the stun.
    combat.onUnitStunned = (index, damageAdd) => {
      movement.stunUnit(index, damageAdd);
    };

    // Move-order pings: short-lived expanding rings where an order landed.
    const pingGeo = new THREE.RingGeometry(10, 13, 40);
    pingGeo.rotateX(-Math.PI / 2);
    const pings: { mesh: THREE.Mesh; t: number }[] = [];
    const pingBase = new THREE.MeshBasicMaterial({
      color: SELECTION_CORE,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const addPing = (x: number, z: number): void => {
      if (pings.length >= 8) {
        const oldest = pings.shift();
        if (oldest) {
          scene.remove(oldest.mesh);
          (oldest.mesh.material as THREE.Material).dispose();
        }
      }
      const mesh = new THREE.Mesh(pingGeo, pingBase.clone());
      mesh.position.set(x, groundY(x, z) + 1.5, z);
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
    let hovering = false;

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
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      hovering = true;
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
      hovering = false;
      hoverRef.current(null);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
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
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let lastExag = options.exaggeration;
    let raf = 0;
    let posTimer = 1;
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
        water.position.y = map.seaLevel * lastExag + 0.6;
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
        tracks.resnap();
        waypoints.resnap();
        combat.reseatScorch();
      }

      terrainMat.uniforms.exaggeration!.value = opt.exaggeration;
      terrainMat.uniforms.showContours!.value = opt.showContours ? 1 : 0;
      terrainMat.uniforms.time!.value = t;
      waterMat.uniforms.exaggeration!.value = opt.exaggeration;
      waterMat.uniforms.time!.value = t;
      water.visible = opt.showWater && map.seaLevel > 0;
      trees.visible = opt.showFeatures;
      rocks.visible = opt.showFeatures;
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
          clampPanTarget(controls.target, worldW, worldD);
        }
      }

      // View-menu sliders: OrbitControls reads panSpeed/zoomSpeed live, so
      // re-sync every tick (options arrive via ref, not effect re-runs).
      if (controls.panSpeed !== clampPanSpeed(opt.panSpeed)) {
        controls.panSpeed = clampPanSpeed(opt.panSpeed);
      }
      if (controls.zoomSpeed !== clampZoomSpeed(opt.zoomSpeed)) {
        controls.zoomSpeed = clampZoomSpeed(opt.zoomSpeed);
      }

      controls.update();
      // Cursor-anchored zoom migrates the orbit target toward the cursor, so
      // re-clamp it to the map after the update (keyboard pan clamps before).
      clampPanTarget(controls.target, worldW, worldD);

      movement.update(dt);
      tracks.update(movement, dt);
      waypoints.setVisible(opt.showWaypoints);
      waypoints.update(movement, units.children.length, t);
      health.setVisible(opt.showHealth);
      health.update(combat, units.children, camera);
      occlusion.update(camera.position, units.children, { groundY, stands: liveStands() }, combat);
      combat.update(dt);
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
      for (const fid of dmgEv.decayed) {
        poseTree(fid);
        fallen.delete(fid);
      }
      // Fallen-tree decay sink (husk pattern): every fallen trunk re-seats a
      // little lower each tick until `gone` hides it.
      for (const fid of fallen) poseTree(fid);
      fire.update(damage, allTrees, groundY, t);

      // Selection pulse: advance the shared clock and mutate only visible
      // markers (ring scale, chevron bob/spin — no allocations).
      selTime += dt;
      for (const i of selection) {
        const marker = markers[i];
        if (marker) updateSelectionMarker(marker, selTime, true);
      }

      // Order-ping decay (0.8 s expanding rings) and the ~4 Hz live-position
      // broadcast that feeds the minimap overlay.
      for (let i = pings.length - 1; i >= 0; i--) {
        const ping = pings[i]!;
        ping.t += dt;
        const k = ping.t / 0.8;
        if (k >= 1) {
          scene.remove(ping.mesh);
          (ping.mesh.material as THREE.Material).dispose();
          pings.splice(i, 1);
        } else {
          ping.mesh.scale.setScalar(1 + k * 2.5);
          (ping.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        }
      }
      posTimer += dt;
      if (posTimer >= 0.25) {
        posTimer = 0;
        // Wrecks ride along so the minimap can dim them instead of dropping
        // them (the battlefield keeps its history).
        positionsRef.current?.(
          movement.positions().map((p, i) => ({ ...p, alive: !combat.isDestroyedAt(i) })),
        );
      }

      if (hovering) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(terrain);
        if (hits[0]) {
          hoverRef.current(hitToInfo(map, hits[0].point));
        } else {
          hoverRef.current(null);
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      movement.dispose();
      tracks.dispose();
      waypoints.dispose();
      health.dispose();
      occlusion.dispose();
      disposeOcclusionAssets();
      combat.dispose();
      fire.dispose();
      selectionRef.current?.([]);
      positionsRef.current?.([]);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      controls.dispose();
      renderer.dispose();
      disposeSelectionAssets();
      pingGeo.dispose();
      pingBase.dispose();
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
      positions[i * 3 + 1] = (map.heights[i] ?? 0) * exaggeration;
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

function hitToInfo(map: TNTMap, point: THREE.Vector3): HoverInfo {
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
