import * as THREE from "three";
import { scorchDisplayRGB } from "@scorched-3d/core";

/**
 * High-contrast RTS selection visuals.
 *
 * The old single amber ring (0xfbbf24) drowned on burnt ground: the "brown
 * mud" under a selected unit is a persistent blast-scorch decal (see
 * `CombatFx`: cool-grey char core fading to a desaturated grey rim),
 * ringed by amber bolts/flashes/sparks/explosion lights and warm HUD chrome.
 * Pure luminance contrast of amber-on-scorch is fine (~9:1) — the failure is
 * hue camouflage (amber ring among amber fire on ember-brown ground) plus a
 * flat ground ring going edge-on at glancing camera angles and hiding under
 * smoke, flame cones, and toppled trunks.
 *
 * The replacement is a white-halo + cyan-core double ground ring (white reads
 * on every dark ground, cyan is hue-opposite to ember orange so it survives
 * fire glow and is blue/orange-separable for most color-vision deficiency),
 * a static chevron beacon above the hull (visible at glancing angles and
 * through smoke), and depth-test-off compositing above
 * the scorch layer. The beacon and rings are intentionally static — no
 * pulse, spin, or bob — so selection reads as a calm outline rather than a
 * flashing signal. The hull itself is never tinted: it keeps its normal
 * paint, including progressive damage charring, so a highlighted unit never
 * runs blue — selection reads from the ring + beacon (+ minimap dot) alone.
 * Shared geometries/materials
 * (one set per canvas, no per-frame allocations); the tick only mutates
 * scale/rotation/position of visible markers.
 *
 * Framework-free color math (luminance/contrast/hue) lives alongside the thin
 * three.js builders so vitest covers the contrast policy without WebGL.
 */

/** Outer halo: white reads on scorch, grass, water, and smoke. */
export const SELECTION_OUTER = 0xffffff;
/** Inner core: cyan is hue-opposite to ember orange / amber fire. */
export const SELECTION_CORE = 0x22d3ee;
/** Ring pulse frequency, Hz (legacy: selection is now static, see below). */
export const SELECTION_PULSE_HZ = 1.5;
/** Pulse amplitude as a fraction of ring size (legacy: static markers ignore it). */
export const SELECTION_PULSE_AMP = 0.07;
/** Selection compositing order: above scorch decals (`SCORCH_RENDER_ORDER`). */
export const SELECTION_RENDER_ORDER = 10;
/** Scorch decal render order in `CombatFx` (kept in sync by test). */
export const SCORCH_RENDER_ORDER = 2;
/** Chevron rest height above the body origin (clears the commander antenna). */
export const SELECTION_CHEVRON_HEIGHT = 52;
/** Chevron bob amplitude (legacy: static markers hold the rest height). */
export const SELECTION_CHEVRON_BOB = 4;
/** Chevron spin rate, rad/s (legacy: static markers hold a fixed yaw). */
export const SELECTION_CHEVRON_SPIN = 2.2;
/** Fixed chevron yaw for static markers (matches the build pose). */
export const SELECTION_CHEVRON_YAW = Math.PI / 4;

/** Ember-orange reference (ignition glow / explosion light family). */
export const EMBER_ORANGE = 0xff7a22;
/** Old selection amber, kept as a reference for contrast comparisons. */
export const LEGACY_AMBER = 0xfbbf24;

/** Minimap: selected dots get a white outline … */
export const MINIMAP_SELECTED_OUTLINE = "2px solid #ffffff";
/** … plus a cyan double glow (outer keyline + bloom). */
export const MINIMAP_SELECTED_GLOW = "0 0 0 2px #22d3ee, 0 0 8px #22d3ee";

function channel(hex: number, shift: number): number {
  return ((hex >> shift) & 0xff) / 255;
}

