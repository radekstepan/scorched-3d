import * as THREE from "three";

/**
 * Day ground-fog: a sparse scatter of soft white mist banks hugging the
 * terrain on day maps — here and there, never a blanket. Each patch is a
 * slow-drifting billboard sprite with a procedurally generated radial
 * falloff texture, so there are no hard edges and no DOM/canvas dependency
 * (the texture is a DataTexture, safe in headless/node tests).
 *
 * Placement is a pure function of (rng, world size, surfaceY): seeded, so
 * the same map + seed always yields the same banks. Fog pools in hollows —
 * each patch keeps the lowest of several candidates — and holds a wide
 * separation so banks stay scattered individuals.
 */

export const DAY_FOG_SEED_XOR = 0xd9f0;
/** Mist banks per map (one sprite each — a loose scatter, not a blanket). */
export const DAY_FOG_COUNT = 18;
/** Bank tint: plain white on a day map. */
export const DAY_FOG_TINT = 0xffffff;
/** Bank width band in world units. */
export const DAY_FOG_MIN_WIDTH = 220;
export const DAY_FOG_MAX_WIDTH = 420;
/** Banks lie low: sprite height is a fraction of the width. */
export const DAY_FOG_HEIGHT_RATIO = 0.32;
/** Height band above the surface the banks hover in. Floor 8 clears the max vertical bob (6.72). */
export const DAY_FOG_MIN_LIFT = 8;
export const DAY_FOG_MAX_LIFT = 20;
/** Peak sprite opacity — present but translucent, breathed down from here. */
export const DAY_FOG_MIN_PEAK = 0.12;
export const DAY_FOG_MAX_PEAK = 0.28;
/** Slow wander radius around each anchor. */
export const DAY_FOG_DRIFT_RADIUS = 48;
/** Min pairwise separation so banks stay loose individuals, not one mass. */
export const DAY_FOG_MIN_SEPARATION = 520;
/** Rejection-sample attempts per patch before accepting the last candidate. */
export const DAY_FOG_PLACE_TRIES = 12;
/** Candidates sampled per patch; the lowest surface wins (hollows first). */
export const DAY_FOG_HOLLOW_SAMPLES = 6;
/** Keep banks this far inside the map rectangle. */
export const DAY_FOG_EDGE_MARGIN = 320;
/** Opacity breathes between this fraction of peak and full peak. */
export const DAY_FOG_BREATH_FLOOR = 0.65;
/** Opacity breathing angular speed (rad/s, before the per-bank rate). */
export const DAY_FOG_BREATH_SPEED = 0.12;
/** Drift angular speed (rad/s) — a full wander takes ~90 s. */
export const DAY_FOG_DRIFT_SPEED = 0.07;
/** Procedural sprite texture resolution (square). */
export const DAY_FOG_TEX_SIZE = 64;

export interface DayFogAnchor {
  x: number;
  y: number;
  z: number;
  /** Height above surfaceY at placement (for exaggeration re-snaps). */
  lift: number;
  /** Sprite width in world units (height derives from the ratio). */
  width: number;
  /** Peak opacity 0..1 (the breath curve scales down from here). */
  peak: number;
  /** Drift/opacity phase 0..1. */
  phase: number;
  /** Opacity breathing rate multiplier. */
  rate: number;
  /** Drift orbit radius. */
  radius: number;
}

/**
 * Scatter `count` mist banks over the map rectangle (centered on the
 * origin, like the terrain mesh), keeping each bank inside the edge margin
 * and apart from the others. `surfaceY` is the bank rest surface — the
 * caller folds the water sheet in (max of ground and water level) so banks
 * over lakes read as lake mist instead of sinking under the sheet.
 */
export function placeDayFog(
  rng: () => number,
  worldW: number,
  worldD: number,
  count: number,
  surfaceY: (x: number, z: number) => number,
): DayFogAnchor[] {
  // Tiny worlds (tests) clamp the margin instead of inverting the rect.
  const mx = Math.max(0, Math.min(DAY_FOG_EDGE_MARGIN, worldW / 2 - 1));
  const mz = Math.max(0, Math.min(DAY_FOG_EDGE_MARGIN, worldD / 2 - 1));
  const anchors: DayFogAnchor[] = [];
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < DAY_FOG_PLACE_TRIES; attempt++) {
      const pick = pickHollow(rng, worldW, worldD, mx, mz, surfaceY);
      x = pick.x;
      z = pick.z;
      if (clearOfBanks(x, z, anchors)) break;
    }
    const lift = DAY_FOG_MIN_LIFT + rng() * (DAY_FOG_MAX_LIFT - DAY_FOG_MIN_LIFT);
    anchors.push({
      x,
      y: surfaceY(x, z) + lift,
      z,
      lift,
      width: DAY_FOG_MIN_WIDTH + rng() * (DAY_FOG_MAX_WIDTH - DAY_FOG_MIN_WIDTH),
      peak: DAY_FOG_MIN_PEAK + rng() * (DAY_FOG_MAX_PEAK - DAY_FOG_MIN_PEAK),
      phase: rng(),
      rate: 0.5 + rng() * 0.9,
      radius: DAY_FOG_DRIFT_RADIUS * (0.6 + rng() * 0.8),
    });
  }
  return anchors;
}

