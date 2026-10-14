import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CELL_PIXELS,
  FEATURE_EMPTY,
  FEATURE_FRINGE,
  composeAlbedo,
  composeHeight,
  featureName,
  worldSize,
  type HoverInfo,
  type TNTMap,
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
import { buildUnits, placeUnitsGroup } from "./units";
import {
  PAN_SPEED_FACTOR,
  applyPan,
  clampPanTarget,
  isPanKey,
  panInputFromCodes,
  panOffset,
  shouldIgnoreKeyEvent,
} from "./cameraPan";
import { commanderCameraPose, pickStartUnit, resnapHeightDelta } from "./cameraStart";
import { createFpsSampler, formatFps } from "./fps";

const SUN = new THREE.Vector3(-0.8, 1.0, 0.25).normalize();

interface Props {
  map: TNTMap;
  options: ViewOptions;
  onHover: (info: HoverInfo | null) => void;
}

export default function TerrainCanvas({ map, options, onHover }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const optsRef = useRef(options);
  const hoverRef = useRef(onHover);
  optsRef.current = options;
  hoverRef.current = onHover;

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

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovering = false;

    const onMove = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      hovering = true;
    };
    const onLeave = () => {
      hovering = false;
      hoverRef.current(null);
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    // Keyboard pan: arrows / WASD translate camera + target in screen space.
    const pressed = new Set<string>();
    const onKeyDown = (ev: KeyboardEvent) => {
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
        applyExaggeration(geometry, map, lastExag);
        geometry.computeVertexNormals();
        water.position.y = map.seaLevel * lastExag + 0.6;
        placeFeatures(trees, rocks, map, lastExag);
        placeUnitsGroup(units, map, lastExag);
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
          const offset = panOffset(camera.position, controls.target, input, dist * PAN_SPEED_FACTOR * dt);
          applyPan(camera.position, controls.target, offset);
          clampPanTarget(controls.target, worldW, worldD);
        }
      }

      controls.update();

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
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      renderer.dispose();
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

function applyExaggeration(geo: THREE.BufferGeometry, map: TNTMap, exaggeration: number) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const w = map.width;
  const h = map.height;
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      pos.setY(i, (map.heights[i] ?? 0) * exaggeration);
    }
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

function cellWorld(map: TNTMap, x: number, z: number, exaggeration: number): THREE.Vector3 {
  return new THREE.Vector3(
    (x - (map.width - 1) / 2) * CELL_PIXELS,
    (map.heights[z * map.width + x] ?? 0) * exaggeration,
    (z - (map.height - 1) / 2) * CELL_PIXELS,
  );
}

function buildTrees(map: TNTMap, exaggeration: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "trees";

  const trunkGeo = new THREE.CylinderGeometry(2.2, 3.2, 18, 5);
  const canopyGeo = new THREE.IcosahedronGeometry(14, 0);
  const pineGeo = new THREE.ConeGeometry(11, 32, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2a16 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2d5a22 });
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x1f4a28 });

  const round: THREE.Vector3[] = [];
  const pines: THREE.Vector3[] = [];
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const word = map.features[z * map.width + x] ?? FEATURE_EMPTY;
      if (word > 2) continue;
      const p = cellWorld(map, x, z, exaggeration);
      if (word === 1) pines.push(p);
      else round.push(p);
    }
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(round.length + pines.length, 1));
  const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, Math.max(round.length, 1));
  const cones = new THREE.InstancedMesh(pineGeo, pineMat, Math.max(pines.length, 1));
  trunks.count = round.length + pines.length;
  canopies.count = round.length;
  cones.count = pines.length;
  const dummy = new THREE.Object3D();
  let ti = 0;
  round.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 9, p.z);
    dummy.scale.setScalar(0.85 + (i % 5) * 0.08);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    dummy.position.set(p.x, p.y + 24, p.z);
    dummy.scale.setScalar(0.9 + (i % 4) * 0.12);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  pines.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 9, p.z);
    dummy.scale.set(0.7, 1, 0.7);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    dummy.position.set(p.x, p.y + 28, p.z);
    dummy.scale.setScalar(0.85 + (i % 3) * 0.1);
    dummy.updateMatrix();
    cones.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate = true;
  trunks.frustumCulled = false;
  canopies.frustumCulled = false;
  cones.frustumCulled = false;
  group.add(trunks, canopies, cones);
  group.userData.positions = { round, pines };
  return group;
}

function buildRocks(map: TNTMap, exaggeration: number): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(9, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x6a5e50 });
  const pts: THREE.Vector3[] = [];
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const word = map.features[z * map.width + x] ?? FEATURE_EMPTY;
      if (word === 3 || word === 4) pts.push(cellWorld(map, x, z, exaggeration));
    }
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(pts.length, 1));
  mesh.name = "rocks";
  const dummy = new THREE.Object3D();
  pts.forEach((p, i) => {
    dummy.position.copy(p).add(new THREE.Vector3(0, 2, 0));
    dummy.rotation.set(i * 0.7, i * 1.1, i * 0.3);
    dummy.scale.setScalar(0.7 + (i % 5) * 0.18);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.positions = pts;
  mesh.count = pts.length;
  mesh.frustumCulled = false;
  return mesh;
}

function placeFeatures(trees: THREE.Group, rocks: THREE.InstancedMesh, map: TNTMap, exaggeration: number) {
  const dummy = new THREE.Object3D();
  const { round, pines } = trees.userData.positions as { round: THREE.Vector3[]; pines: THREE.Vector3[] };
  const trunks = trees.children[0] as THREE.InstancedMesh;
  const canopies = trees.children[1] as THREE.InstancedMesh;
  const cones = trees.children[2] as THREE.InstancedMesh;
  let ti = 0;
  round.forEach((p, i) => {
    const x = Math.round(p.x / CELL_PIXELS + (map.width - 1) / 2);
    const z = Math.round(p.z / CELL_PIXELS + (map.height - 1) / 2);
    const y = (map.heights[z * map.width + x] ?? 0) * exaggeration;
    dummy.position.set(p.x, y + 9, p.z);
    dummy.scale.setScalar(0.85 + (i % 5) * 0.08);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    dummy.position.set(p.x, y + 24, p.z);
    dummy.scale.setScalar(0.9 + (i % 4) * 0.12);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  pines.forEach((p, i) => {
    const x = Math.round(p.x / CELL_PIXELS + (map.width - 1) / 2);
    const z = Math.round(p.z / CELL_PIXELS + (map.height - 1) / 2);
    const y = (map.heights[z * map.width + x] ?? 0) * exaggeration;
    dummy.position.set(p.x, y + 9, p.z);
    dummy.scale.set(0.7, 1, 0.7);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    dummy.position.set(p.x, y + 28, p.z);
    dummy.scale.setScalar(0.85 + (i % 3) * 0.1);
    dummy.updateMatrix();
    cones.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate = true;

  const pts = rocks.userData.positions as THREE.Vector3[];
  pts.forEach((p, i) => {
    const x = Math.round(p.x / CELL_PIXELS + (map.width - 1) / 2);
    const z = Math.round(p.z / CELL_PIXELS + (map.height - 1) / 2);
    const y = (map.heights[z * map.width + x] ?? 0) * exaggeration;
    dummy.position.set(p.x, y + 2, p.z);
    dummy.rotation.set(i * 0.7, i * 1.1, i * 0.3);
    dummy.scale.setScalar(0.7 + (i % 5) * 0.18);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  });
  rocks.instanceMatrix.needsUpdate = true;
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
