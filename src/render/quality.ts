/**
 * Graphics quality: three presets as plain data, and the pick between them.
 *
 * Every GPU-cost lever the renderer has lives here as a number or a flag, and the modules that
 * spend the cost (`main.ts` for the pixel ratio, `scene.ts` for shadows, `post.ts` for the
 * composer, the environment for grass, trees and water) read it. A preset is chosen once from a few
 * cheap facts about the device and can be overridden in Settings.
 *
 * The pattern -- a quality ladder as data, auto-picked from the user agent, touch points, the GPU's
 * texture limit and device memory -- is adapted from Claude of Tanks' `src/engine/quality.ts`
 * (`reference/claude-of-tanks/quality.ts.txt`, MIT; see `NOTICE`). The presets and their numbers
 * are this game's own.
 */

export type QualityName = "low" | "medium" | "high";
/** What the player chose in Settings: a preset, or let the device decide. */
export type QualityChoice = "auto" | QualityName;

export const QUALITY_NAMES: readonly QualityName[] = ["low", "medium", "high"];

export interface QualityPreset {
  readonly name: QualityName;
  readonly label: string;
  /** Cap on the renderer's pixel ratio. A 2x display at 1.5 draws 56% of the pixels. */
  readonly maxPixelRatio: number;
  /**
   * Multisampling on the canvas. Fixed when the WebGL context is created, so a change takes effect
   * on the next page load; everything else here applies at the next match.
   */
  readonly msaa: boolean;
  /**
   * `single` is one directional map that follows the camera, texel-snapped so it does not shimmer
   * (`src/vendor/cot/shadowStability.ts`). `cascaded` is three.js's CSM.
   */
  readonly shadows: "off" | "single" | "cascaded";
  /** Texels per side of each shadow map. */
  readonly shadowMapSize: number;
  readonly shadowCascades: number;
  /** Metres from the camera that shadows reach. */
  readonly shadowFar: number;
  /** Screen-space ambient occlusion in the composer. High only. */
  readonly ao: boolean;
  /** Post-process anti-aliasing in the composer. High only; medium has MSAA instead. */
  readonly smaa: boolean;
  readonly bloom: boolean;
  /** Grass blades as a fraction of the full carpet, 0..1. */
  readonly grassDensity: number;
  /** Most trees drawn at once. */
  readonly treeCap: number;
  /** `simple` is a flat tinted plane; `shaded` adds moving normals and a fresnel sky reflection. */
  readonly water: "simple" | "shaded";
}

export const QUALITY: Readonly<Record<QualityName, QualityPreset>> = {
  low: {
    name: "low",
    label: "LOW",
    maxPixelRatio: 1,
    msaa: false,
    shadows: "off",
    shadowMapSize: 0,
    shadowCascades: 0,
    shadowFar: 0,
    ao: false,
    smaa: false,
    bloom: false,
    grassDensity: 0.25,
    treeCap: 600,
    water: "simple",
  },
  medium: {
    name: "medium",
    label: "MEDIUM",
    maxPixelRatio: 1.5,
    msaa: true,
    shadows: "single",
    shadowMapSize: 2048,
    shadowCascades: 1,
    // A chase camera 6.5 m behind the cart: 90 m covers the carts and props anyone is fighting
    // over, which is what a single map can hold sharply.
    shadowFar: 90,
    ao: false,
    smaa: false,
    bloom: false,
    grassDensity: 0.6,
    treeCap: 1500,
    water: "shaded",
  },
  high: {
    name: "high",
    label: "HIGH",
    maxPixelRatio: 2,
    msaa: false,
    shadows: "cascaded",
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFar: 260,
    ao: true,
    smaa: true,
    bloom: true,
    grassDensity: 1,
    treeCap: 3000,
    water: "shaded",
  },
};

/** The device, as far as the pick cares. `readDeviceFacts` gathers them in a browser. */
export interface DeviceFacts {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** The GPU's `MAX_TEXTURE_SIZE`. 4096 marks a constrained GPU whatever the user agent says. */
  readonly maxTextureSize: number;
  /** `navigator.deviceMemory`, in GB, where the browser reports it. */
  readonly deviceMemory?: number;
  readonly coarsePointer: boolean;
  /** The renderer string, where the browser gives it. */
  readonly gpu: string;
}

const PHONE_UA = /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Silk/i;
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i;

/**
 * Low on anything that is software-rendered or phone-class, medium otherwise.
 *
 * Never high: nothing here can tell a laptop's integrated GPU from a desktop card, and a default
 * that misses its frame budget is worse than one that leaves detail on the table. High is a choice
 * in Settings.
 */
export function pickQuality(device: DeviceFacts): QualityName {
  if (SOFTWARE_GPU.test(device.gpu)) return "low";
  const phone = PHONE_UA.test(device.userAgent);
  // iPadOS 13 and later reports itself as a Mac; its touch points give it away.
  const iPad = /Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1;
  const tightGpu = device.maxTextureSize <= 4096;
  const smallMemory = device.deviceMemory !== undefined && device.deviceMemory <= 4;
  if (phone || iPad || tightGpu || (device.coarsePointer && smallMemory)) return "low";
  return "medium";
}

export function resolveQuality(choice: QualityChoice, device: DeviceFacts): QualityPreset {
  return QUALITY[choice === "auto" ? pickQuality(device) : choice];
}

export function pixelRatioFor(preset: QualityPreset, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, preset.maxPixelRatio);
}

export function isQualityChoice(value: unknown): value is QualityChoice {
  return value === "auto" || value === "low" || value === "medium" || value === "high";
}

/**
 * The facts `pickQuality` needs, read from this browser. Called before the game's renderer exists,
 * because the pick decides whether that renderer's context is multisampled: it opens a throwaway
 * WebGL context to ask the GPU, and gives it straight back.
 *
 * Every read is guarded: a missing API is a device that says less, not a reason not to start.
 */
export function probeDeviceFacts(): DeviceFacts {
  let gpu = "";
  let maxTextureSize = 0;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      // Modern browsers return the unmasked name from RENDERER itself; the extension is the fallback.
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // A device that will not say is treated as one that said nothing.
  }
  let coarsePointer = false;
  try {
    coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    coarsePointer = false;
  }
  const nav = (typeof navigator === "undefined" ? {} : navigator) as Partial<Navigator> & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent ?? "",
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    // Unknown is not the same as small: 0 would read as a constrained GPU.
    maxTextureSize: maxTextureSize || 16384,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    coarsePointer,
    gpu,
  };
}
