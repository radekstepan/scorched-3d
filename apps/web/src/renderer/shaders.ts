// NOTE: the `exaggeration` uniforms below take the *effective* (rebased)
// value — `effectiveExaggeration(slider)` from core — so the GLSL math is
// unchanged by the height-scale rebase (new 1x = old 2x). The canvas passes
// the converted uniform; never feed the raw slider value here.
export const terrainVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vUv = uv;
    // World-space normal: the fragment shader reads N.y as world-up for the
    // slope/rock blend, the hemisphere mix, and the sun dot (sunDir is a
    // world-space uniform). A view-space normal (normalMatrix) would rotate
    // with the camera — top-down, flat ground reads N.y ~= 0 and renders
    // full brown rock; oblique, the same ground reads greener.
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vHeight = position.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const terrainFragment = /* glsl */ `
  uniform sampler2D mapTex;
  uniform sampler2D heightTex;
  uniform float seaLevel;
  uniform float exaggeration;
  uniform float showContours;
  uniform float showWater;
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec3 fireflyPools[6];
  uniform float fireflyGlows[6];

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  float wHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
      mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec3 albedo = texture2D(mapTex, vUv).rgb;
    vec3 N = normalize(vNormal);
    float slope = 1.0 - clamp(N.y, 0.0, 1.0);
    vec3 rock = vec3(0.30, 0.26, 0.22);
    albedo = mix(albedo, rock, smoothstep(0.38, 0.78, slope));

    float nDotL = max(dot(N, normalize(sunDir)), 0.0);
    float wrap = nDotL * 0.85 + 0.15;
    vec3 hemi = mix(groundColor, skyColor, N.y * 0.5 + 0.5);
    vec3 color = albedo * (hemi * 0.52 + sunColor * wrap * 0.78);

    float waterY = seaLevel * exaggeration;
    // Water toggle: with the surface hidden the seabed renders dry — the
    // wet tint + caustics would otherwise linger as animated "blotches".
    if (showWater > 0.5 && vWorld.y < waterY) {
      float depth = waterY - vWorld.y;
      float wet = clamp(depth * 0.025, 0.0, 0.82);
      color = mix(color, vec3(0.04, 0.16, 0.26), wet);
      // Warped, patch-masked caustics: light webs drift and pool instead
      // of tiling on a diagonal grid.
      vec2 cp = vWorld.xz + (vec2(
        wNoise(vWorld.xz * 0.012 + vec2(6.1, 2.9 + time * 0.02)),
        wNoise(vWorld.xz * 0.012 + vec2(15.3, 10.7 - time * 0.015))
      ) - 0.5) * 34.0;
      float ca = sin(dot(cp, vec2(0.10, 0.07)) + time * 0.5)
        + sin(dot(cp, vec2(-0.06, 0.08)) + time * 0.35);
      float caustic = pow(ca * 0.25 + 0.5, 4.0);
      caustic *= 0.5 + wNoise(vWorld.xz * 0.008 + vec2(time * 0.025, 3.3));
      // Depth ramp: caustic webs need a little water to focus in, so they
      // fade in over the first few units below the surface. Without the
      // ramp (1.0 - wet) is 1.0 right at the waterline and the webs switch
      // on at full strength there — a hard bright seam along the shore
      // with the last underwater tile reading lighter than the rest.
      color += caustic * (1.0 - wet) * smoothstep(0.0, 6.0, depth) * vec3(0.12, 0.28, 0.3);
    }

    if (showContours > 0.5) {
      float h = vHeight / max(exaggeration, 0.001);
      float band = abs(fract(h / 8.0) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.045, band);
      color = mix(color, vec3(0.95, 0.82, 0.35), line * 0.55);
      float seaBand = abs(h - seaLevel);
      color = mix(color, vec3(1.0, 0.28, 0.18), (1.0 - smoothstep(0.0, 1.2, seaBand)) * 0.85);
    }

    // Firefly ground pools: the terrain shader ignores scene lights, so
    // the roaming pool lights are mirrored here as additive glow (0 by
    // day). Falloff 1/(1+(d/38)^2) — see fireflyPoolGlow in fireflies.ts.
    // Each pool is a small gentle halo around its own mote: soft tint,
    // quick fade, so the swarm reads as scattered lamplight, not floods.
    vec3 poolTint = vec3(0.30, 0.40, 0.14);
    float pools = 0.0;
    for (int i = 0; i < 6; i++) {
      pools += fireflyGlows[i] / (1.0 + pow(length(vWorld - fireflyPools[i]) / 38.0, 2.0));
    }
    color += poolTint * pools;

    float dist = length(vWorld - cameraPosition);
    float fog = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    // Drifting haze: a slow wind-blown noise field breathes the fog factor
    // so distant banks crawl instead of sitting frozen. Relative modulation
    // keeps near-ground fog-free (0 stays 0) — mirrored by fogDriftFactor.
    float fogWobble = wNoise(vWorld.xz * 0.0009 + vec2(time * 0.008, time * -0.006)) - 0.5;
    fog = clamp(fog * (1.0 + fogWobble * 0.35), 0.0, 1.0);
    color = mix(color, fogColor, fog);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const waterVertex = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vView;

  float wHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
      mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    vec2 wpos = pos.xz;
    // Domain warp: a low-frequency noise offset ( terrain-style warping )
    // bends each swell layer, so crests meander instead of running straight.
    vec2 warp = vec2(
      wNoise(wpos * 0.006 + vec2(3.1, 17.7)),
      wNoise(wpos * 0.006 + vec2(9.2, 5.6))
    ) - 0.5;
    vec2 wp = wpos + warp * 90.0;
    float w1 = sin(dot(wp, vec2(0.94, 0.34)) * 0.018 + time * 0.6) * 0.7;
    float w2 = sin(dot(wp, vec2(-0.42, 0.91)) * 0.022 + time * 0.45) * 0.55;
    float w3 = sin(dot(wp, vec2(0.71, -0.71)) * 0.030 + time * 0.8) * 0.3;
    // Spatial swell envelope: some patches run high, others nearly flat.
    float ampMod = 0.7 + 0.6 * wNoise(wpos * 0.0025 + vec2(time * 0.025, -time * 0.015));
    pos.y += (w1 + w2 + w3) * ampMod;
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const waterFragment = /* glsl */ `
  uniform sampler2D heightTex;
  uniform float seaLevel;
  uniform float exaggeration;
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vView;

  float wHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
      mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    float terrainH = texture2D(heightTex, vUv).r * 255.0 * exaggeration;
    float waterY = seaLevel * exaggeration;
    float depth = waterY - terrainH;

    vec3 deepCol = vec3(0.02, 0.12, 0.22);
    vec3 shallowCol = vec3(0.18, 0.48, 0.52);
    vec3 color = mix(shallowCol, deepCol, clamp(depth / 90.0, 0.0, 1.0));

    vec3 V = normalize(vView);
    // Warped ripple domain: highlights wander instead of tiling.
    vec2 rp = vWorld.xz + (vec2(
      wNoise(vWorld.xz * 0.008 + vec2(time * 0.015, 0.0)),
      wNoise(vWorld.xz * 0.008 + vec2(13.7, 7.3 - time * 0.01))
    ) - 0.5) * 40.0;
    float r1 = sin(dot(rp, vec2(0.033, 0.022)) + time * 0.55);
    float r2 = sin(dot(rp, vec2(-0.019, 0.041)) - time * 0.45);
    float r3 = sin(dot(rp, vec2(0.028, -0.031)) + time * 0.85 + r1 * 1.3);
    vec3 N = normalize(vec3(
      (r1 * 0.7 + r3 * 0.5) * 0.12,
      1.0,
      (r2 * 0.7 - r3 * 0.5) * 0.12
    ));
    float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    color = mix(color, vec3(0.55, 0.75, 0.85), fresnel * 0.55);

    vec3 L = normalize(sunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 64.0);
    color += sunColor * spec * 0.65;

    float foam = 1.0 - smoothstep(0.0, 14.0 * (0.6 + 0.8 * wNoise(vWorld.xz * 0.01)), depth);
    vec2 fp = vWorld.xz + (vec2(
      wNoise(vWorld.xz * 0.015 + vec2(4.7, 1.3 + time * 0.025)),
      wNoise(vWorld.xz * 0.015 + vec2(11.9, 8.8 - time * 0.02))
    ) - 0.5) * 30.0;
    float f1 = sin(dot(fp, vec2(0.32, 0.24)) + time * 1.0);
    float f2 = sin(dot(fp, vec2(-0.21, 0.28)) - time * 0.8 + f1 * 1.1);
    float foamNoise = f1 * 0.55 + f2 * 0.35 + (wNoise(fp * 0.02 + time * 0.05) - 0.5) * 0.5;
    foam *= 0.65 + foamNoise * 0.35;
    // Foam patchiness: ragged noise mask so the shoreline breaks into
    // clumps instead of a uniform milky band.
    foam *= 0.5 + 0.8 * wNoise(vWorld.xz * 0.02 + vec2(time * 0.04, -time * 0.03));
    foam *= 0.65 + foamNoise * 0.35;
    color = mix(color, vec3(0.86, 0.94, 0.96), clamp(foam, 0.0, 0.85));

    float alpha = mix(0.42, 0.82, clamp(depth / 70.0, 0.0, 1.0));
    alpha = mix(alpha, 0.28, foam);
    alpha = max(alpha, fresnel * 0.35);

    float dist = length(vWorld - cameraPosition);
    float fog = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    // Same drifting haze as the terrain shader (mirrored by fogDriftFactor).
    float fogWobble = wNoise(vWorld.xz * 0.0009 + vec2(time * 0.008, time * -0.006)) - 0.5;
    fog = clamp(fog * (1.0 + fogWobble * 0.35), 0.0, 1.0);
    color = mix(color, fogColor, fog);

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Water swell layers mirrored from {@link waterVertex}: each layer scrolls
 * along its own (dx, dz) direction at its own speed, so the surface never
 * reads as one axis-aligned sheet sliding in a single direction.
 */
