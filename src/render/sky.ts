import * as THREE from "three";

/**
 * The sky: a gradient dome with a sun and soft drifting clouds, the same dome baked once into a
 * PMREM environment that lights every standard material, and fog whose colour is the dome's own
 * horizon so the far terrain dissolves into the sky instead of banding against it.
 *
 * The approach -- a procedural dome, a PMREM bake of it for image-based light, fog matched to the
 * horizon, and a guard against an env bake full of NaNs (some iOS GPUs) -- follows Claude of Tanks'
 * `sky.ts` (MIT, `reference/claude-of-tanks/sky.ts.txt`; see `NOTICE`). The shader, the palette and
 * the guard's mechanism are this game's own: a stylised gradient to match the concept art rather
 * than a physical atmosphere.
 *
 * **The fog colour is the horizon by construction.** `skyColourAt` is the dome's gradient written
 * once in TypeScript and once in GLSL, term for term; `horizonFogColour` averages it around the
 * horizon. The clouds fade out well above the horizon, so they never touch that average.
 */

/** Every colour is an sRGB hex, converted to linear where it is used, like any three colour. */
export interface SkyLook {
  readonly zenith: number;
  readonly horizon: number;
  /** Below the horizon: the haze a camera sees when it looks down past the terrain's edge. */
  readonly below: number;
  /** How fast the zenith colour takes over going up: higher keeps a wider pale band. */
  readonly gradientExponent: number;
  readonly sunColour: number;
  readonly sunElevationDeg: number;
  /** Compass bearing of the sun, clockwise from north (+z), in degrees. */
  readonly sunAzimuthDeg: number;
  /** The soft glow around the sun, added on top of the gradient. */
  readonly sunGlow: number;
  readonly cloudColour: number;
  /** 0 is a clear sky, 1 is mostly cloud. */
  readonly cloudCover: number;
  /** Metres per second the clouds drift; purely cosmetic. */
  readonly cloudDrift: number;
}

/** Bright, saturated and warm: the sky of `docs/concept/03CartTurretChasecam.jpg`. */
export const PARKLAND_SKY: SkyLook = {
  zenith: 0x2f86e6,
  horizon: 0xa8d8f7,
  below: 0x9cc9a8,
  gradientExponent: 0.42,
  sunColour: 0xfff1d6,
  sunElevationDeg: 52,
  sunAzimuthDeg: 210,
  sunGlow: 0.35,
  cloudColour: 0xffffff,
  cloudCover: 0.42,
  cloudDrift: 3,
};

