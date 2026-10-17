import type { TeamId } from "@scorched-3d/core";

/**
 * Team hull livery: full-hull team paint so sides read at gameplay distance,
 * not just via ground rings. Each unit builder takes an optional livery and
 * remaps its paint-family finishes (dominant paint + light secondary armor)
 * onto these colors at attach time; bare metal, recesses, optics, and small
 * functional accents (commander gold, flash marks, hammer breech orange) keep
 * their kind finishes so models stay recognizable.
 *
 * - Blue (`0`) reuses the commander hull blue (`0x3d719b`) exactly, so blue
 *   commanders look unchanged and the whole side matches its leader.
 * - Orange (`1`) is that same blue hue-rotated 180° into the team's
 *   established orange family (`0x9b673d`): identical saturation/lightness
 *   (43.5%/42.4%), hue 26.8° vs the `TEAM_DEFS` orange 27.0° — the same
 *   orange, muted to commander-blue vibrancy so both sides pop equally.
 *   The bright `TEAM_DEFS` oranges stay on UI layers (rings, flags, HUD,
 *   minimap) where small bright marks need to punch through fog.
 *
 * Panels are the paint lightened 35% toward white, preserving each model's
 * two-tone armor breaks in the team hue. Damage charring and wreck char
 * (`unitDamageFx`) key off stashed base colors, so team paint chars and dies
 * exactly like kind paint — wrecks still read as dead.
 */

const BLUE_PAINT = 0x3d719b;
const ORANGE_PAINT = 0x9b673d;
const BLUE_PANEL = 0x81a3be;
const ORANGE_PANEL = 0xbe9c81;

/** Dominant team hull paint per side, as 0xRRGGBB. */
export const TEAM_HULL_PAINT: Record<TeamId, number> = {
  0: BLUE_PAINT,
  1: ORANGE_PAINT,
};

/** Light secondary team armor per side, as 0xRRGGBB. */
export const TEAM_HULL_PANEL: Record<TeamId, number> = {
  0: BLUE_PANEL,
  1: ORANGE_PANEL,
};

/** Paint-family finishes a builder remaps onto the team livery. */
export interface TeamLivery {
  /** Dominant hull paint (replaces the kind's primary PAINT finish). */
  paint: number;
  /** Light secondary armor (replaces the kind's PANEL/EDGE finish). */
  panel: number;
}

/** Team livery of a roster side (falls back to blue for unknown sides). */
export function teamLivery(team: TeamId): TeamLivery {
  return {
    paint: TEAM_HULL_PAINT[team] ?? BLUE_PAINT,
    panel: TEAM_HULL_PANEL[team] ?? BLUE_PANEL,
  };
}