export interface WaterSwellLayer {
  dx: number;
  dz: number;
  freq: number;
  speed: number;
  amp: number;
}

export const WATER_SWELL_LAYERS: readonly WaterSwellLayer[] = [
  { dx: 0.94, dz: 0.34, freq: 0.018, speed: 0.6, amp: 0.7 },
  { dx: -0.42, dz: 0.91, freq: 0.022, speed: 0.45, amp: 0.55 },
  { dx: 0.71, dz: -0.71, freq: 0.03, speed: 0.8, amp: 0.3 },
];

/** JS mirror of the vertex-shader swell: surface height at (x, z, time). */
export function waterSurfaceHeight(x: number, z: number, time: number): number {
  const { wx, wz } = waterWarp(x, z);
  let h = 0;
  for (const l of WATER_SWELL_LAYERS) {
    h += Math.sin((wx * l.dx + wz * l.dz) * l.freq + time * l.speed) * l.amp;
  }
  return h * waterAmpMod(x, z, time);
}

/** Deterministic hash noise mirroring the GLSL wHash/wNoise helpers. */
function fract(v: number): number {
  return v - Math.floor(v);
}

export function waterHash(ix: number, iz: number): number {
  const px = fract(ix * 0.1031);
  const py = fract(iz * 0.1031);
  const pz = fract(ix * 0.1031);
  const d =
    px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  return fract((px + d + (py + d)) * (pz + d));
}

