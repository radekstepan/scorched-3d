import { TEAM_DEFS, UNIT_DEFS, UNIT_KINDS, type TeamId, type UnitKind } from "@scorched-3d/core";
import * as THREE from "three";
import { buildUnitIconBody } from "./units";

/**
 * Bottom selection-tray icons.
 *
 * Each tray box shows a small 3D render of the actual unit mesh viewed from
 * the side and somewhat from above. The data URLs are rendered once per kind
 * and memoized in a module-level cache, so N selected hulls of one kind
 * share a single `<img>` source. Call `preloadUnitIcons()` (or the
 * non-blocking `scheduleUnitIconPreload()`) on load so the first selection
 * never pays render cost mid-gesture.
 *
 * Render chain per kind: offscreen WebGL thumbnail of the real hull
 * geometry (same `buildBody` + camo construction the battlefield uses) →
 * 2D side-silhouette canvas fallback → deterministic inline SVG side-view
 * fallback (node/vitest has no DOM canvas/WebGL). Either way the value is
 * cached by kind and reused for every tray box.
 */

const ICON_SIZE = 44;
/** Thumbnail render resolution (2x, downscaled by the <img> box). */
const THUMB_SIZE = 88;

const cache = new Map<UnitKind, string>();

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/**
 * Side + somewhat-above thumbnail camera: mostly +X (hull flank), elevated
 * ~30°, with a small +Z offset so the nose/barrel reads in depth instead of
 * foreshortening to a dot. Forward is +Z, so a pure side view looks down -X.
 */
export const UNIT_ICON_CAM_DIR = { x: 0.82, y: 0.52, z: 0.26 } as const;

