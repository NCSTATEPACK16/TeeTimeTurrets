/**
 * Graphics quality presets: every rendering cost the game can trade, as plain data.
 *
 * Low, Med and High. **Med on a desktop is the design target** (`docs/DECISIONS.md`, 2026-09-27),
 * Low is kept working for a later phone build, and High adds the post chain. A preset never
 * changes gameplay: nothing under `src/sim/**` or `src/physics/**` may import this
 * (`tools/simIsolation.test.mjs`).
 *
 * The pattern -- a ladder of data the renderer modules read, picked automatically from the device
 * and overridable by the player -- and the device heuristic are adapted from Claude of Tanks'
 * `quality.ts` (MIT, `reference/claude-of-tanks/quality.ts.txt`; see `NOTICE`). The values are this
 * game's own.
 *
 * Some levers have no consumer yet and say so: grass, the tree
 * cap and water belong to Stage 5's environment. They are here so a preset describes the whole
 * budget from the start, and so Stage 5 reads a number rather than inventing one.
 */

export type QualityName = "low" | "med" | "high";
/** What the player picks: a preset, or whatever suits the device. */
export type QualityChoice = "auto" | QualityName;

export const QUALITY_NAMES: readonly QualityName[] = ["low", "med", "high"];
export const QUALITY_CHOICES: readonly QualityChoice[] = ["auto", ...QUALITY_NAMES];

export interface QualityPreset {
  readonly label: string;
  /** Cap on the renderer's pixel ratio. A Retina desktop reports 2, which is 4x the pixels of 1. */
  readonly maxPixelRatio: number;
  /**
   * Sun shadows: none; one map that follows the camera, texel-snapped so it does not shimmer; or
   * cascaded shadow maps over the view distance.
   */
  readonly shadows: "off" | "single" | "cascaded";
  /** Texels along one side of each shadow map. */
  readonly shadowMapSize: number;
  /** Shadow maps: 0 with shadows off, 1 for the single map, more for cascades. */
  readonly shadowCascades: number;
  /**
   * Screen-space ambient occlusion on the post chain (`post.ts`). High only: Low and Med get the
   * contact shade baked into static merged graphs instead (`groundContactShade`).
   */
  readonly ambientOcclusion: boolean;
  /** Reserved for Stage 5's grass carpet: blades per square metre near the camera. */
  readonly grassDensity: number;
  /** Reserved for Stage 5's trees: most drawn at once. */
  readonly treeCap: number;
  /** SMAA on the post chain. Only where there is a post chain; Low and Med use the canvas's MSAA. */
  readonly smaa: boolean;
  /** A light bloom on the post chain. */
  readonly bloom: boolean;
  /** Reserved for Stage 5's water. */
  readonly water: "flat" | "reflective";
}

export const QUALITY_PRESETS: Readonly<Record<QualityName, QualityPreset>> = {
  low: {
    label: "Low",
    maxPixelRatio: 1,
    shadows: "off",
    shadowMapSize: 0,
    shadowCascades: 0,
    ambientOcclusion: false,
    grassDensity: 0,
    treeCap: 400,
    smaa: false,
    bloom: false,
    water: "flat",
  },
  med: {
    label: "Med",
    // Three quarters of a Retina panel's pixels short of 2: the cheapest single lever there is.
    maxPixelRatio: 1.5,
    shadows: "single",
    shadowMapSize: 2048,
    shadowCascades: 1,
    ambientOcclusion: false,
    grassDensity: 8,
    treeCap: 1200,
    smaa: false,
    bloom: false,
    water: "flat",
  },
  high: {
    label: "High",
    maxPixelRatio: 2,
    shadows: "cascaded",
    shadowMapSize: 2048,
    shadowCascades: 3,
    ambientOcclusion: true,
    grassDensity: 16,
    treeCap: 3000,
    smaa: true,
    bloom: true,
    water: "reflective",
  },
};

/** What the browser says about the device, gathered by `readDeviceSignals`, passed in so tests can say it. */
export interface DeviceSignals {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** `gl.MAX_TEXTURE_SIZE`. A cap of 4096 marks a constrained GPU whatever the user agent claims. */
  readonly maxTextureSize: number;
  /** `navigator.deviceMemory`, where the browser has it. */
  readonly deviceMemoryGb: number | null;
  /** `(pointer: coarse)`: a touch screen is the main input. */
  readonly coarsePointer: boolean;
}

/**
 * Phone or tablet, or not. A phone user agent; an iPad, which asks for the desktop site and reports
 * a Mac but has touch points; a GPU capped at 4096 textures; or touch-first with 4 GB or less.
 */
export function deviceClass(signals: DeviceSignals): "mobile" | "desktop" {
  const phone = /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Silk/i.test(signals.userAgent);
  const iPadAsMac = /Macintosh/.test(signals.userAgent) && signals.maxTouchPoints > 1;
  const tightGpu = signals.maxTextureSize <= 4096;
  const smallTouch =
    signals.coarsePointer && signals.deviceMemoryGb !== null && signals.deviceMemoryGb <= 4;
  return phone || iPadAsMac || tightGpu || smallTouch ? "mobile" : "desktop";
}

export function autoQuality(signals: DeviceSignals): QualityName {
  return deviceClass(signals) === "mobile" ? "low" : "med";
}

export function resolveQuality(choice: QualityChoice, signals: DeviceSignals): QualityName {
  return choice === "auto" ? autoQuality(signals) : choice;
}

/** The page's signals. `maxTextureSize` comes from the renderer the caller already has. */
export function readDeviceSignals(maxTextureSize: number): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let coarse = false;
  try {
    coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }
  return {
    userAgent: nav.userAgent ?? "",
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    maxTextureSize,
    deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    coarsePointer: coarse,
  };
}
