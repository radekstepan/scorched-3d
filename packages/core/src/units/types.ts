/**
 * Static demo units modeled on Total Annihilation units from the sibling
 * nanolathe engine (a Go reimplementation of Total Annihilation).
 *
 * The demo renders a small subset of the TA catalog as non-moving meshes:
 * a construction kbot, two tanks, and a piece of artillery. Each entry keeps
 * the retail catalog name (`unitName`, e.g. ARMCOM) so the choice stays
 * traceable back to nanolathe's `UnitDef` records.
 */

export type UnitKind = "commander" | "stump" | "flash" | "hammer";

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
};

export const UNIT_KINDS: UnitKind[] = ["commander", "stump", "flash", "hammer"];

/** A unit placed on the attribute grid. Rotation is radians, 0..2π, about Y. */
export interface PlacedUnit {
  kind: UnitKind;
  cellX: number;
  cellZ: number;
  rotation: number;
}
