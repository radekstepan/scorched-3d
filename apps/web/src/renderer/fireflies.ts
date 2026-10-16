import * as THREE from "three";

/**
 * Night fireflies: a drifting point-cloud of blinking yellow-green motes
 * clustered around forest stands, plus a few roaming PointLights riding
 * spread-out motes so each firefly gently pools a little light on the
 * ground instead of being pure decoration. The whole group only renders
 * in night mode.
 *
 * Placement is a pure function of (rng, tree XZ, groundY): seeded, so the
 * same map + seed always yields the same swarm.
 */

/** Fireflies per map (one draw call — a single THREE.Points). */
export const FIREFLY_COUNT = 90;
/** Bioluminescence tint (warm yellow-green). */
export const FIREFLY_GLOW = 0xd4ff70;
/** Glow sprite size in world units (attenuated). */
export const FIREFLY_SIZE = 7;
/** Max horizontal scatter of a firefly from its anchor tree. */
export const FIREFLY_TREE_SPREAD = 42;
/**
 * Min horizontal clearance from any tree trunk at placement. Round crowns
 * reach ~18 units out, so 20 keeps anchors out of the wood (drift may
 * still graze a canopy edge mid-orbit — a flyby, not a stuck mote).
 */
export const FIREFLY_TREE_CLEAR = 20;
/** Rejection-sample attempts per mote before pushing out to the ring. */
export const FIREFLY_PLACE_TRIES = 8;
/** Height band above the ground the swarm occupies. */
export const FIREFLY_MIN_LIFT = 3;
export const FIREFLY_MAX_LIFT = 15;
/** Drift orbit radius around each anchor. */
export const FIREFLY_DRIFT_RADIUS = 9;
/** Ground-pool falloff radius (world units, mirrored in the terrain shader). */
export const FIREFLY_POOL_RADIUS = 38;
/**
 * Ground-pool lights: one per spread-out mote, lamplight order — a gentle
 * halo fading with inverse-square decay, never a floodlight.
 */
export const FIREFLY_POOL_COUNT = 6;
export const FIREFLY_POOL_PEAK = 320;
export const FIREFLY_POOL_DISTANCE = 150;
export const FIREFLY_POOL_DECAY = 2;

export interface FireflyAnchor {
  x: number;
  y: number;
  z: number;
  /** Height above groundY at placement (for exaggeration re-snaps). */
  lift: number;
  /** Blink phase 0..1. */
  phase: number;
  /** Blink rate multiplier. */
  rate: number;
  /** Drift orbit radius. */
  radius: number;
}

/** True when (x, z) clears every trunk by `FIREFLY_TREE_CLEAR`. */
function clearOfTrees(x: number, z: number, trees: readonly { x: number; z: number }[]): boolean {
  const clear2 = FIREFLY_TREE_CLEAR * FIREFLY_TREE_CLEAR;
  for (const t of trees) {
    const dx = x - t.x;
    const dz = z - t.z;
    if (dx * dx + dz * dz < clear2) return false;
  }
  return true;
}

/** Nearest trunk to (x, z) — the push-out source in dense stands. */
function nearestTree(x: number, z: number, trees: readonly { x: number; z: number }[]): { x: number; z: number } {
  let best = trees[0]!;
  let best2 = Infinity;
  for (const t of trees) {
    const dx = x - t.x;
    const dz = z - t.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best2) {
      best2 = d2;
      best = t;
    }
  }
  return best;
}

/**
 * Scatter `count` fireflies near random trees (strategic: forests read as
 * the glowing patches), keeping every anchor clear of the trunks so no
 * mote orbits forever inside a crown. With no trees on the map, fall back
 * to a loose ring around the map center so night still gets its motes.
 */
