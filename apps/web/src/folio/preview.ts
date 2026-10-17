import * as THREE from "three";
import { generateMap, composeAlbedoWindow, sampleHeightBilinear, worldHeight, CELL_PIXELS, type TNTMap, type UnitKind } from "@scorched-3d/core";
import { advanceLocomotion, buildTeamRing, getBarrel, getMuzzleTip } from "../renderer/units";

/** Fixed study field: deterministic Greenreach patch, safe to cache across folio visits. */
const PREVIEW_PRESET = "greenreach";
const PREVIEW_SEED = 24;
/** Preview plane half-extent in world units (PlaneGeometry 1400x1400). */
const PREVIEW_HALF_EXTENT = 700;
/** Study patch center as a fraction of the map grid. */
const PREVIEW_CENTER = 0.48;

export interface PreviewAlbedoWindow {
  tileX: number;
  tileZ: number;
  tilesW: number;
  tilesH: number;
}

/** Tile window covering every cell the preview plane can sample. */
export function previewAlbedoWindow(map: Pick<TNTMap, "width" | "height">): PreviewAlbedoWindow {
  const cx = map.width * PREVIEW_CENTER;
  const cz = map.height * PREVIEW_CENTER;
  const reach = PREVIEW_HALF_EXTENT / CELL_PIXELS;
  const tx0 = Math.floor((cx - reach) / 2);
  const tx1 = Math.ceil((cx + reach) / 2);
  const tz0 = Math.floor((cz - reach) / 2);
  const tz1 = Math.ceil((cz + reach) / 2);
  return { tileX: tx0, tileZ: tz0, tilesW: tx1 - tx0, tilesH: tz1 - tz0 };
}

interface PreviewTerrainSource {
  map: TNTMap;
  albedo: ImageData;
  window: PreviewAlbedoWindow;
}

/**
 * CPU-side study data, built once per session. Map generation + albedo
 * compose (~750ms, formerly a full 5120x4096 image) blocked folio entry and
 * every roster switch; the source is deterministic and GPU uploads stay
 * per-mount (fresh DataTexture each build), so sharing it is safe.
 */
let sourceCache: PreviewTerrainSource | null = null;

/** Drop the cached study map/albedo (tests). */
export function clearPreviewTerrainCache(): void {
  sourceCache = null;
}

function getPreviewTerrainSource(): PreviewTerrainSource {
  if (!sourceCache) {
    const map = generateMap(PREVIEW_PRESET, PREVIEW_SEED);
    const window = previewAlbedoWindow(map);
    sourceCache = {
      map,
      window,
      albedo: composeAlbedoWindow(map, window.tileX, window.tileZ, window.tilesW, window.tilesH),
    };
  }
  return sourceCache;
}

/** Textured Greenreach field and rock scatter from the Unit Workshop reference. */
export function buildPreviewTerrain(): THREE.Mesh {
  const { map, albedo, window } = getPreviewTerrainSource();
  const tex = new THREE.DataTexture(
    albedo.data,
    albedo.width,
    albedo.height,
    THREE.RGBAFormat,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  // Real Greenreach albedo and heights; the inspection pad is leveled under the hull.
  const cx = map.width * PREVIEW_CENTER,
    cz = map.height * PREVIEW_CENTER;
  // The albedo holds only the sampled tile window: map plane cells into it.
  const cellX0 = window.tileX * 2, cellsW = window.tilesW * 2;
  const cellZ0 = window.tileZ * 2, cellsH = window.tilesH * 2;
  const height = (x: number, z: number) =>
    worldHeight(
      sampleHeightBilinear(
        map,
        (cx - (map.width - 1) / 2) * CELL_PIXELS + x,
        (cz - (map.height - 1) / 2) * CELL_PIXELS + z,
      ),
      0.38,
    );
  const groundY = height(0, 0);
  const geo = new THREE.PlaneGeometry(1400, 1400, 112, 112);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute("position"),
    uv = geo.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    const dist = Math.hypot(x, z);
    const level = THREE.MathUtils.smoothstep(dist, 25, 100);
    p.setY(i, (height(x, z) - groundY) * level - 0.06);
    uv.setXY(
      i,
      (cx + x / CELL_PIXELS - cellX0) / cellsW,
      1 - (cz + z / CELL_PIXELS - cellZ0) / cellsH,
    );
  }
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  terrain.receiveShadow = true;
  terrain.name = "greenreach-study";
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x737867,
    roughness: 1,
    flatShading: true,
  });
  for (let i = 0; i < 28; i++) {
    const a = i * 2.39996,
      r = 48 + (i % 7) * 12;
    const x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(
      x,
      (height(x, z) - groundY) * THREE.MathUtils.smoothstep(r, 25, 100),
      z,
    );
    rock.scale.set(1.8 + (i % 3), 1.4 + (i % 4), 2.5 + (i % 3));
    rock.rotation.set(i * 0.4, i * 0.7, i * 0.2);
    rock.castShadow = true;
    terrain.add(rock);
  }
  return terrain;
}

/** Visual-only, deterministic workshop animation; never issues battle commands. */
export class PreviewAnimation {
  readonly effects = new THREE.Group();
  readonly ring = buildTeamRing(0);
  readonly flash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe7a1 }));
  readonly tracer = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffc76b }));
  private shotAge = Infinity;
  private firing = false;
  private barrel;
  private barrelZ: number;
  private direction = new THREE.Vector3();
  private muzzle = new THREE.Vector3();

  constructor(private body: THREE.Group, private kind: UnitKind) {
    this.barrel = getBarrel(body);
    this.barrelZ = this.barrel?.position.z ?? 0;
    this.ring.visible = false;
    this.ring.position.y = 0.15;
    this.flash.visible = this.tracer.visible = false;
    this.effects.add(this.ring, this.flash, this.tracer);
  }

  update(dt: number, motion: boolean, shooting: boolean, selection: boolean): void {
    const step = Math.max(0, Math.min(dt, 0.05));
    // Calling with zero travel settles walkers back to their neutral stance.
    advanceLocomotion(this.body, this.kind, motion ? step * 16 : 0, step);
    this.ring.visible = selection;
    if (shooting && (!this.firing || this.shotAge >= 2.4)) {
      this.shotAge = 0;
      const tip = getMuzzleTip(this.body);
      if (tip) {
        this.body.updateMatrixWorld(true);
        tip.getWorldPosition(this.muzzle);
        this.direction.set(0, 0, 1).transformDirection(tip.matrixWorld);
      }
    } else this.shotAge += step;
    this.firing = shooting;
    if (!shooting) this.shotAge = Infinity;
    const tip = getMuzzleTip(this.body);
    const age = this.shotAge;
    if (this.barrel) this.barrel.position.z = this.barrelZ - (age < 0.6 ? Math.sin(Math.min(age / 0.07, 1) * Math.PI / 2) * Math.exp(-age * 7) * 0.65 : 0);
    this.flash.visible = Boolean(tip) && age < 0.12;
    this.tracer.visible = Boolean(tip) && age < 0.65;
    if (this.flash.visible) {
      this.flash.position.copy(this.muzzle);
      this.flash.scale.setScalar(1 + (1 - age / 0.12) * 2);
    }
    if (this.tracer.visible) this.tracer.position.copy(this.muzzle).addScaledVector(this.direction, age * 140);
  }
}
