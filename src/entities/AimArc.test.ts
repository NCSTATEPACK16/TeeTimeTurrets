import { describe, expect, it } from "vitest";
import { AimArc } from "./AimArc";
import { PREVIEW_MAX_POINTS, createPreviewBuffer } from "../sim/world";

describe("AimArc", () => {
  it("draws exactly the points the preview wrote, where it wrote them", () => {
    const arc = new AimArc();
    const points = createPreviewBuffer();
    points[0] = { x: 1, y: 2, z: 3 };
    points[1] = { x: 4, y: 5, z: 6 };
    points[2] = { x: 7, y: 8, z: 9 };

    arc.setPoints(points, 3);

    const position = arc.geometry.getAttribute("position");
    expect(position.count).toBe(PREVIEW_MAX_POINTS);
    expect(arc.geometry.drawRange.count).toBe(3);
    expect([position.getX(2), position.getY(2), position.getZ(2)]).toEqual([7, 8, 9]);
    arc.dispose();
  });

  it("hides itself when there is nothing to draw", () => {
    const arc = new AimArc();
    arc.setPoints(createPreviewBuffer(), 0);
    expect(arc.visible).toBe(false);
    arc.setPoints(createPreviewBuffer(), 2);
    expect(arc.visible).toBe(true);
    arc.dispose();
  });
});
