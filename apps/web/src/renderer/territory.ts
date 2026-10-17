import * as THREE from "three";
import {
  createInfluenceField,
  factionColorBytes,
  paintInfluence,
  stampRoster,
  type InfluenceField,
  type InfluenceUnit,
} from "@scorched-3d/core";

/**
 * Territory overlay: the ground each team considers "theirs", painted both
 * onto the 3D terrain (a `DataTexture` the terrain shader mixes in by UV)
 * and onto the minimap (an RGBA copy React draws into an overlay canvas).
 *
 * One `TerritoryFx` owns the core influence field plus the shared texture.
 * Stamping runs every tick (a disc per live unit, ~20 coarse cells each —
 * far below a millisecond), while the full repaint + texture upload runs at
 * `TERRITORY_PAINT_INTERVAL` and only while the overlay is visible. Stamps
 * keep running while hidden (negligible cost) so toggling on shows live
 * ground instantly instead of a field that went cold in the dark.
 *
 * The texture is UV-mapped, so exaggeration re-snaps need no `resnap()` —
 * unlike line overlays, there is nothing to re-seat.
 */

/** Full-repaint cadence while visible: 4 Hz, matching the minimap broadcast. */
export const TERRITORY_PAINT_INTERVAL = 0.25;

export interface TerritoryMinimap {
  data: Uint8ClampedArray<ArrayBuffer>;
  cols: number;
  rows: number;
  /** Paint sequence: React redraws only when this advances. */
  seq: number;
}

export class TerritoryFx {
  readonly field: InfluenceField;
  readonly texture: THREE.DataTexture;
  private buffer: Uint8ClampedArray<ArrayBuffer>;
  private lastPaint = -Infinity;
  private seq = 0;
  private visible = false;
  private disposed = false;

  constructor(worldW: number, worldD: number) {
    this.field = createInfluenceField(worldW, worldD);
    this.buffer = new Uint8ClampedArray(this.field.cols * this.field.rows * 4);
    const texture = new THREE.DataTexture(this.buffer, this.field.cols, this.field.rows);
    // Row 0 is north in the paint; terrain v = 1 is north, so flip on upload.
    texture.flipY = true;
    // Linear sampling turns the coarse cells into smooth blobs on both
    // surfaces (the minimap canvas upscales the same way via CSS).
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    // No color-space decode: the bytes hit the screen as authored, so the 3D
    // tint matches the minimap hex exactly (unlike the sRGB albedo path).
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    this.texture = texture;
  }

  /**
   * Stamp the live roster, then repaint + re-upload when visible and the
   * cadence is due. `now` is render-loop seconds (same clock as the paint
   * freshness), matching the core field's timestamp unit.
   */
  update(units: readonly InfluenceUnit[], now: number, visible: boolean): void {
    if (this.disposed) return;
    stampRoster(this.field, units, now);
    if (!visible) return;
    if (this.seq > 0 && now - this.lastPaint < TERRITORY_PAINT_INTERVAL) return;
    this.paint(now);
  }

  /**
   * Toggle flips apply instantly: turning on repaints from the live field
   * immediately (the stamps never stopped) instead of waiting out the
   * cadence — the WaypointFx instant-toggle pattern.
   */
  setVisible(visible: boolean, now: number): void {
    const was = this.visible;
    this.visible = visible;
    if (visible && !was && !this.disposed) this.paint(now);
  }

  /** Fresh RGBA copy of the last paint for the minimap canvas (null = none). */
  minimap(): TerritoryMinimap | null {
    if (this.disposed || this.seq === 0) return null;
    return {
      data: this.buffer.slice(),
      cols: this.field.cols,
      rows: this.field.rows,
      seq: this.seq,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
  }

  private paint(now: number): void {
    this.lastPaint = now;
    this.seq += 1;
    paintInfluence(this.field, now, this.buffer, [factionColorBytes(0), factionColorBytes(1)]);
    this.texture.needsUpdate = true;
  }
}
