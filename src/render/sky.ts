import * as THREE from "three";

/**
 * The sky: a gradient dome around the camera, the same dome baked into a PMREM environment for
 * image-based light, and exponential fog whose colour is read back off the dome's horizon so the
 * ground dissolves into the sky instead of banding against it.
 *
 * Three pieces of technique are adapted from Claude of Tanks' `src/engine/sky.ts`
 * (`reference/claude-of-tanks/sky.ts.txt`, MIT; see `NOTICE`): baking the dome to the environment
 * with `PMREMGenerator.fromScene` at a radius inside its far plane, reading the fog colour back
 * from a horizon row rendered facing away from the sun, and checking the bake before trusting it
 * because some iOS GPUs poison it with NaN texels. The gradient model, the probe and the numbers
 * are this game's own; the physical `Sky.js` model and the cloud decks are not used.
 *
 * `skyColourAt` is the model in TypeScript and the dome's shader is the same model in GLSL. The two
 * are held together by the smoke check, which compares the fog colour read back from the drawn
 * dome with this function's horizon.
 */

export interface SkyStyle {
  /** Straight up. 0xRRGGBB, sRGB. */
  readonly zenith: number;
  /** Level, and the fog: the far course fades into this. */
  readonly horizon: number;
  /** Straight down: the underside of the environment, which lights surfaces from below. */
  readonly ground: number;
  /** How quickly the horizon gives way to the zenith: the gradient is `elevation ^ exponent`. */
  readonly exponent: number;
  readonly sunColour: number;
  readonly sunElevationDeg: number;
  /** Degrees from +X toward +Z, the world's own yaw convention. */
  readonly sunAzimuthDeg: number;
  /** The halo around the sun, added to the sky: `sunGlow * cos(angle) ^ sunGlowPower`. */
  readonly sunGlow: number;
  readonly sunGlowPower: number;
  /** Cosine of the disc's angular radius. */
  readonly sunDiscCos: number;
  readonly sunDiscIntensity: number;
}

/**
 * The parkland sky the whole arena sits under. The horizon is the palette's sampled sky
 * (`BIOMES.parkland.sky`) paled toward haze; the zenith is a deeper blue than the sheet, which only
 * ever had one sky swatch.
 */
export const SKY: SkyStyle = {
  zenith: 0x2f7fd0,
  horizon: 0xa8d3f0,
  ground: 0x5d6f4a,
  exponent: 0.55,
  sunColour: 0xfff1d6,
  // High enough that shadows fall short and under the carts, low enough to model a hillside.
  sunElevationDeg: 42,
  sunAzimuthDeg: 34,
  sunGlow: 0.35,
  sunGlowPower: 12,
  sunDiscCos: Math.cos((0.8 * Math.PI) / 180),
  sunDiscIntensity: 6,
};

