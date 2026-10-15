/**
 * Static demo units modeled on Total Annihilation units from the sibling
 * nanolathe engine (a Go reimplementation of Total Annihilation).
 *
 * The demo renders a small subset of the TA catalog as non-moving meshes:
 * a construction kbot, two tanks, and a piece of artillery. Each entry keeps
 * the retail catalog name (`unitName`, e.g. ARMCOM) so the choice stays
 * traceable back to nanolathe's `UnitDef` records.
 */

export type UnitKind = "commander" | "stump" | "flash" | "hammer" | "peewee";

/**
 * Which weapon a shot was fired from: the kind's primary `round` (bolt or
 * shell per `WEAPON_PROFILES`) or the peewee's close-range `grenade` lob.
 * Splash lookups take it as an optional trailing argument defaulting to
 * `round`, so every legacy call site keeps its exact behavior.
 */
export type AttackMode = "round" | "grenade";

export interface UnitDef {
  kind: UnitKind;
  /** Retail catalog name as compiled by nanolathe (`content.UnitDef.UnitName`). */
  unitName: string;
  /** Short display name used by the HUD legend. */
  name: string;
  blurb: string;
  /** Base body color as 0xRRGGBB. */
  color: number;
  /** Trim/barrel accent color as 0xRRGGBB. */
  accent: number;
}

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  commander: {
    kind: "commander",
    unitName: "ARMCOM",
    name: "Commander",
    blurb: "Arm construction kbot. Tall biped, blue with yellow trim.",
    color: 0x2f6db3,
    accent: 0xf2c230,
  },
  stump: {
    kind: "stump",
    unitName: "ARMSTUMP",
    name: "Stumpy",
    blurb: "Arm medium assault tank. Olive hull, twin-gun turret read as one barrel.",
    color: 0x5a6b46,
    accent: 0x2c2c26,
  },
  flash: {
    kind: "flash",
    unitName: "ARMFLASH",
    name: "Flash",
    blurb: "Arm fast light tank. Small low hull, red trim.",
    color: 0x8a8f7a,
    accent: 0xb3392e,
  },
  hammer: {
    kind: "hammer",
    unitName: "ARMHAM",
    name: "Hammer",
    blurb: "Arm artillery. Dark hull with a long elevated orange barrel.",
    color: 0x4a4d55,
    accent: 0xd97b29,
  },
  peewee: {
    kind: "peewee",
    unitName: "ARMPW",
    name: "Peewee",
    blurb: "Arm light infantry kbot. Small biped scout, fast and fragile.",
    color: 0xa89c72,
    accent: 0x3a3f4a,
  },
};

export const UNIT_KINDS: UnitKind[] = ["commander", "stump", "flash", "hammer", "peewee"];

/** Which side of the demo battle a unit fights for (see `place.ts`). */
export type TeamId = 0 | 1;

/** Team identity: display name + base color as 0xRRGGBB. */
export interface TeamDef {
  id: TeamId;
  /** Short display name used by the HUD. */
  name: string;
  /** Base color as 0xRRGGBB (ground rings, HUD chips, minimap outlines). */
  color: number;
}

/**
 * The two demo sides. Blue vs orange is the color-blind-safe opposition
 * (same split the selection-contrast task picked: cyan/blue reads opposite
 * ember orange for most color-vision deficiency), and both sit clear of the
 * cyan selection core and the rose pursuit trail so team identity never
 * collides with selection or chase state.
 */
export const TEAM_DEFS: Record<TeamId, TeamDef> = {
  0: { id: 0, name: "Blue", color: 0x38bdf8 },
  1: { id: 1, name: "Orange", color: 0xfb923c },
};

export const TEAM_IDS: TeamId[] = [0, 1];

/** A unit placed on the attribute grid. Rotation is radians, 0..2π, about Y. */
export interface PlacedUnit {
  kind: UnitKind;
  cellX: number;
  cellZ: number;
  rotation: number;
  /** Which side of the demo battle the unit fights for (0 west, 1 east). */
  team: TeamId;
}