/** Lowest of HOLLOW_SAMPLES uniform candidates — fog settles in hollows. */
function pickHollow(
  rng: () => number,
  worldW: number,
  worldD: number,
  mx: number,
  mz: number,
  surfaceY: (x: number, z: number) => number,
): { x: number; z: number } {
  let bx = 0;
  let bz = 0;
  let best = Infinity;
  for (let s = 0; s < DAY_FOG_HOLLOW_SAMPLES; s++) {
    const x = (rng() * 2 - 1) * (worldW / 2 - mx);
    const z = (rng() * 2 - 1) * (worldD / 2 - mz);
    const h = surfaceY(x, z);
    if (h < best) {
      best = h;
      bx = x;
      bz = z;
    }
  }
  return { x: bx, z: bz };
}

/** True when (x, z) holds the min separation from every placed bank. */
function clearOfBanks(x: number, z: number, anchors: readonly DayFogAnchor[]): boolean {
  const sep2 = DAY_FOG_MIN_SEPARATION * DAY_FOG_MIN_SEPARATION;
  for (const a of anchors) {
    const dx = x - a.x;
    const dz = z - a.z;
    if (dx * dx + dz * dz < sep2) return false;
  }
  return true;
}

/** Slow lissajous wander around the anchor (vertical bob stays small). */
export function dayFogDrift(radius: number, phase: number, t: number): { x: number; y: number; z: number } {
  const a = t * DAY_FOG_DRIFT_SPEED + phase * Math.PI * 2;
  return {
    x: Math.cos(a) * radius,
    y: Math.sin(a * 1.7 + phase * 4) * radius * 0.1,
    z: Math.sin(a * 0.8 + phase * 2) * radius,
  };
}

/** Bank opacity at time `t`: slow breathing between floor*peak and peak. */
export function dayFogOpacity(peak: number, phase: number, rate: number, t: number): number {
  const s = 0.5 + 0.5 * Math.sin(t * DAY_FOG_BREATH_SPEED * rate + phase * Math.PI * 2);
  return peak * (DAY_FOG_BREATH_FLOOR + (1 - DAY_FOG_BREATH_FLOOR) * s);
}

/**
 * Sprite texel alpha 0..1 at normalized coords (u, v) in [-1, 1]: a smooth
 * radial puff with a gently wobbled rim so banks read irregular, never
 * coin-round. Pure math — the DataTexture builder samples this per texel.
 */
export function dayFogAlpha(u: number, v: number): number {
  const wobble =
    0.1 * Math.sin(3 * u + 1.7) * Math.sin(2.7 * v - 0.6) +
    0.07 * Math.sin(5.3 * v + 0.3) * Math.sin(4.1 * u + 1.1);
  const r = Math.hypot(u, v) * (1 + wobble);
  const t = Math.min(1, Math.max(0, 1 - r));
  return t * t * (3 - 2 * t);
}

/** RGBA bytes for the shared bank texture (opaque-white RGB, alpha puff). */
export function makeDayFogTextureData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const u = (ix / (size - 1)) * 2 - 1;
      const v = (iz / (size - 1)) * 2 - 1;
      const o = (iz * size + ix) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(dayFogAlpha(u, v) * 255);
    }
  }
  return data;
}

export class DayFogFx {
  private readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[] = [];
  private readonly texture: THREE.DataTexture;
  private readonly anchors: DayFogAnchor[];
  private readonly surfaceY: (x: number, z: number) => number;

  constructor(
    scene: THREE.Scene,
    anchors: DayFogAnchor[],
    surfaceY: (x: number, z: number) => number,
  ) {
    this.anchors = anchors;
    this.surfaceY = surfaceY;
    this.group.name = "day-fog";

    this.texture = new THREE.DataTexture(
      makeDayFogTextureData(DAY_FOG_TEX_SIZE),
      DAY_FOG_TEX_SIZE,
      DAY_FOG_TEX_SIZE,
    );
    this.texture.needsUpdate = true;

    for (const a of anchors) {
      // One material per bank (each breathes its own opacity), one shared
      // texture. Unlit white, depth-write off so banks never clip each
      // other or carve holes in the terrain behind them.
      const mat = new THREE.SpriteMaterial({
        map: this.texture,
        color: DAY_FOG_TINT,
        transparent: true,
        opacity: a.peak,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.name = "day-fog-bank";
      sprite.scale.set(a.width, a.width * DAY_FOG_HEIGHT_RATIO, 1);
      sprite.position.set(a.x, a.y, a.z);
      this.sprites.push(sprite);
      this.group.add(sprite);
    }

    this.update(0);
    scene.add(this.group);
  }

  /** Day owns the mist: visible by day, gone by night. */
  setNight(night: boolean): void {
    this.group.visible = !night;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Re-seat anchors after an exaggeration change (X/Z fixed, Y re-probed). */
  resnap(): void {
    for (const a of this.anchors) {
      a.y = this.surfaceY(a.x, a.z) + a.lift;
    }
  }

  update(t: number): void {
    if (!this.group.visible) return;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i]!;
      const sprite = this.sprites[i]!;
      const d = dayFogDrift(a.radius, a.phase, t);
      sprite.position.set(a.x + d.x, a.y + d.y, a.z + d.z);
      (sprite.material as THREE.SpriteMaterial).opacity = dayFogOpacity(a.peak, a.phase, a.rate, t);
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const sprite of this.sprites) {
      (sprite.material as THREE.Material).dispose();
    }
    this.texture.dispose();
  }
}
