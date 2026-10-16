import * as THREE from "three";

/**
 * Night fireflies: a drifting point-cloud of gently pulsating yellow-green
 * motes clustered around forest stands. Every mote pools its own little
 * halo onto the terrain and the trees (mirrored as shader uniforms — a
 * single field both materials alias), plus a few roaming PointLights ride
 * spread-out motes so dynamic Lambert objects catch the glow too. The
 * whole group only renders in night mode.
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
/**
 * Drift angular speed in rad/s: the lissajous wander circles each anchor
 * slightly faster than the original 0.35 amble — livelier motes, same
 * orbit shape and radius.
 */
export const FIREFLY_DRIFT_SPEED = 0.42;
/**
 * Ground-pool falloff radius (world units, mirrored in the shaders): each
 * mote's halo pools slightly tighter than the old 38, so one firefly
 * illuminates a smaller patch — while the roaming PointLights carry the
 * glow further (see FIREFLY_POOL_DISTANCE).
 */
export const FIREFLY_POOL_RADIUS = 34;
/** Pool tint shared by the terrain and tree shader terms (GLSL literal). */
export const FIREFLY_POOL_TINT_GLSL = "0.30, 0.40, 0.14";
/**
 * Ground-pool lights: one per spread-out mote, lamplight order — a gentle
 * halo fading with inverse-square decay, never a floodlight. These real
 * lights only cover dynamic Lambert objects (units, rocks); the terrain
 * and the trees mirror the full swarm, one pool slot per mote.
 */
export const FIREFLY_POOL_COUNT = 6;
export const FIREFLY_POOL_PEAK = 320;
/**
 * Roaming-pool light reach: the glow travels slightly further than the old
 * 150 cutoff — peak and decay untouched, so the near-field halo reads the
 * same and only the throw extends.
 */
export const FIREFLY_POOL_DISTANCE = 175;
export const FIREFLY_POOL_DECAY = 2;
/**
 * Per-mote share of the swarm's shader-pool light budget. Spreading the
 * pools from FIREFLY_POOL_COUNT slots over every mote must not multiply
 * the total ground light, so each mote pools at the old-slot fraction —
 * the swarm's total output stays at the tuned lamplight level while every
 * firefly now reflects.
 */
export const FIREFLY_POOL_SHARE = FIREFLY_POOL_COUNT / FIREFLY_COUNT;
/** Pulse-rate band in Hz: slow breathing (~3–8 s period), never a strobe. */
export const FIREFLY_RATE_MIN = 0.12;
export const FIREFLY_RATE_MAX = 0.32;
/** Glow pulse band: motes breathe between floor and floor + amp, never dark. */
export const FIREFLY_GLOW_FLOOR = 0.75;
export const FIREFLY_GLOW_AMP = 0.25;

export interface FireflyAnchor {
  x: number;
  y: number;
  z: number;
  /** Height above groundY at placement (for exaggeration re-snaps). */
  lift: number;
  /** Pulse phase 0..1. */
  phase: number;
  /** Pulse rate in Hz (FIREFLY_RATE_MIN..FIREFLY_RATE_MAX). */
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
      rate: FIREFLY_RATE_MIN + rng() * (FIREFLY_RATE_MAX - FIREFLY_RATE_MIN),
      radius: FIREFLY_DRIFT_RADIUS * (0.5 + rng() * 0.8),
    });
  }
  return anchors;
}

/**
 * Glow pulse 0..1 at time `t`: a pure slow sine, so each mote breathes
 * evenly — half the cycle waxing, half waning — instead of sitting dim and
 * flashing briefly. (Precedent: nanolathe's fire-flicker is a bounded
 * sine with a high floor and a per-source phase; same recipe here.)
 */
export function fireflyBlink(phase: number, rate: number, t: number): number {
  return 0.5 + 0.5 * Math.sin((t * rate + phase) * Math.PI * 2);
}

/**
 * Per-mote glow at time `t`: the pulse curve on a high floor, so motes
 * always glow and only breathe gently (FIREFLY_GLOW_FLOOR..FLOOR+AMP).
 * Shared by the sprite colors and the ground pools, so each pool pulses
 * with its own firefly.
 */
export function fireflyGlow(phase: number, rate: number, t: number): number {
  return FIREFLY_GLOW_FLOOR + FIREFLY_GLOW_AMP * fireflyBlink(phase, rate, t);
}

/**
 * Ground-pool falloff at distance `dist` (1 at the pool, 0.5 at
 * FIREFLY_POOL_RADIUS, → 0 far away). JS mirror of one mote's shader term
 * (terrain + trees) — those shaders ignore scene lights, so every mote's
 * halo is painted as an additive uniform slot, each scaled by
 * FIREFLY_POOL_SHARE to hold the swarm's total light budget.
 */
export function fireflyPoolGlow(dist: number): number {
  const k = Math.max(dist, 0) / FIREFLY_POOL_RADIUS;
  return 1 / (1 + k * k);
}