export function placeFireflies(
  rng: () => number,
  trees: readonly { x: number; z: number }[],
  count: number,
  groundY: (x: number, z: number) => number,
): FireflyAnchor[] {
  const anchors: FireflyAnchor[] = [];
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (trees.length > 0) {
      const t = trees[Math.floor(rng() * trees.length)]!;
      let px = t.x;
      let pz = t.z;
      let cleared = false;
      for (let attempt = 0; attempt < FIREFLY_PLACE_TRIES; attempt++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * FIREFLY_TREE_SPREAD;
        px = t.x + Math.cos(a) * r;
        pz = t.z + Math.sin(a) * r;
        if (clearOfTrees(px, pz, trees)) {
          cleared = true;
          break;
        }
      }
      if (!cleared) {
        // Dense stand with no clear gap: push out from the nearest trunk
        // to the clearance ring instead of inside the wood.
        const n = nearestTree(px, pz, trees);
        const dx = px - n.x;
        const dz = pz - n.z;
        const d = Math.hypot(dx, dz);
        if (d < FIREFLY_TREE_CLEAR) {
          if (d > 1e-6) {
            px = n.x + (dx / d) * FIREFLY_TREE_CLEAR;
            pz = n.z + (dz / d) * FIREFLY_TREE_CLEAR;
          } else {
            px = n.x + FIREFLY_TREE_CLEAR;
          }
        }
      }
      x = px;
      z = pz;
    } else {
      const a = rng() * Math.PI * 2;
      const r = 120 + rng() * 420;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    const lift = FIREFLY_MIN_LIFT + rng() * (FIREFLY_MAX_LIFT - FIREFLY_MIN_LIFT);
    anchors.push({
      x,
      y: groundY(x, z) + lift,
      z,
      lift,
      phase: rng(),
      rate: 0.5 + rng() * 0.9,
      radius: FIREFLY_DRIFT_RADIUS * (0.5 + rng() * 0.8),
    });
  }
  return anchors;
}

/**
 * Glow pulse 0..1 at time `t`: a slow sine cubed, so each mote spends most
 * of its cycle dim and flashes briefly — firefly-like, not strobe-like.
 */
export function fireflyBlink(phase: number, rate: number, t: number): number {
  const s = 0.5 + 0.5 * Math.sin((t * rate + phase) * Math.PI * 2);
  return s * s * s;
}

/**
 * Per-mote glow 0..1 at time `t`: the blink curve plus a faint ember floor
 * so traveling motes stay traceable between flashes. Shared by the sprite
 * colors and the ground pools, so each pool pulses with its own firefly.
 */
export function fireflyGlow(phase: number, rate: number, t: number): number {
  return 0.08 + 0.92 * fireflyBlink(phase, rate, t);
}

/**
 * Ground-pool falloff at distance `dist` (1 at the pool, 0.5 at
 * FIREFLY_POOL_RADIUS, → 0 far away). JS mirror of the terrain-shader term
 * — the custom terrain shader ignores scene lights, so the pools are also
 * painted as additive uniforms there.
 */
export function fireflyPoolGlow(dist: number): number {
  const k = Math.max(dist, 0) / FIREFLY_POOL_RADIUS;
  return 1 / (1 + k * k);
}

/** Drift offset around the anchor at time `t` (lissajous wander). */
export function fireflyDrift(radius: number, phase: number, t: number): { x: number; y: number; z: number } {
  const a = t * 0.35 + phase * Math.PI * 2;
  return {
    x: Math.cos(a) * radius,
    y: Math.sin(a * 1.7 + phase * 4) * radius * 0.25,
    z: Math.sin(a * 0.8 + phase * 2) * radius,
  };
}

export class FireflyFx {
  private readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly pools: THREE.PointLight[] = [];
  private readonly poolGlow: number[] = new Array<number>(FIREFLY_POOL_COUNT).fill(0);
  private readonly anchors: FireflyAnchor[];
  private readonly base = new THREE.Color(FIREFLY_GLOW);
  private readonly groundY: (x: number, z: number) => number;
  private readonly scratch = new THREE.Color();
  private meanGlow = 0;

