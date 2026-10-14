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
      float caustic = pow(sin(vWorld.x * 0.12 + time) * sin(vWorld.z * 0.1 + time * 0.7) * 0.5 + 0.5, 4.0);
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
    float w1 = sin(pos.x * 0.018 + time * 1.15) * 1.35;
    float w2 = sin(pos.z * 0.022 + time * 0.85) * 1.05;
    float w3 = sin((pos.x + pos.z) * 0.03 + time * 1.6) * 0.55;
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
    vec3 N = normalize(vec3(
      sin(vWorld.x * 0.04 + time * 1.1) * 0.12,
      1.0,
      sin(vWorld.z * 0.045 + time * 0.9) * 0.12
    ));
    float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    color = mix(color, vec3(0.55, 0.75, 0.85), fresnel * 0.55);

    vec3 L = normalize(sunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 64.0);
    color += sunColor * spec * 0.65;

    float foam = 1.0 - smoothstep(0.0, 14.0, depth);
    float foamNoise = sin(vWorld.x * 0.4 + time * 2.0) * sin(vWorld.z * 0.35 + time * 1.6);
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
