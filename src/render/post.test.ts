import { describe, expect, it } from "vitest";
import { QUALITY } from "./quality";
import { postPassesFor } from "./post";

describe("postPassesFor", () => {
  it("draws Low and Medium straight to the canvas", () => {
    expect(postPassesFor(QUALITY.low)).toEqual([]);
    expect(postPassesFor(QUALITY.medium)).toEqual([]);
  });

  it("gives High ambient occlusion, a light bloom, tone mapping and then SMAA", () => {
    expect(postPassesFor(QUALITY.high)).toEqual(["render", "ao", "bloom", "output", "smaa"]);
  });

  it("leaves out whatever the preset turns off", () => {
    expect(postPassesFor({ ...QUALITY.high, ao: false })).toEqual(["render", "bloom", "output", "smaa"]);
    expect(postPassesFor({ ...QUALITY.high, ao: false, bloom: false })).toEqual(["render", "output", "smaa"]);
  });
});
