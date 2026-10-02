import { describe, expect, it } from "vitest";
import { QUALITY_NAMES, QUALITY_PRESETS, autoQuality, deviceClass, resolveQuality } from "./quality";
import type { DeviceSignals } from "./quality";

const DESKTOP: DeviceSignals = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  maxTouchPoints: 0,
  maxTextureSize: 16384,
  deviceMemoryGb: 16,
  coarsePointer: false,
};

describe("quality presets", () => {
  /** "As data": a preset survives JSON unchanged, so it holds no functions, classes or three objects. */
  it("are plain data", () => {
    expect(JSON.parse(JSON.stringify(QUALITY_PRESETS))).toEqual(QUALITY_PRESETS);
    expect(QUALITY_NAMES).toEqual(["low", "med", "high"]);
  });

  it("never spend less going up a step", () => {
    const [low, med, high] = QUALITY_NAMES.map((name) => QUALITY_PRESETS[name]);
    for (const [a, b] of [
      [low!, med!],
      [med!, high!],
    ] as const) {
      expect(b.maxPixelRatio).toBeGreaterThanOrEqual(a.maxPixelRatio);
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
      expect(b.shadowCascades).toBeGreaterThanOrEqual(a.shadowCascades);
      expect(b.grassDensity).toBeGreaterThanOrEqual(a.grassDensity);
      expect(b.treeCap).toBeGreaterThanOrEqual(a.treeCap);
    }
  });

  /** The plan's shape for each: Low no shadows, Med one map and MSAA, High cascades and the post chain. */
  it("give Low no shadows, Med one shadow map without post, and High cascades with SMAA and bloom", () => {
    expect(QUALITY_PRESETS.low.shadows).toBe("off");
    expect(QUALITY_PRESETS.med.shadows).toBe("single");
    expect(QUALITY_PRESETS.med.smaa || QUALITY_PRESETS.med.bloom).toBe(false);
    expect(QUALITY_PRESETS.high.shadows).toBe("cascaded");
    expect(QUALITY_PRESETS.high.shadowCascades).toBeGreaterThan(1);
    expect(QUALITY_PRESETS.high.smaa && QUALITY_PRESETS.high.bloom).toBe(true);
  });
});

describe("picking a preset for the device", () => {
  it("treats a desktop as a desktop", () => {
    expect(deviceClass(DESKTOP)).toBe("desktop");
  });

  it.each([
    ["an iPhone", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" }],
    ["an Android phone", { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36" }],
    // iPadOS asks for the desktop site and says Macintosh; its touch points give it away.
    ["an iPad posing as a Mac", { maxTouchPoints: 5 }],
    ["a GPU that caps textures at 4096", { maxTextureSize: 4096 }],
    ["a touch-first device with 4 GB", { coarsePointer: true, deviceMemoryGb: 4 }],
  ])("treats %s as mobile", (_name, overrides) => {
    expect(deviceClass({ ...DESKTOP, ...overrides })).toBe("mobile");
  });

  it("picks Med on a desktop, the design target, and Low on mobile", () => {
    expect(autoQuality(DESKTOP)).toBe("med");
    expect(autoQuality({ ...DESKTOP, maxTouchPoints: 5 })).toBe("low");
  });

  it("lets the player's choice override the automatic one", () => {
    expect(resolveQuality("high", { ...DESKTOP, maxTouchPoints: 5 })).toBe("high");
    expect(resolveQuality("low", DESKTOP)).toBe("low");
    expect(resolveQuality("auto", DESKTOP)).toBe("med");
  });
});
