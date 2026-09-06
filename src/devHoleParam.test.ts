import { describe, expect, it } from "vitest";
import { parseHoleIndex } from "./devHoleParam";

describe("parseHoleIndex", () => {
  it("reads a valid ?hole= index", () => {
    expect(parseHoleIndex("?hole=3", 18)).toBe(3);
  });

  it("defaults to 0 when the param is missing", () => {
    expect(parseHoleIndex("", 18)).toBe(0);
  });

  it("clamps an index at or past holeCount to the last hole", () => {
    expect(parseHoleIndex("?hole=99", 18)).toBe(17);
  });

  it("clamps a negative index to 0", () => {
    expect(parseHoleIndex("?hole=-5", 18)).toBe(0);
  });

  it("defaults to 0 for a non-numeric param", () => {
    expect(parseHoleIndex("?hole=banana", 18)).toBe(0);
  });
});
