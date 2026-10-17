/** TNT-shaped terrain (Total Annihilation map format) used by the Scorched 3D map pipeline. */

import type { PlacedUnit } from "../units/types.js";
import type { HqSite } from "../units/hq.js";

export const TNT_VERSION = 0x2000;
export const CELL_PIXELS = 16;
export const TILE_PIXELS = 32;
export const FEATURE_EMPTY = 0xffff;
export const FEATURE_VOID = 0xfffc;
export const FEATURE_FRINGE = 0xfffe;

export type MapPreset = "greenreach" | "archipelago" | "highpass" | "caldera" | "rivercross" | "dustplains";

export const PRESET_META: Record<
  MapPreset,
  { name: string; world: string; blurb: string }
> = {
  greenreach: {
    name: "Greenreach",
    world: "Greenhaven",
    blurb: "Lush island with a windward bay, rolling hills and a north ridge.",
  },
  archipelago: {
    name: "Gods Channel",
    world: "Archipelago",
    blurb: "Scattered volcanic isles in deep water, narrow beaches and cliffs.",
  },
  highpass: {
    name: "Ashen Pass",
    world: "The Pass",
    blurb: "Dry highland corridor between two plateaus. Sea level is zero.",
  },
  caldera: {
    name: "Glass Caldera",
    world: "Crystal Cracked",
    blurb: "Collapsed crater lake ringed by steep walls and a broken rim.",
  },
  rivercross: {
    name: "River Crossing",
    world: "Divided Forest",
    blurb: "Meandering river through forest and open plains, held by two ford crossings.",
  },
  dustplains: {
    name: "Dust Plains",
    world: "Open Steppe",
    blurb: "Wide flat steppe with gentle swells and scattered copses — built for armor battles.",
  },
};

export type TileKind =
  | "deep"
  | "shallow"
  | "wetSand"
  | "sand"
  | "dirt"
  | "grass"
  | "lush"
  | "darkGrass"
  | "rock"
  | "cliff"
  | "metal";

export interface FeatureRecord {
  name: string;
  kind: "tree" | "rock" | "metal";
}

export interface TNTMap {
  name: string;
  world: string;
  preset: MapPreset;
  seed: number;
  version: number;
  /** Attribute-grid width in 16-pixel cells. */
  width: number;
  /** Attribute-grid height in 16-pixel cells. */
  height: number;
  seaLevel: number;
  /** Corner heights, row-major, 0–255. */
  heights: Uint8Array;
  /** Feature words, row-major. */
  features: Uint16Array;
  /** Tile indices, (width/2) * (height/2). */
  tileMap: Uint16Array;
  /** Unique 32×32 indexed tiles. */
  tiles: Uint8Array[];
  tileKinds: TileKind[];
  featureTable: FeatureRecord[];
  palette: Uint8Array;
  /** Static demo units, re-placed deterministically on every generation. */
  units: PlacedUnit[];
  /** Sited HQ forts (one per team): the ground works were built for these. */
  hqs: HqSite[];
  minimap: {
    width: number;
    height: number;
    pixels: Uint8Array;
  };
}

export interface HoverInfo {
  cellX: number;
  cellZ: number;
  height: number;
  slope: number;
  underwater: boolean;
  tileKind: TileKind;
  tileIndex: number;
  feature: string | null;
  worldX: number;
  worldZ: number;
}

export interface ViewOptions {
  exaggeration: number;
  showWater: boolean;
  showFeatures: boolean;
  showWire: boolean;
  showContours: boolean;
  pixelFilter: boolean;
  /** Overlay each unit's patrol loop + live move-order path. */
  showWaypoints: boolean;
  /** Overhead health bars above each live unit. */
  showHealth: boolean;
  /** Territory overlay: each team's recent ground on the map + minimap. */
  showTerritory: boolean;
  /** Keyboard + right-drag pan multiplier (1 = default). */
  panSpeed: number;
  /** Scroll-wheel zoom multiplier (1 = default). */
  zoomSpeed: number;
  /** Moonlit night palette with fireflies instead of daylight. */
  nightMode: boolean;
}

/**
 * Base world-units-per-height-unit baked into the terrain mesh: the old
 * slider's 2x look is the new 1x baseline, so every raw height unit renders
 * `BASE_HEIGHT_SCALE * exaggeration` world units tall. The slider
 * (`MIN_EXAGGERATION`–`MAX_EXAGGERATION`) now speaks in these rebased units:
 * 1x matches the old 2x view exactly, and the full old 1–6 range maps to
 * the new 0.5–3.
 */
export const BASE_HEIGHT_SCALE = 2.0;

/** Lowest height-scale slider stop (renders the old 1x view). */
export const MIN_EXAGGERATION = 0.5;
/** Highest height-scale slider stop (renders the old 6x view). */
export const MAX_EXAGGERATION = 3.0;

/**
 * Default render-time height exaggeration (height-scale slider start).
 * 1x renders exactly the old 2x opening view (2 * 1), inside the rebased
 * 0.5–3 slider range.
 */
export const DEFAULT_EXAGGERATION = 1.0;

/**
 * Rendered world height of a raw heightfield unit under an exaggeration:
 * the rebase factor times the slider value. Single source of truth for the
 * raw→world mapping — geometry, water, anchors, seating, and shaders all
 * go through here (or `effectiveExaggeration`) so the slider can't drift
 * between subsystems.
 */
export function worldHeight(rawHeight: number, exaggeration: number): number {
  return rawHeight * BASE_HEIGHT_SCALE * exaggeration;
}

/**
 * Effective legacy-scale exaggeration for shader `exaggeration` uniforms
 * and other code that multiplies raw heights directly: the slider value
 * rebased back onto the old 1–6 scale the shaders were tuned against.
 */
export function effectiveExaggeration(exaggeration: number): number {
  return BASE_HEIGHT_SCALE * exaggeration;
}