/**
 * Shared shader-field uniforms: one slot per mote. The terrain material
 * owns the uniform objects and the tree materials alias them (see
 * `applyFireflyTreeGlow`), so one `FireflyFx.writeField` per tick feeds
 * every mote's reflection on both surfaces.
 */
export interface FireflyFieldUniforms {
  pools: { value: THREE.Vector3[] };
  glows: { value: number[] };
}

/** GLSL pool-loop shared shape: falloff 1/(1+(d/radius)^2) over the field. */
function fireflyFieldLoop(worldExpr: string): string {
  return (
    `float ffPools = 0.0;\n` +
    `for (int i = 0; i < ${FIREFLY_COUNT}; i++) {\n` +
    `  ffPools += fireflyGlows[i] / (1.0 + pow(length(${worldExpr} - fireflyPools[i]) / ${FIREFLY_POOL_RADIUS}.0, 2.0));\n` +
    `}`
  );
}

/** Per-mote budget share as a constant-folded GLSL factor. */
function fireflyShareGLSL(): string {
  return `(${FIREFLY_POOL_COUNT}.0 / ${FIREFLY_COUNT}.0)`;
}

/**
 * Splice the world-position varying into a Lambert vertex shader (pure —
 * tested directly). Injected after `#include <project_vertex>` where
 * `transformed` is in scope; `instanceMatrix` folds in under
 * USE_INSTANCING so the instanced tree meshes report true world XZ.
 */
export function spliceFireflyTreeVertex(src: string): string {
  const head = `varying vec3 vFireflyWorld;\n`;
  const inject =
    `#include <project_vertex>\n` +
    `vec4 ffWorldPos = vec4( transformed, 1.0 );\n` +
    `#ifdef USE_INSTANCING\n` +
    `ffWorldPos = instanceMatrix * ffWorldPos;\n` +
    `#endif\n` +
    `vFireflyWorld = ( modelMatrix * ffWorldPos ).xyz;`;
  return head + src.replace("#include <project_vertex>", inject);
}

/**
 * Splice the mote-pool glow into a Lambert fragment shader (pure — tested
 * directly). Adds the same falloff loop + tint + budget share as the
 * terrain term to `totalEmissiveRadiance`, so tree bark and crowns catch
 * every mote's halo (fogged downstream like the rest of the surface).
 */
export function spliceFireflyTreeFragment(src: string): string {
  const head =
    `uniform vec3 fireflyPools[${FIREFLY_COUNT}];\n` +
    `uniform float fireflyGlows[${FIREFLY_COUNT}];\n` +
    `varying vec3 vFireflyWorld;\n`;
  const inject =
    `#include <emissivemap_fragment>\n` +
    `${fireflyFieldLoop("vFireflyWorld")}\n` +
    `totalEmissiveRadiance += vec3(${FIREFLY_POOL_TINT_GLSL}) * (ffPools * ${fireflyShareGLSL()});`;
  return head + src.replace("#include <emissivemap_fragment>", inject);
}

/**
 * Give a tree Lambert material the firefly field: every mote's halo adds
 * to the surface emissive. The uniform objects are aliased (not copied),
 * so the canvas's single per-tick mirror updates trees and terrain
 * together. The custom program-cache key keeps these programs distinct
 * from unmodified Lambert materials (rocks, units).
 */
export function applyFireflyTreeGlow(material: THREE.MeshLambertMaterial, field: FireflyFieldUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fireflyPools = field.pools;
    shader.uniforms.fireflyGlows = field.glows;
    shader.vertexShader = spliceFireflyTreeVertex(shader.vertexShader);
    shader.fragmentShader = spliceFireflyTreeFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => "firefly-tree-glow";
}

/** Drift offset around the anchor at time `t` (lissajous wander). */
export function fireflyDrift(radius: number, phase: number, t: number): { x: number; y: number; z: number } {
  const a = t * FIREFLY_DRIFT_SPEED + phase * Math.PI * 2;
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
  private readonly moteGlow: number[];
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
    this.moteGlow = new Array<number>(anchors.length).fill(0);
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
   * Per-pool glow 0..1 from the last update — each pool's own mote pulse,
   * driving its PointLight above.
   */
  poolGlows(): readonly number[] {
    return this.poolGlow;
  }

  /**
   * Mirror the full swarm into the shared shader field (terrain owns the
   * uniform objects, tree materials alias them): every mote's live
   * position plus its own pulse glow, so each firefly reflects against
   * both surfaces — not just the few near a roaming PointLight. Gated by
   * night; oversized slots zero out past the anchor count.
   */
  writeField(poolU: THREE.Vector3[], glowU: number[], night: boolean): void {
    const pos = this.positions.array as Float32Array;
    const n = Math.min(poolU.length, this.anchors.length);
    for (let i = 0; i < poolU.length; i++) {
      if (i < n) {
        poolU[i]!.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        glowU[i] = night ? (this.moteGlow[i] ?? 0) : 0;
      } else {
        glowU[i] = 0;
      }
    }
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
      this.moteGlow[i] = glow;
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
    // pulse, so the roaming light visibly comes from the fireflies.
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
