import { describe, expect, it } from "vitest";
import { cartSvg } from "./titleArt";

describe("cart art", () => {
  it("draws the roof turret by default, firing when asked", () => {
    const svg = cartSvg({ firing: true, driving: true, speedLines: false });
    expect(svg).toContain("mn-arm");
    expect(svg).toContain("mn-flash");
  });

  it("free drive's carts carry no turret at all", () => {
    const svg = cartSvg({ firing: false, turret: false, driving: true, speedLines: false });
    expect(svg).not.toMatch(/mn-(arm|flash|feed)/);
    expect(svg).not.toContain("#C84B31"); // the turret housing
  });
});