export function waterNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = waterHash(ix, iz);
  const b = waterHash(ix + 1, iz);
  const c = waterHash(ix, iz + 1);
  const d = waterHash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Swell domain warp: bends crest lines so they meander (world units). */
export function waterWarp(x: number, z: number): { wx: number; wz: number } {
  const ox = waterNoise(x * 0.006 + 3.1, z * 0.006 + 17.7) - 0.5;
  const oz = waterNoise(x * 0.006 + 9.2, z * 0.006 + 5.6) - 0.5;
  return { wx: x + ox * 90, wz: z + oz * 90 };
}

/** Spatial swell envelope in [0.7, 1.3]: some patches run high, others flat. */
export function waterAmpMod(x: number, z: number, time: number): number {
  return 0.7 + 0.6 * waterNoise(x * 0.0025 + time * 0.025, z * 0.0025 - time * 0.015);
}

/** Foam shoreline width in world units: varies patch to patch. */
export function waterFoamBand(x: number, z: number): number {
  return 14.0 * (0.6 + 0.8 * waterNoise(x * 0.01, z * 0.01));
}

/** Foam patchiness mask in [0.5, 1.3]: breaks the shoreline into clumps. */
export function waterFoamPatch(x: number, z: number, time: number): number {
  return 0.5 + 0.8 * waterNoise(x * 0.02 + time * 0.04, z * 0.02 - time * 0.03);
}

