import { describe, expect, it } from "vitest";
import { QUALITY, QUALITY_NAMES, isQualityChoice, pickQuality, pixelRatioFor, resolveQuality } from "./quality";
import type { DeviceFacts } from "./quality";

/**
 * The presets are data the render modules read, so what is worth holding here is the ladder's
 * shape -- each step costs more than the one below it and buys something for it -- and the auto
 * pick, which is the only part a player never sees chosen.
 */

const DESKTOP: DeviceFacts = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  maxTouchPoints: 0,
  maxTextureSize: 16384,
  deviceMemory: 8,
  coarsePointer: false,
  gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
};

describe("the presets", () => {
  it("climb in resolution and shadow detail from low to high", () => {
    const [low, medium, high] = QUALITY_NAMES.map((name) => QUALITY[name]);
    expect(low!.maxPixelRatio).toBeLessThan(medium!.maxPixelRatio);
    expect(medium!.maxPixelRatio).toBeLessThan(high!.maxPixelRatio);
    expect(low!.shadows).toBe("off");
    expect(medium!.shadows).toBe("single");
    expect(high!.shadows).toBe("cascaded");
    expect(high!.shadowCascades).toBeGreaterThan(1);
    expect(high!.shadowFar).toBeGreaterThan(medium!.shadowFar);
    expect(low!.grassDensity).toBeLessThan(medium!.grassDensity);
    expect(medium!.grassDensity).toBeLessThan(high!.grassDensity);
    expect(low!.treeCap).toBeLessThan(medium!.treeCap);
    expect(medium!.treeCap).toBeLessThan(high!.treeCap);
  });

  it("gives post-processing to high alone, and MSAA to medium, as REVAMP-PLAN.md Stage 3 says", () => {
    expect(QUALITY.high.smaa && QUALITY.high.bloom).toBe(true);
    expect(QUALITY.medium.smaa || QUALITY.medium.bloom).toBe(false);
    expect(QUALITY.low.smaa || QUALITY.low.bloom).toBe(false);
    expect(QUALITY.medium.msaa).toBe(true);
    // High draws through a composer, whose SMAA does the anti-aliasing; MSAA on the canvas under it
    // would be paid for and thrown away.
    expect(QUALITY.high.msaa).toBe(false);
  });

  it("names its own entry, so a preset passed around still says which it is", () => {
    expect(QUALITY_NAMES).toEqual(["low", "medium", "high"]);
    for (const name of QUALITY_NAMES) expect(QUALITY[name].name).toBe(name);
  });
});

describe("pixelRatioFor", () => {
  it("is the display's ratio, capped by the preset", () => {
    expect(pixelRatioFor(QUALITY.low, 2)).toBe(QUALITY.low.maxPixelRatio);
    expect(pixelRatioFor(QUALITY.high, 1)).toBe(1);
    expect(pixelRatioFor(QUALITY.medium, 3)).toBe(QUALITY.medium.maxPixelRatio);
  });

  it("treats a missing or nonsense ratio as 1", () => {
    expect(pixelRatioFor(QUALITY.high, 0)).toBe(1);
    expect(pixelRatioFor(QUALITY.high, Number.NaN)).toBe(1);
  });
});

describe("pickQuality", () => {
  it("picks medium on a desktop", () => {
    expect(pickQuality(DESKTOP)).toBe("medium");
  });

  it("picks low on a software renderer, whatever else the device says", () => {
    expect(pickQuality({ ...DESKTOP, gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" })).toBe("low");
    expect(pickQuality({ ...DESKTOP, gpu: "llvmpipe (LLVM 15.0.7, 256 bits)" })).toBe("low");
  });

  it("picks low on a phone", () => {
    expect(
      pickQuality({
        ...DESKTOP,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        maxTouchPoints: 5,
        maxTextureSize: 16384,
        gpu: "Apple GPU",
      }),
    ).toBe("low");
  });

  it("picks low on an iPad that calls itself a Mac", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
    expect(pickQuality({ ...DESKTOP, userAgent: mac, maxTouchPoints: 5 })).toBe("low");
    expect(pickQuality({ ...DESKTOP, userAgent: mac, maxTouchPoints: 0 })).toBe("medium");
  });

  it("picks low on a GPU that caps textures at 4096", () => {
    expect(pickQuality({ ...DESKTOP, maxTextureSize: 4096 })).toBe("low");
  });

  it("picks low on a touch-first device with little memory", () => {
    expect(pickQuality({ ...DESKTOP, coarsePointer: true, deviceMemory: 4 })).toBe("low");
    expect(pickQuality({ ...DESKTOP, coarsePointer: true, deviceMemory: 8 })).toBe("medium");
  });
});

describe("resolveQuality", () => {
  it("takes the player's choice over the auto pick", () => {
    expect(resolveQuality("high", { ...DESKTOP, maxTextureSize: 4096 }).name).toBe("high");
    expect(resolveQuality("low", DESKTOP).name).toBe("low");
  });

  it("uses the auto pick for auto", () => {
    expect(resolveQuality("auto", DESKTOP).name).toBe("medium");
    expect(resolveQuality("auto", { ...DESKTOP, maxTextureSize: 4096 }).name).toBe("low");
  });
});

describe("isQualityChoice", () => {
  it("accepts the four choices and nothing else", () => {
    for (const choice of ["auto", "low", "medium", "high"]) expect(isQualityChoice(choice)).toBe(true);
    for (const junk of ["ultra", "", 2, null, undefined, "HIGH"]) expect(isQualityChoice(junk)).toBe(false);
  });
});
