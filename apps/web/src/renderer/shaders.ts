export const terrainVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
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
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

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
    if (vWorld.y < waterY) {
      float depth = waterY - vWorld.y;
      float wet = clamp(depth * 0.025, 0.0, 0.82);
      color = mix(color, vec3(0.04, 0.16, 0.26), wet);
      float ca = sin(dot(vWorld.xz, vec2(0.10, 0.07)) + time)
        + sin(dot(vWorld.xz, vec2(-0.06, 0.08)) + time * 0.7);
      float caustic = pow(ca * 0.25 + 0.5, 4.0);
      color += caustic * (1.0 - wet) * vec3(0.12, 0.28, 0.3);
    }

    if (showContours > 0.5) {
      float h = vHeight / max(exaggeration, 0.001);
      float band = abs(fract(h / 8.0) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.045, band);
      color = mix(color, vec3(0.95, 0.82, 0.35), line * 0.55);
      float seaBand = abs(h - seaLevel);
      color = mix(color, vec3(1.0, 0.28, 0.18), (1.0 - smoothstep(0.0, 1.2, seaBand)) * 0.85);
    }

    float dist = length(vWorld - cameraPosition);
    float fog = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    color = mix(color, fogColor, fog);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const waterVertex = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vView;

  void main() {
    vUv = uv;
    vec3 pos = position;
    vec2 wpos = pos.xz;
    float w1 = sin(dot(wpos, vec2(0.94, 0.34)) * 0.018 + time * 1.15) * 1.35;
    float w2 = sin(dot(wpos, vec2(-0.42, 0.91)) * 0.022 + time * 0.85) * 1.05;
    float w3 = sin(dot(wpos, vec2(0.71, -0.71)) * 0.030 + time * 1.6) * 0.55;
    pos.y += w1 + w2 + w3;
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

  void main() {
    float terrainH = texture2D(heightTex, vUv).r * 255.0 * exaggeration;
    float waterY = seaLevel * exaggeration;
    float depth = waterY - terrainH;

    vec3 deepCol = vec3(0.02, 0.12, 0.22);
    vec3 shallowCol = vec3(0.18, 0.48, 0.52);
    vec3 color = mix(shallowCol, deepCol, clamp(depth / 90.0, 0.0, 1.0));

    vec3 V = normalize(vView);
    float r1 = sin(dot(vWorld.xz, vec2(0.033, 0.022)) + time * 1.1);
    float r2 = sin(dot(vWorld.xz, vec2(-0.019, 0.041)) - time * 0.9);
    float r3 = sin(dot(vWorld.xz, vec2(0.028, -0.031)) + time * 1.7 + r1 * 1.3);
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

    float foam = 1.0 - smoothstep(0.0, 14.0, depth);
    float f1 = sin(dot(vWorld.xz, vec2(0.32, 0.24)) + time * 2.0);
    float f2 = sin(dot(vWorld.xz, vec2(-0.21, 0.28)) - time * 1.6 + f1 * 1.1);
    float foamNoise = f1 * 0.6 + f2 * 0.4;
    foam *= 0.65 + foamNoise * 0.35;
    color = mix(color, vec3(0.86, 0.94, 0.96), clamp(foam, 0.0, 0.85));

    float alpha = mix(0.42, 0.82, clamp(depth / 70.0, 0.0, 1.0));
    alpha = mix(alpha, 0.28, foam);
    alpha = max(alpha, fresnel * 0.35);

    float dist = length(vWorld - cameraPosition);
    float fog = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
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
  { dx: 0.94, dz: 0.34, freq: 0.018, speed: 1.15, amp: 1.35 },
  { dx: -0.42, dz: 0.91, freq: 0.022, speed: 0.85, amp: 1.05 },
  { dx: 0.71, dz: -0.71, freq: 0.03, speed: 1.6, amp: 0.55 },
];

/** JS mirror of the vertex-shader swell: surface height at (x, z, time). */
export function waterSurfaceHeight(x: number, z: number, time: number): number {
  let h = 0;
  for (const l of WATER_SWELL_LAYERS) {
    h += Math.sin((x * l.dx + z * l.dz) * l.freq + time * l.speed) * l.amp;
  }
  return h;
}

/**
 * JS mirror of the fragment-shader ripple normal (pre-fresnel/spec).
 * Two directional layers plus a third phase-warped by the first, so the
 * highlight field is a non-repeating interference pattern, not an x/z grid.
 */
export function waterRipple(x: number, z: number, time: number): { nx: number; nz: number } {
  const r1 = Math.sin(x * 0.033 + z * 0.022 + time * 1.1);
  const r2 = Math.sin(x * -0.019 + z * 0.041 - time * 0.9);
  const r3 = Math.sin(x * 0.028 + z * -0.031 + time * 1.7 + r1 * 1.3);
  const nx = (r1 * 0.7 + r3 * 0.5) * 0.12;
  const nz = (r2 * 0.7 - r3 * 0.5) * 0.12;
  const inv = 1 / Math.hypot(nx, 1, nz);
  return { nx: nx * inv, nz: nz * inv };
}

/** JS mirror of the fragment-shader foam breakup noise, in [-1, 1]. */
export function waterFoamNoise(x: number, z: number, time: number): number {
  const f1 = Math.sin(x * 0.32 + z * 0.24 + time * 2.0);
  const f2 = Math.sin(x * -0.21 + z * 0.28 - time * 1.6 + f1 * 1.1);
  return f1 * 0.6 + f2 * 0.4;
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
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 zenith = vec3(0.18, 0.36, 0.62);
    vec3 horizon = vec3(0.62, 0.78, 0.88);
    vec3 ground = vec3(0.28, 0.32, 0.30);
    vec3 color = mix(horizon, zenith, pow(t, 1.15));
    if (dir.y < 0.0) color = mix(horizon, ground, clamp(-dir.y * 1.4, 0.0, 1.0));

    float sun = pow(max(dot(dir, normalize(sunDir)), 0.0), 48.0);
    color += vec3(1.0, 0.92, 0.72) * sun * 0.85;
    float glow = pow(max(dot(dir, normalize(sunDir)), 0.0), 6.0);
    color += vec3(1.0, 0.7, 0.35) * glow * 0.18;
    gl_FragColor = vec4(color, 1.0);
  }
`;