  constructor(
    scene: THREE.Scene,
    anchors: FireflyAnchor[],
    groundY: (x: number, z: number) => number,
  ) {
    this.anchors = anchors;
    this.groundY = groundY;
    this.group.name = "fireflies";

    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(anchors.length * 3), 3);
    this.colors = new THREE.BufferAttribute(new Float32Array(anchors.length * 3), 3);
    geo.setAttribute("position", this.positions);
    geo.setAttribute("color", this.colors);
    const mat = new THREE.PointsMaterial({
      size: FIREFLY_SIZE,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = "firefly-points";
    this.points.frustumCulled = false;
    this.group.add(this.points);

    // Ground pools ride strided anchors across the swarm, so the light
    // pools sit inside actual mote clusters, not dead center.
    for (let i = 0; i < FIREFLY_POOL_COUNT; i++) {
      const light = new THREE.PointLight(
        FIREFLY_GLOW,
        FIREFLY_POOL_PEAK,
        FIREFLY_POOL_DISTANCE,
        FIREFLY_POOL_DECAY,
      );
      light.name = `firefly-pool-${i}`;
      const anchor = anchors[Math.floor((anchors.length * i) / FIREFLY_POOL_COUNT)] ?? { x: 0, y: 8, z: 0 };
      light.position.set(anchor.x, anchor.y, anchor.z);
      this.pools.push(light);
      this.group.add(light);
    }

    this.update(0);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Night owns the swarm: hidden by day, glowing by night. */
  setNight(night: boolean): void {
    this.group.visible = night;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Roaming ground-pool lights (driven by `update`). */
  poolLights(): readonly THREE.PointLight[] {
    return this.pools;
  }

  /**
   * Per-pool glow 0..1 from the last update — each pool's own mote blink,
   * mirrored into the terrain shader (the canvas gates all pools by night).
   */
  poolGlows(): readonly number[] {
    return this.poolGlow;
  }

  /** Swarm mean glow 0..1 from the last update (0 while hidden). */
  get glowLevel(): number {
    return this.group.visible ? this.meanGlow : 0;
  }

  /** Re-seat anchors after an exaggeration change (X/Z fixed, Y re-probed). */
  resnap(): void {
    for (const a of this.anchors) {
      a.y = this.groundY(a.x, a.z) + a.lift;
    }
  }

  update(t: number): void {
    if (!this.group.visible) return;
    const pos = this.positions.array as Float32Array;
    const col = this.colors.array as Float32Array;
    let glowSum = 0;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i]!;
      const d = fireflyDrift(a.radius, a.phase, t);
      pos[i * 3] = a.x + d.x;
      pos[i * 3 + 1] = a.y + d.y;
      pos[i * 3 + 2] = a.z + d.z;
      const glow = fireflyGlow(a.phase, a.rate, t);
      glowSum += glow;
      this.scratch.copy(this.base).multiplyScalar(glow);
      col[i * 3] = this.scratch.r;
      col[i * 3 + 1] = this.scratch.g;
      col[i * 3 + 2] = this.scratch.b;
    }
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
    const mean = this.anchors.length > 0 ? glowSum / this.anchors.length : 0;
    this.meanGlow = mean;
    // Each pool wanders with its own mote and breathes with that mote's
    // blink, so the ground light visibly comes from the fireflies.
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i]!;
      const anchor = this.anchors[Math.floor((this.anchors.length * i) / this.pools.length)];
      if (anchor) {
        const d = fireflyDrift(anchor.radius, anchor.phase, t);
        pool.position.set(anchor.x + d.x, anchor.y + d.y, anchor.z + d.z);
        this.poolGlow[i] = fireflyGlow(anchor.phase, anchor.rate, t);
      } else {
        this.poolGlow[i] = 0;
      }
      pool.intensity = FIREFLY_POOL_PEAK * (this.poolGlow[i] ?? 0);
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