export interface Direction {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit vector from the ground toward the sun. */
export function sunDirection(style: SkyStyle): Direction {
  const el = (style.sunElevationDeg * Math.PI) / 180;
  const az = (style.sunAzimuthDeg * Math.PI) / 180;
  return { x: Math.cos(el) * Math.cos(az), y: Math.sin(el), z: Math.cos(el) * Math.sin(az) };
}

const zenithScratch = new THREE.Color();
const horizonScratch = new THREE.Color();
const groundScratch = new THREE.Color();
const sunScratch = new THREE.Color();

/**
 * The sky's linear colour looking along the unit vector (x, y, z). The dome's fragment shader is
 * this function; change one and change the other.
 */
export function skyColourAt(style: SkyStyle, x: number, y: number, z: number, out: THREE.Color): void {
  const horizon = horizonScratch.setHex(style.horizon);
  if (y >= 0) {
    out.copy(horizon).lerp(zenithScratch.setHex(style.zenith), Math.pow(y, style.exponent));
  } else {
    // Below the horizon the sky turns to ground quickly: the environment's lower half is the
    // grass a surface would see, not more sky.
    out.copy(horizon).lerp(groundScratch.setHex(style.ground), Math.min(1, -y * 6));
  }
  const sun = sunDirection(style);
  const cosAngle = x * sun.x + y * sun.y + z * sun.z;
  const glow = style.sunGlow * Math.pow(Math.max(cosAngle, 0), style.sunGlowPower);
  const disc = style.sunDiscIntensity * smoothstep(style.sunDiscCos - 0.00002, style.sunDiscCos, cosAngle);
  const sunColour = sunScratch.setHex(style.sunColour);
  out.r += sunColour.r * (glow + disc);
  out.g += sunColour.g * (glow + disc);
  out.b += sunColour.b * (glow + disc);
}

/**
 * The `FogExp2` density that puts `fraction` of the fog colour over anything `distance` away.
 * FogExp2's factor is `1 - exp(-(density * distance)^2)`.
 */
export function fogDensityFor(distance: number, fraction: number): number {
  return Math.sqrt(-Math.log(1 - fraction)) / distance;
}

/**
 * Whether a probe lit only by the baked environment came out lit. A NaN texel in the bake reaches
 * the screen as black, so a probe that is black all over means the environment would blacken every
 * lit material and has to be dropped.
 */
export function envProbeValid(rgba: Uint8Array): boolean {
  if (rgba.length < 4) return false;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += rgba[i]! + rgba[i + 1]! + rgba[i + 2]!;
  // A few levels of grey on average: well under any lit surface, well over black.
  return sum / (rgba.length / 4) / 3 > 4;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// The dome, the environment and the fog. Browser only: everything below needs a renderer.

const VERTEX = /* glsl */ `
varying vec3 vDirection;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vDirection = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

// `skyColourAt`, line for line.
const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform float exponent;
uniform vec3 sunDirection;
uniform vec3 sunColour;
uniform float sunGlow;
uniform float sunGlowPower;
uniform float sunDiscCos;
uniform float sunDiscIntensity;
varying vec3 vDirection;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDirection);
  vec3 colour = d.y >= 0.0
    ? mix(horizon, zenith, pow(d.y, exponent))
    : mix(horizon, ground, min(1.0, -d.y * 6.0));
  float cosAngle = dot(d, sunDirection);
  float glow = sunGlow * pow(max(cosAngle, 0.0), sunGlowPower);
  float disc = sunDiscIntensity * smoothstep(sunDiscCos - 0.00002, sunDiscCos, cosAngle);
  colour += sunColour * (glow + disc);
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyMaterial(style: SkyStyle): THREE.ShaderMaterial {
  const sun = sunDirection(style);
  return new THREE.ShaderMaterial({
    name: "sky",
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      zenith: { value: new THREE.Color(style.zenith) },
      horizon: { value: new THREE.Color(style.horizon) },
      ground: { value: new THREE.Color(style.ground) },
      exponent: { value: style.exponent },
      sunDirection: { value: new THREE.Vector3(sun.x, sun.y, sun.z) },
      sunColour: { value: new THREE.Color(style.sunColour) },
      sunGlow: { value: style.sunGlow },
      sunGlowPower: { value: style.sunGlowPower },
      sunDiscCos: { value: style.sunDiscCos },
      sunDiscIntensity: { value: style.sunDiscIntensity },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

/** Inside `PMREMGenerator.fromScene`'s default far plane of 100. */
const ENV_DOME_RADIUS = 50;
const HORIZON_SAMPLE_SIZE = 16;
const PROBE_SIZE = 8;

export interface SkyEnvironment {
  /** The baked environment, or null if the bake failed its probe. */
  readonly texture: THREE.Texture | null;
  /** The fog colour, read back from the drawn horizon: linear. */
  readonly horizonColour: THREE.Color;
  dispose(): void;
}

/**
 * Bakes the sky into a PMREM environment and reads its horizon back, without adding anything to a
 * scene. The match (`createSky`) and the gate harness both light with it.
 */
export function bakeSkyEnvironment(renderer: THREE.WebGLRenderer, style: SkyStyle = SKY): SkyEnvironment {
  const material = createSkyMaterial(style);
  const geometry = new THREE.SphereGeometry(ENV_DOME_RADIUS, 48, 24);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(geometry, material));

  const horizonColour = sampleHorizon(renderer, envScene, style);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();

  const valid = probeEnvironment(renderer, target.texture);
  if (!valid) {
    console.warn("sky: the environment bake came back black (NaN texels?); lighting without it");
    target.dispose();
  }
  return {
    texture: valid ? target.texture : null,
    horizonColour,
    dispose(): void {
      target.dispose();
    },
  };
}

export interface SkyRig {
  /** The visible dome. Keep it centred on the camera with `follow`. */
  readonly dome: THREE.Mesh;
  /** The fog colour, read back from the drawn horizon: linear. */
  readonly horizonColour: THREE.Color;
  /** Whether the environment bake passed the probe and was installed. */
  readonly environmentValid: boolean;
  follow(camera: THREE.Camera): void;
  dispose(): void;
}

export interface SkyOptions {
  readonly style?: SkyStyle;
  /** Dome radius: inside the camera's far plane. */
  readonly radius: number;
  /** Distance at which the fog is 95% of its colour. */
  readonly fogDistance: number;
  /** `scene.environmentIntensity` once the bake is installed. */
  readonly environmentIntensity: number;
}

/**
 * Builds the dome into `scene`, bakes and installs `scene.environment`, and installs `FogExp2` in
 * the horizon's colour. Everything it allocates goes with `dispose`.
 */
export function createSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, options: SkyOptions): SkyRig {
  const style = options.style ?? SKY;
  const environment = bakeSkyEnvironment(renderer, style);
  const horizonColour = environment.horizonColour;

  const material = createSkyMaterial(style);
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const dome = new THREE.Mesh(geometry, material);
  dome.name = "sky-dome";
  dome.scale.setScalar(options.radius);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  scene.background = horizonColour.clone();
  const fog = new THREE.FogExp2(0xffffff, fogDensityFor(options.fogDistance, 0.95));
  fog.color.copy(horizonColour);
  scene.fog = fog;
  if (environment.texture !== null) {
    scene.environment = environment.texture;
    scene.environmentIntensity = options.environmentIntensity;
  }

  return {
    dome,
    horizonColour,
    environmentValid: environment.texture !== null,
    follow(camera: THREE.Camera): void {
      dome.position.copy(camera.position);
    },
    dispose(): void {
      dome.removeFromParent();
      if (scene.environment === environment.texture) scene.environment = null;
      environment.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * The fog colour: the dome drawn at the horizon, facing away from the sun, into a small linear
 * target, and the middle row averaged. A render target is neither tone-mapped nor sRGB-encoded, so
 * the bytes read back are linear light -- what `scene.fog` wants. If the read comes back black (a
 * lost context), the model's own horizon stands in.
 */
function sampleHorizon(renderer: THREE.WebGLRenderer, envScene: THREE.Scene, style: SkyStyle): THREE.Color {
  const sun = sunDirection(style);
  const target = new THREE.WebGLRenderTarget(HORIZON_SAMPLE_SIZE, HORIZON_SAMPLE_SIZE);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, ENV_DOME_RADIUS * 2);
  camera.lookAt(-sun.x, 0, -sun.z);
  camera.updateMatrixWorld();
  const row = new Uint8Array(HORIZON_SAMPLE_SIZE * 4);
  const previous = renderer.getRenderTarget();
  let r = 0;
  let g = 0;
  let b = 0;
  try {
    renderer.setRenderTarget(target);
    renderer.render(envScene, camera);
    renderer.readRenderTargetPixels(target, 0, HORIZON_SAMPLE_SIZE >> 1, HORIZON_SAMPLE_SIZE, 1, row);
    for (let i = 0; i < HORIZON_SAMPLE_SIZE; i++) {
      r += row[i * 4]!;
      g += row[i * 4 + 1]!;
      b += row[i * 4 + 2]!;
    }
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
  }
  const scale = 1 / (HORIZON_SAMPLE_SIZE * 255);
  if ((r + g + b) * scale < 0.01) {
    const out = new THREE.Color();
    skyColourAt(style, -sun.x / Math.hypot(sun.x, sun.z), 0, -sun.z / Math.hypot(sun.x, sun.z), out);
    return out;
  }
  return new THREE.Color().setRGB(r * scale, g * scale, b * scale, THREE.LinearSRGBColorSpace);
}

/** A matte white sphere lit by nothing but `environment`, drawn small and read back. */
function probeEnvironment(renderer: THREE.WebGLRenderer, environment: THREE.Texture): boolean {
  const scene = new THREE.Scene();
  scene.environment = environment;
  const geometry = new THREE.SphereGeometry(1, 16, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  const target = new THREE.WebGLRenderTarget(PROBE_SIZE, PROBE_SIZE);
  const pixels = new Uint8Array(4 * 4 * 4);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, PROBE_SIZE / 2 - 2, PROBE_SIZE / 2 - 2, 4, 4, pixels);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    geometry.dispose();
    material.dispose();
  }
  return envProbeValid(pixels);
}