function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a 0xRRGGBB color. */
export function relativeLuminance(hex: number): number {
  const r = srgbToLinear(channel(hex, 16));
  const g = srgbToLinear(channel(hex, 8));
  const b = srgbToLinear(channel(hex, 0));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two 0xRRGGBB colors (1..21). */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue of a 0xRRGGBB color in degrees (0..360), for hue-separation checks. */
export function hueDegrees(hex: number): number {
  const r = channel(hex, 16);
  const g = channel(hex, 8);
  const b = channel(hex, 0);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/** Smallest angular hue distance between two 0xRRGGBB colors (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(hueDegrees(a) - hueDegrees(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Approximate scorch-decal sRGB triple for a core `intensity` (0..1): the
 * baked char-center color times the per-mark shade (see `craters.ts` +
 * `CombatFx.syncScorch`). Contrast math treats the triple as sRGB —
 * approximate past ACES tonemapping, but exact enough to pin the design
 * policy in tests.
 */
export function scorchToneRGB(intensity: number): [number, number, number] {
  return scorchDisplayRGB(intensity);
}

/** Pack an sRGB 0..1 triple back to 0xRRGGBB for the contrast helpers. */
export function rgbToHex(rgb: [number, number, number]): number {
  const q = (c: number): number => Math.max(0, Math.min(255, Math.round(c * 255)));
  return (q(rgb[0]) << 16) | (q(rgb[1]) << 8) | q(rgb[2]);
}

/** Ring scale at time `t` seconds: 1 ± amp, period 1/PULSE_HZ. */
export function selectionPulseScale(t: number): number {
  return 1 + SELECTION_PULSE_AMP * Math.sin(2 * Math.PI * SELECTION_PULSE_HZ * t);
}

/** Chevron vertical offset at time `t` (quadrature phase to the ring pulse). */
export function selectionBeaconBob(t: number): number {
  return SELECTION_CHEVRON_BOB * Math.sin(2 * Math.PI * SELECTION_PULSE_HZ * t + Math.PI / 2);
}

/**
 * Per-body marker visibility for a roster of `count` units: true exactly for
 * selected indices. Single click, shift-toggle, and box multi-select all
 * funnel through this mapping.
 */
export function markerVisibility(count: number, selection: readonly number[]): boolean[] {
  const set = new Set(selection);
  const out: boolean[] = new Array<boolean>(count);
  for (let i = 0; i < count; i++) out[i] = set.has(i);
  return out;
}

interface SelectionAssets {
  outerGeo: THREE.RingGeometry;
  coreGeo: THREE.RingGeometry;
  chevGeo: THREE.ConeGeometry;
  outerMat: THREE.MeshBasicMaterial;
  coreMat: THREE.MeshBasicMaterial;
  chevMat: THREE.MeshBasicMaterial;
}

let cached: SelectionAssets | null = null;

/**
 * Shared selection geometries/materials (one set per canvas). Markers built
 * from these share GPU resources; the tick only mutates transforms, so there
 * are no per-frame allocations. Pair with `disposeSelectionAssets()` on
 * canvas unmount (three.js dispose is idempotent, so the shared traverse in
 * `disposeObject` racing it is harmless).
 */
export function getSelectionAssets(): SelectionAssets {
  if (cached) return cached;
  const outerGeo = new THREE.RingGeometry(14, 22, 48);
  outerGeo.rotateX(-Math.PI / 2);
  const coreGeo = new THREE.RingGeometry(16.5, 20, 48);
  coreGeo.rotateX(-Math.PI / 2);
  const chevGeo = new THREE.ConeGeometry(5, 10, 4);
  const policy = { transparent: true, depthTest: false, depthWrite: false };
  const outerMat = new THREE.MeshBasicMaterial({
    color: SELECTION_OUTER,
    opacity: 0.95,
    ...policy,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: SELECTION_CORE,
    opacity: 0.95,
    ...policy,
  });
  const chevMat = new THREE.MeshBasicMaterial({ color: SELECTION_CORE, ...policy });
  cached = { outerGeo, coreGeo, chevGeo, outerMat, coreMat, chevMat };
  return cached;
}

/** Drop the shared selection assets (canvas unmount / regen). */
export function disposeSelectionAssets(): void {
  if (!cached) return;
  cached.outerGeo.dispose();
  cached.coreGeo.dispose();
  cached.chevGeo.dispose();
  cached.outerMat.dispose();
  cached.coreMat.dispose();
  cached.chevMat.dispose();
  cached = null;
}

/**
 * Build one selection marker: white outer halo + cyan core ground rings and
 * a static chevron beacon above the hull. Starts hidden; the body
 * group owns it so it rides patrol/order motion and exaggeration re-snaps
 * for free. Marker meshes carry `userData.noHighlight` so damage charring
 * (`applyUnitDamageTint`) never touches them.
 */
export function buildSelectionMarker(): THREE.Group {
  const assets = getSelectionAssets();
  const group = new THREE.Group();
  group.name = "select-marker";
  group.visible = false;
  const outer = new THREE.Mesh(assets.outerGeo, assets.outerMat);
  outer.name = "select-outer";
  outer.position.y = 1.5;
  outer.renderOrder = SELECTION_RENDER_ORDER;
  outer.userData.noHighlight = true;
  const core = new THREE.Mesh(assets.coreGeo, assets.coreMat);
  core.name = "select-core";
  core.position.y = 1.7;
  core.renderOrder = SELECTION_RENDER_ORDER + 1;
  core.userData.noHighlight = true;
  const chev = new THREE.Mesh(assets.chevGeo, assets.chevMat);
  chev.name = "select-chevron";
  chev.rotation.x = Math.PI;
  chev.rotation.y = Math.PI / 4;
  chev.position.y = SELECTION_CHEVRON_HEIGHT;
  chev.renderOrder = SELECTION_RENDER_ORDER + 2;
  chev.userData.noHighlight = true;
  group.add(outer, core, chev);
  return group;
}

/**
 * Pose one marker. Markers are static by design (no pulse/spin/bob): visible
 * markers hold unit ring scale and the chevron rest height + fixed yaw, so
 * selection reads as a calm outline. The `t` argument is kept so existing
 * call sites keep compiling; it is ignored. Mutation-only, no
 * allocations. `selectionPulseScale` / `selectionBeaconBob` stay exported
 * as documented legacy math (pinned by tests) but are no longer consumed.
 */
export function updateSelectionMarker(marker: THREE.Group, t: number, selected: boolean): void {
  void t;
  marker.visible = selected;
  if (!selected) return;
  const outer = marker.getObjectByName("select-outer");
  const core = marker.getObjectByName("select-core");
  const chev = marker.getObjectByName("select-chevron");
  if (outer) outer.scale.set(1, 1, 1);
  if (core) core.scale.set(1, 1, 1);
  if (chev) {
    chev.position.y = SELECTION_CHEVRON_HEIGHT;
    chev.rotation.y = SELECTION_CHEVRON_YAW;
  }
}

/**
 * Selection highlight entry point. Intentionally a no-op for the hull:
 * highlight is conveyed by the ring/beacon marker (plus the minimap dot)
 * only, so the hull keeps its normal paint — including damage charring — and
 * a highlighted unit never runs blue. Kept as a named function (rather than
 * deleting it) so call sites and tests pin the no-tint policy instead of
 * drifting back to emissive tricks.
 */
export function setBodyHighlight(_body: THREE.Object3D, _on: boolean): void {
  // No hull mutation by design (see above).
}