/** The title backdrop is the same course late in the afternoon: lower, warmer sun. */
export const GOLDEN_HOUR_SKY: SkyLook = {
  ...PARKLAND_SKY,
  zenith: 0x4a86d4,
  horizon: 0xf3dcc0,
  below: 0xc9cfae,
  sunColour: 0xffd9a0,
  sunElevationDeg: 24,
  sunAzimuthDeg: 235,
  sunGlow: 0.6,
  cloudCover: 0.35,
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Unit vector pointing *toward* the sun. */
export function sunDirection(look: SkyLook, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(look.sunElevationDeg);
  const az = THREE.MathUtils.degToRad(look.sunAzimuthDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

function linear(hex: number): Rgb {
  const c = new THREE.Color(hex);
  return { r: c.r, g: c.g, b: c.b };
}

const GLOW_POWER = 6;

/**
 * The dome's colour (linear) looking along a unit direction whose height is `dirY` and whose cosine
 * to the sun is `cosToSun`, without clouds or the sun's disc. Mirrors `FRAGMENT` term for term.
 */
export function skyColourAt(look: SkyLook, dirY: number, cosToSun: number, out: Rgb): Rgb {
  const zenith = linear(look.zenith);
  const horizon = linear(look.horizon);
  const below = linear(look.below);
  const sun = linear(look.sunColour);
  const up = Math.pow(Math.max(dirY, 0), look.gradientExponent);
  const down = THREE.MathUtils.smoothstep(-dirY, 0, 0.2);
  const glow = look.sunGlow * Math.pow(Math.max(cosToSun, 0), GLOW_POWER);
  out.r = horizon.r + (zenith.r - horizon.r) * up;
  out.g = horizon.g + (zenith.g - horizon.g) * up;
  out.b = horizon.b + (zenith.b - horizon.b) * up;
  out.r += (below.r - out.r) * down + sun.r * glow;
  out.g += (below.g - out.g) * down + sun.g * glow;
  out.b += (below.b - out.b) * down + sun.b * glow;
  return out;
}

/** The fog colour: the dome sampled all the way round the horizon and averaged (linear). */
export function horizonFogColour(look: SkyLook, out: THREE.Color = new THREE.Color()): THREE.Color {
  const sun = sunDirection(look);
  const sample: Rgb = { r: 0, g: 0, b: 0 };
  const steps = 64;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    // Level with the horizon, where the fogged terrain meets the dome.
    const cosToSun = Math.sin(a) * sun.x + Math.cos(a) * sun.z;
    skyColourAt(look, 0, cosToSun, sample);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return out.setRGB(r / steps, g / steps, b / steps, THREE.LinearSRGBColorSpace);
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  // The dome sits just inside the far plane wherever the camera is, so nothing is ever behind it.
  vec4 clip = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 below;
uniform float gradientExponent;
uniform vec3 sunColour;
uniform vec3 sunDir;
uniform float sunGlow;
uniform vec3 cloudColour;
uniform float cloudCover;
uniform vec2 cloudOffset;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float cosToSun = dot(dir, sunDir);
  float up = pow(max(dir.y, 0.0), gradientExponent);
  float down = smoothstep(0.0, 0.2, -dir.y);
  vec3 col = mix(horizon, zenith, up);
  col = mix(col, below, down);
  col += sunColour * sunGlow * pow(max(cosToSun, 0.0), ${GLOW_POWER.toFixed(1)});

  // The disc: well over 1 in linear light, so High's bloom picks it out.
  col += sunColour * 18.0 * smoothstep(0.99955, 0.99985, cosToSun);

  // Clouds on a flat ceiling, faded out toward the horizon so the fog average never sees them.
  if (dir.y > 0.02) {
    vec2 p = dir.xz / dir.y * 0.9 + cloudOffset;
    float n = fbm(p);
    float shape = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.18, n);
    float fade = smoothstep(0.06, 0.3, dir.y);
    // Lit tops, slightly shaded bellies, and a warm rim toward the sun.
    float shade = 0.82 + 0.18 * smoothstep(0.35, 0.9, n);
    vec3 cloud = cloudColour * shade + sunColour * 0.25 * pow(max(cosToSun, 0.0), 4.0);
    col = mix(col, cloud, shape * fade * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function linearColour(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

function createDomeMaterial(look: SkyLook): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "sky-dome",
    uniforms: {
      zenith: { value: linearColour(look.zenith) },
      horizon: { value: linearColour(look.horizon) },
      below: { value: linearColour(look.below) },
      gradientExponent: { value: look.gradientExponent },
      sunColour: { value: linearColour(look.sunColour) },
      sunDir: { value: sunDirection(look) },
      sunGlow: { value: look.sunGlow },
      cloudColour: { value: linearColour(look.cloudColour) },
      cloudCover: { value: look.cloudCover },
      cloudOffset: { value: new THREE.Vector2() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

/**
 * Reads the baked environment back through a 1-pixel-per-probe shader that writes 1 where a sample
 * is NaN or infinite. Some mobile GPUs produce a NaN-filled PMREM; lit through one, every standard
 * material turns black. The probe reads the env the way the materials do (`textureCubeUV`), at
 * every roughness the probe covers, so a bad mip is caught too.
 */
const PROBE_DIRS = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0.6, 0.6, 0.5],
  [-0.5, 0.3, -0.8],
] as const;
const PROBE_ROUGHNESS = [0, 0.5, 1] as const;

export function envHasInvalidTexels(renderer: THREE.WebGLRenderer, env: THREE.Texture): boolean {
  const imageHeight = (env.image as { height: number }).height;
  const maxMip = Math.log2(imageHeight) - 2;
  const texelHeight = 1 / imageHeight;
  const texelWidth = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
  const width = PROBE_DIRS.length;
  const height = PROBE_ROUGHNESS.length;
  const material = new THREE.ShaderMaterial({
    defines: {
      ENVMAP_TYPE_CUBE_UV: "",
      CUBEUV_TEXEL_WIDTH: texelWidth,
      CUBEUV_TEXEL_HEIGHT: texelHeight,
      CUBEUV_MAX_MIP: `${maxMip}.0`,
    },
    uniforms: {
      envMap: { value: env },
      dirs: { value: PROBE_DIRS.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize()) },
      roughness: { value: [...PROBE_ROUGHNESS] },
    },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D envMap;
      uniform vec3 dirs[${width}];
      uniform float roughness[${height}];
      #include <cube_uv_reflection_fragment>
      void main() {
        int i = int(gl_FragCoord.x);
        int j = int(gl_FragCoord.y);
        vec3 c = textureCubeUV(envMap, dirs[i], roughness[j]).rgb;
        bool bad = any(isnan(c)) || any(isinf(c)) || c.r < 0.0 || c.g < 0.0 || c.b < 0.0;
        gl_FragColor = vec4(bad ? 1.0 : 0.0, 0.0, 0.0, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const probeScene = new THREE.Scene();
  probeScene.add(quad);
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
  const camera = new THREE.Camera();
  const previous = renderer.getRenderTarget();
  const pixels = new Uint8Array(width * height * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.render(probeScene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    quad.geometry.dispose();
    material.dispose();
  }
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 127) return true;
  return false;
}

export class Sky {
  readonly dome: THREE.Mesh;
  /** Null when no renderer was given, or when the bake came back invalid. */
  readonly environment: THREE.Texture | null;
  /** Linear, for `scene.fog`. */
  readonly fogColour: THREE.Color;
  readonly sunDir: THREE.Vector3;
  readonly sunColour: THREE.Color;
  /** A hemisphere fill: brighter when the env bake failed, so the scene is never left unlit. */
  readonly hemisphere: THREE.HemisphereLight;
  private readonly material: THREE.ShaderMaterial;
  private readonly look: SkyLook;

  constructor(look: SkyLook, renderer: THREE.WebGLRenderer | null) {
    this.look = look;
    this.material = createDomeMaterial(look);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.dome.name = "sky";
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.fogColour = horizonFogColour(look);
    this.sunDir = sunDirection(look);
    this.sunColour = new THREE.Color(look.sunColour);
    this.environment = renderer ? this.bake(renderer) : null;
    this.hemisphere = new THREE.HemisphereLight(look.horizon, look.below, this.environment ? 0.35 : 1.1);
  }

  private bake(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(this.dome.geometry, this.material);
    dome.frustumCulled = false;
    envScene.add(dome);
    let env: THREE.Texture | null = null;
    try {
      env = pmrem.fromScene(envScene, 0.02).texture;
      if (envHasInvalidTexels(renderer, env)) {
        console.warn("sky: the environment bake has invalid texels; lighting without it");
        env.dispose();
        env = null;
      }
    } catch (error) {
      console.warn("sky: environment bake failed; lighting without it", error);
      env = null;
    } finally {
      pmrem.dispose();
    }
    return env;
  }

  /** Puts the sky, its fog, its fill light and its environment into a scene. */
  install(scene: THREE.Scene, fogDensity: number): void {
    scene.background = null;
    scene.add(this.dome);
    scene.add(this.hemisphere);
    const fog = new THREE.FogExp2(0xffffff, fogDensity);
    fog.color.copy(this.fogColour);
    scene.fog = fog;
    scene.environment = this.environment;
  }

  /** Clouds drift; nothing else on the dome moves. */
  update(elapsedSeconds: number): void {
    const offset = this.material.uniforms.cloudOffset!.value as THREE.Vector2;
    offset.set(elapsedSeconds * this.look.cloudDrift * 0.0021, elapsedSeconds * this.look.cloudDrift * 0.0013);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.material.dispose();
    this.environment?.dispose();
    this.hemisphere.dispose();
  }
}