/**
 * JS mirror of the fragment-shader ripple normal (pre-fresnel/spec).
 * Two directional layers plus a third phase-warped by the first, so the
 * highlight field is a non-repeating interference pattern, not an x/z grid.
 */
export function waterRipple(x: number, z: number, time: number): { nx: number; nz: number } {
  const rx = x + (waterNoise(x * 0.008 + time * 0.015, z * 0.008) - 0.5) * 40;
  const rz = z + (waterNoise(x * 0.008 + 13.7, z * 0.008 + 7.3 - time * 0.01) - 0.5) * 40;
  const r1 = Math.sin(rx * 0.033 + rz * 0.022 + time * 0.55);
  const r2 = Math.sin(rx * -0.019 + rz * 0.041 - time * 0.45);
  const r3 = Math.sin(rx * 0.028 + rz * -0.031 + time * 0.85 + r1 * 1.3);
  const nx = (r1 * 0.7 + r3 * 0.5) * 0.12;
  const nz = (r2 * 0.7 - r3 * 0.5) * 0.12;
  const inv = 1 / Math.hypot(nx, 1, nz);
  return { nx: nx * inv, nz: nz * inv };
}

/** JS mirror of the fragment-shader foam breakup noise, in [-1, 1]. */
export function waterFoamNoise(x: number, z: number, time: number): number {
  const fx = x + (waterNoise(x * 0.015 + 4.7, z * 0.015 + 1.3 + time * 0.025) - 0.5) * 30;
  const fz = z + (waterNoise(x * 0.015 + 11.9, z * 0.015 + 8.8 - time * 0.02) - 0.5) * 30;
  const f1 = Math.sin(fx * 0.32 + fz * 0.24 + time * 1.0);
  const f2 = Math.sin(fx * -0.21 + fz * 0.28 - time * 0.8 + f1 * 1.1);
  const v = f1 * 0.55 + f2 * 0.35 + (waterNoise(fx * 0.02 + time * 0.05, fz * 0.02) - 0.5) * 0.5;
  return Math.max(-1, Math.min(1, v));
}

/**
 * JS mirror of the underwater-caustic depth mask in the terrain shader:
 * `(1 - wet) * smoothstep(0, 6, depth)` with `wet` the depth tint factor.
 * Zero exactly at the waterline (no brightness step against the dry side),
 * full strength a few units down, then decaying with the wet tint — so the
 * light webs fade in below the surface instead of seaming the shoreline.
 */
export function waterCausticMask(depth: number): number {
  const wet = Math.min(0.82, Math.max(0, depth * 0.025));
  const t = Math.min(1, Math.max(0, depth / 6.0));
  const ramp = t * t * (3 - 2 * t);
  return (1 - wet) * ramp;
}

