/** TNT-shaped terrain (Total Annihilation map format) used by the Scorched 3D map pipeline. */

import type { PlacedUnit } from "../units/types.js";

export const TNT_VERSION = 0x2000;
export const CELL_PIXELS = 16;
export const TILE_PIXELS = 32;
export const FEATURE_EMPTY = 0xffff;
export const FEATURE_VOID = 0xfffc;
export const FEATURE_FRINGE = 0xfffe;

export type MapPreset = "greenreach" | "archipelago" | "highpass" | "caldera";

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
  /** Keyboard + right-drag pan multiplier (1 = default). */
  panSpeed: number;
  /** Scroll-wheel zoom multiplier (1 = default). */
  zoomSpeed: number;
}
