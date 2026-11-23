import { describe, expect, it } from "vitest";
import { createCattails } from "./cattails";

/**
 * The cattails bend from each clump's root: every vertex carries its height above its own clump's
 * base, so a clump on a high bank and one on a low bank sway the same.
 */
describe("cattails", () => {
  it("carries each vertex's height above its own clump's root", () => {
    const placed = [
      { x: 0, z: 0, yaw: 0, scale: 1, cluster: 0 },
      { x: 30, z: 0, yaw: 1, scale: 1.5, cluster: 1 },
    ];
    // Ground 0 under the first clump and 4 m under the second.
    const cattails = createCattails(placed, (x) => (x > 15 ? 4 : 0));
    const geometry = cattails.mesh!.geometry;
    const above = geometry.getAttribute("aAboveBase");
    const position = geometry.getAttribute("position");
    expect(above).toBeDefined();
    expect(above.count).toBe(position.count);
    const tallest = [0, 0];
    for (let v = 0; v < above.count; v++) {
      const clump = position.getX(v) > 15 ? 1 : 0;
      const base = clump === 1 ? 4 : 0;
      expect(above.getX(v)).toBeCloseTo(position.getY(v) - base, 4);
      expect(above.getX(v)).toBeGreaterThan(-0.05);
      tallest[clump] = Math.max(tallest[clump]!, above.getX(v));
    }
    // The second clump is drawn 1.5x the first, so it stands 1.5x as tall above its own root.
    expect(tallest[1]! / tallest[0]!).toBeCloseTo(1.5, 2);
    cattails.dispose();
  });
});