/** JS mirror of the underwater caustic webs, in [0, 1.5]. */
export function waterCaustic(x: number, z: number, time: number): number {
  const cx = x + (waterNoise(x * 0.012 + 6.1, z * 0.012 + 2.9 + time * 0.02) - 0.5) * 34;
  const cz = z + (waterNoise(x * 0.012 + 15.3, z * 0.012 + 10.7 - time * 0.015) - 0.5) * 34;
  const ca =
    Math.sin(cx * 0.1 + cz * 0.07 + time * 0.5) + Math.sin(cx * -0.06 + cz * 0.08 + time * 0.35);
  const base = Math.pow(ca * 0.25 + 0.5, 4);
  return base * (0.5 + waterNoise(x * 0.008 + time * 0.025, z * 0.008 + 3.3));
}

/**
 * Drifting distance-haze field, mirrored from the terrain/water fragment
 * shaders: the linear distance fog is modulated by a wind-blown value-noise
 * field so far banks breathe and crawl instead of sitting frozen. Broad
 * cells (~1100 world units) scrolling at ~0.01 cells/s read as slow weather,
 * not shimmer; the relative modulation keeps near-ground fog-free.
 */
export const FOG_DRIFT_SCALE = 0.0009;
export const FOG_DRIFT_WIND_X = 0.008;
export const FOG_DRIFT_WIND_Z = -0.006;
export const FOG_DRIFT_AMP = 0.35;

/** Haze multiplier in [1-amp/2, 1+amp/2] at world (x, z) and time. */
export function fogDriftFactor(x: number, z: number, time: number): number {
  return (
    1 +
    (waterNoise(
      x * FOG_DRIFT_SCALE + time * FOG_DRIFT_WIND_X,
      z * FOG_DRIFT_SCALE + time * FOG_DRIFT_WIND_Z,
    ) -
      0.5) *
      FOG_DRIFT_AMP
  );
}

/** Distance-fog factor after the drifting haze, clamped to [0, 1]. */
export function applyFogDrift(fog: number, x: number, z: number, time: number): number {
  return Math.min(1, Math.max(0, fog * fogDriftFactor(x, z, time)));
}

export const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

export const skyFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform float nightMix;
  uniform float time;
  varying vec3 vDir;

  float skyHash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 zenith = mix(vec3(0.18, 0.36, 0.62), vec3(0.015, 0.04, 0.10), nightMix);
    vec3 horizon = mix(vec3(0.62, 0.78, 0.88), vec3(0.10, 0.16, 0.26), nightMix);
    vec3 ground = mix(vec3(0.28, 0.32, 0.30), vec3(0.02, 0.03, 0.05), nightMix);
    vec3 color = mix(horizon, zenith, pow(t, 1.15));
    if (dir.y < 0.0) color = mix(horizon, ground, clamp(-dir.y * 1.4, 0.0, 1.0));

    // Day sun / night moon share the light direction, so the disc always
    // sits where the directional light comes from.
    float sun = pow(max(dot(dir, normalize(sunDir)), 0.0), 48.0);
    vec3 disc = mix(vec3(1.0, 0.92, 0.72), vec3(0.92, 0.96, 1.0), nightMix);
    color += disc * sun * mix(0.85, 0.95, nightMix);
    float glow = pow(max(dot(dir, normalize(sunDir)), 0.0), 6.0);
    vec3 glowCol = mix(vec3(1.0, 0.7, 0.35), vec3(0.35, 0.5, 0.75), nightMix);
    color += glowCol * glow * mix(0.18, 0.12, nightMix);

    // Stars: sparse hashed cells above the horizon, twinkling gently.
    if (nightMix > 0.5 && dir.y > 0.0) {
      vec3 cell = floor(dir * 260.0);
      float h = skyHash(cell);
      float star = smoothstep(0.995, 1.0, h);
      float twinkle = 0.6 + 0.4 * sin(time * 2.0 + h * 40.0);
      color += vec3(0.85, 0.92, 1.0) * star * twinkle * smoothstep(0.02, 0.2, dir.y);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;