export interface UnitIconFraming {
  /** Camera distance from the look target (world units). */
  distance: number;
  /** Look-target height (world units, above the ground anchor). */
  targetY: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

/**
 * Per-kind thumbnail framing (pure, testable). Tallest silhouette is the
 * commander (~47 u); longest throw is the hammer's elevated barrel. Tanks
 * share one framing, the walker gets a taller target, the gun a longer pull.
 */
export function unitIconFraming(kind: UnitKind): UnitIconFraming {
  switch (kind) {
    case "commander":
      return { distance: 118, targetY: 20, fov: 22 };
    case "hammer":
      return { distance: 132, targetY: 14, fov: 22 };
    case "stump":
      return { distance: 116, targetY: 10, fov: 22 };
    case "flash":
      return { distance: 104, targetY: 8, fov: 22 };
  }
}

/** Camera world position for a thumbnail framing (pure, testable). */
export function unitIconCameraPos(framing: UnitIconFraming): { x: number; y: number; z: number } {
  const len = Math.hypot(UNIT_ICON_CAM_DIR.x, UNIT_ICON_CAM_DIR.y, UNIT_ICON_CAM_DIR.z);
  const k = framing.distance / len;
  return {
    x: UNIT_ICON_CAM_DIR.x * k,
    y: framing.targetY + UNIT_ICON_CAM_DIR.y * k,
    z: UNIT_ICON_CAM_DIR.z * k,
  };
}

/** Shared offscreen thumbnail renderer (one per session, reused per kind). */
let thumbRenderer: THREE.WebGLRenderer | null = null;

function getThumbRenderer(): THREE.WebGLRenderer | null {
  try {
    if (thumbRenderer) return thumbRenderer;
    if (typeof document === "undefined") return null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
    thumbRenderer = renderer;
    return renderer;
  } catch {
    return null;
  }
}

/** Dispose the shared thumbnail renderer (tests / canvas teardown). */
export function disposeUnitIconRenderer(): void {
  try {
    thumbRenderer?.dispose();
  } catch {
    /* noop */
  }
  thumbRenderer = null;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geo = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    geo?.dispose();
    const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

/**
 * Offscreen 3D thumbnail: the real unit meshes (hull + turret + wheels/legs
 * + camo) lit like the battlefield, viewed from the side and somewhat from
 * above. Returns null when WebGL/DOM is unavailable — callers fall back to
 * the 2D side silhouette.
 */
function threeRender(kind: UnitKind): string | null {
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let body: THREE.Group | null = null;
  try {
    const renderer = getThumbRenderer();
    if (!renderer) return null;
    const framing = unitIconFraming(kind);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b141c);
    camera = new THREE.PerspectiveCamera(framing.fov, 1, 1, 2000);
    const pos = unitIconCameraPos(framing);
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(0, framing.targetY, 0);
    scene.add(new THREE.HemisphereLight(0xb8d4f0, 0x3a3424, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.6);
    sun.position.set(-40, 80, 30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    fill.position.set(60, 20, -50);
    scene.add(fill);
    body = buildUnitIconBody(kind);
    // Present a driving pose: turret forward (+Z), hammer keeps its
    // high-angle rest elevation — the silhouette then matches the field.
    body.rotation.set(0, 0, 0);
    scene.add(body);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL();
    return url;
  } catch {
    return null;
  } finally {
    if (body) disposeObject(body);
    scene?.clear();
    camera = null;
  }
}

/**
 * 2D side-silhouette fallback (DOM canvas, no WebGL): hull flank + wheels +
 * turret + horizontal barrel for tanks, legs + torso + head for the walker.
 * Reads as the same side + slightly-above view as the 3D thumbnail, just
 * flatter. Returns null outside a DOM (node/vitest → SVG fallback).
 */
function canvasRender(kind: UnitKind): string | null {
  try {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const def = UNIT_DEFS[kind];
    ctx.fillStyle = "#0b141c";
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    const body = hexCss(def.color);
    const accent = hexCss(def.accent);
    // Fake the slightly-from-above read: a darker ground strip + hull
    // shadow so the flank sits "on" dirt instead of floating.
    ctx.fillStyle = "#111c26";
    ctx.fillRect(0, 34, ICON_SIZE, 10);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(22, 34, 14, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (kind === "commander") {
      // Walker flank: two legs, torso block, head + sensor eye, antenna.
      ctx.fillStyle = body;
      ctx.fillRect(16, 24, 4, 10);
      ctx.fillRect(24, 24, 4, 10);
      ctx.fillRect(13, 12, 18, 12);
      ctx.fillStyle = accent;
      ctx.fillRect(13, 21, 18, 3);
      ctx.fillStyle = body;
      ctx.fillRect(18, 5, 8, 7);
      ctx.fillStyle = accent;
      ctx.fillRect(24, 7, 2, 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(26, 5);
      ctx.lineTo(29, 1);
      ctx.stroke();
    } else {
      // Tracked flank: hull side, road wheels, turret, barrel to the right
      // (+Z reads as screen-right in the side view).
      const hullY = kind === "flash" ? 24 : 23;
      const hullH = kind === "flash" ? 8 : 9;
      const hullW = kind === "hammer" ? 26 : 28;
      ctx.fillStyle = body;
      ctx.fillRect(22 - hullW / 2, hullY - hullH, hullW, hullH);
      if (kind !== "flash") {
        ctx.fillStyle = accent;
        ctx.fillRect(22 - hullW / 2, hullY - 2.5, hullW, 2.5);
      }
      ctx.fillStyle = "#3a3a40";
      for (const wx of [12, 22, 32]) {
        ctx.beginPath();
        ctx.arc(wx, hullY + 1, kind === "flash" ? 2.6 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const turretW = kind === "hammer" ? 10 : 12;
      const turretY = hullY - hullH - 5;
      ctx.fillStyle = kind === "hammer" ? accent : body;
      ctx.fillRect(22 - turretW / 2, turretY, turretW, 5);
      ctx.strokeStyle = accent;
      ctx.lineWidth = kind === "hammer" ? 3 : 2.2;
      ctx.beginPath();
      if (kind === "hammer") {
        // Elevated gun: climbs up-right like the 40° rest pose.
        ctx.moveTo(22, turretY + 2);
        ctx.lineTo(38, turretY - 10);
      } else {
        ctx.moveTo(22, turretY + 2.5);
        ctx.lineTo(39, turretY + 2.5);
      }
      ctx.stroke();
    }
    // Kind initial so boxes stay distinguishable at 44px.
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(def.name.slice(0, 1).toUpperCase(), 22, 43);
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

/** Deterministic side-view SVG fallback for headless (node/vitest) runs. */
function svgFallback(kind: UnitKind): string {
  const def = UNIT_DEFS[kind];
  const body = hexCss(def.color);
  const accent = hexCss(def.accent);
  const label = def.name.slice(0, 1).toUpperCase();
  const flank =
    kind === "commander"
      ? `<rect x="16" y="24" width="4" height="10" fill="${body}"/><rect x="24" y="24" width="4" height="10" fill="${body}"/>` +
        `<rect x="13" y="12" width="18" height="12" fill="${body}"/><rect x="13" y="21" width="18" height="3" fill="${accent}"/>` +
        `<rect x="18" y="5" width="8" height="7" fill="${body}"/><rect x="24" y="7" width="2" height="2" fill="${accent}"/>` +
        `<line x1="26" y1="5" x2="29" y2="1" stroke="${accent}" stroke-width="1.2"/>`
      : `<rect x="8" y="14" width="28" height="9" fill="${body}"/>` +
        (kind === "flash"
          ? ""
          : `<rect x="8" y="20.5" width="28" height="2.5" fill="${accent}"/>`) +
        `<circle cx="12" cy="24" r="3" fill="#3a3a40"/><circle cx="22" cy="24" r="3" fill="#3a3a40"/><circle cx="32" cy="24" r="3" fill="#3a3a40"/>` +
        `<rect x="${22 - (kind === "hammer" ? 5 : 6)}" y="9" width="${kind === "hammer" ? 10 : 12}" height="5" fill="${kind === "hammer" ? accent : body}"/>` +
        (kind === "hammer"
          ? `<line x1="22" y1="11" x2="38" y2="1" stroke="${accent}" stroke-width="3"/>`
          : `<line x1="22" y1="11.5" x2="39" y2="11.5" stroke="${accent}" stroke-width="2.2"/>`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 44 44">` +
    `<rect width="44" height="44" rx="6" fill="#0b141c"/>` +
    `<rect x="0" y="34" width="44" height="10" fill="#111c26"/>` +
    `<ellipse cx="22" cy="34" rx="14" ry="2.5" fill="rgba(0,0,0,0.45)"/>` +
    flank +
    `<text x="22" y="43" text-anchor="middle" font-family="monospace" font-size="8" fill="#cbd5e1">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Pre-rendered (and memoized) icon data URL for a unit kind. The first call
 * per kind renders (3D thumbnail → 2D side canvas → side SVG); every later
 * call reuses the cached URL.
 */
export function getUnitIconDataUrl(kind: UnitKind): string {
  const hit = cache.get(kind);
  if (hit) return hit;
  const url = threeRender(kind) ?? canvasRender(kind) ?? svgFallback(kind);
  cache.set(kind, url);
  return url;
}

/**
 * Render + cache every kind up front. Call once on load (e.g. in a React
 * effect) so the first tray open never pays thumbnail cost mid-gesture.
 * Synchronous and cheap (4 tiny offscreen renders, then pure cache hits).
 * Returns the number of cached icons.
 */
export function preloadUnitIcons(): number {
  for (const kind of UNIT_KINDS) getUnitIconDataUrl(kind);
  return cache.size;
}

/**
 * Non-blocking variant of `preloadUnitIcons`: renders one kind per idle
 * callback (or ~0 ms timeout where `requestIdleCallback` is unavailable),
 * so caching never blocks the main loop on load. Safe to call in a mount
 * effect; extra calls while a sweep is in flight are ignored.
 */
let preloadScheduled = false;
export function scheduleUnitIconPreload(): void {
  if (preloadScheduled) return;
  if (unitIconCacheSize() >= UNIT_KINDS.length) return;
  preloadScheduled = true;
  const pending = UNIT_KINDS.filter((k) => !cache.has(k));
  const step = (): void => {
    const next = pending.shift();
    if (next) {
      try {
        getUnitIconDataUrl(next);
      } catch {
        /* fallback chain already guards; never break load */
      }
    }
    if (pending.length > 0) {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (typeof ric === "function") ric(step);
      else setTimeout(step, 0);
    } else {
      preloadScheduled = false;
    }
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof ric === "function") ric(step);
  else setTimeout(step, 0);
}

/** Number of cached icon URLs (test hook). */
export function unitIconCacheSize(): number {
  return cache.size;
}

/** Drop the icon cache (tests / canvas teardown). */
export function clearUnitIconCache(): void {
  cache.clear();
  disposeUnitIconRenderer();
}

export interface SelectionGroup {
  kind: UnitKind;
  team: TeamId;
  count: number;
  indices: number[];
}

/**
 * Group a selection into tray boxes: one box per (kind, team) pair with a
 * count badge. Deterministic order: `UNIT_KINDS` order, then team id.
 * Unknown indices are skipped; wrecks are the caller's decision (the tray
 * passes live selection only — kills already drop from selection).
 */
export function groupSelection(
  units: readonly { kind: UnitKind; team?: TeamId }[],
  selection: readonly number[],
): SelectionGroup[] {
  const byKey = new Map<string, SelectionGroup>();
  for (const i of selection) {
    const u = units[i];
    if (!u) continue;
    const team: TeamId = u.team ?? 0;
    const key = `${u.kind}:${team}`;
    const g = byKey.get(key);
    if (g) {
      g.count += 1;
      g.indices.push(i);
    } else {
      byKey.set(key, { kind: u.kind, team, count: 1, indices: [i] });
    }
  }
  const kindRank = new Map<UnitKind, number>(UNIT_KINDS.map((k, r) => [k, r]));
  return [...byKey.values()].sort((a, b) => {
    const rk = (kindRank.get(a.kind) ?? 99) - (kindRank.get(b.kind) ?? 99);
    if (rk !== 0) return rk;
    return a.team - b.team;
  });
}

/** Team color CSS for a tray box top border (same source as the Units box chips). */
export function selectionGroupColor(team: TeamId): string {
  return hexCss(TEAM_DEFS[team]?.color ?? 0xffffff);
}
