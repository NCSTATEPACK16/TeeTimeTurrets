import { describe, expect, it } from "vitest";
import { nextFocus } from "./focusNav";
import type { FocusRect } from "./focusNav";

/** Menu focus movement for the pad (Stage 4b, spec §2.3). */

const box = (x: number, y: number, width = 100, height = 40): FocusRect => ({ x, y, width, height });

describe("moving menu focus", () => {
  // A title-like column of three, and a BACK / CONFIRM row under it.
  const column = [box(0, 0), box(0, 60), box(0, 120)];
  const row = [box(0, 200), box(200, 200)];

  it("gives the first control focus when nothing has it", () => {
    expect(nextFocus(column, -1, "down")).toBe(0);
    expect(nextFocus([], -1, "down")).toBe(-1);
  });

  it("moves down and up a column, and stays put at its ends", () => {
    expect(nextFocus(column, 0, "down")).toBe(1);
    expect(nextFocus(column, 1, "down")).toBe(2);
    expect(nextFocus(column, 2, "down")).toBe(2);
    expect(nextFocus(column, 1, "up")).toBe(0);
    expect(nextFocus(column, 0, "up")).toBe(0);
  });

  it("moves along a row, not into the column above it", () => {
    const all = [...column, ...row];
    expect(nextFocus(all, 3, "right")).toBe(4);
    expect(nextFocus(all, 4, "left")).toBe(3);
    expect(nextFocus(all, 3, "left")).toBe(3);
  });

  it("prefers the control in its own row to a nearer one off to the side", () => {
    // From the left of a row, "right" picks its neighbour 200 px along, not a box 90 px away
    // that sits 80 px lower: sideways steps cost more than forward ones.
    const rects = [box(0, 0), box(200, 0), box(90, 80)];
    expect(nextFocus(rects, 0, "right")).toBe(1);
  });

  it("moves through a grid by row and column", () => {
    // 3 x 2 swatches.
    const grid = [box(0, 0, 40, 40), box(60, 0, 40, 40), box(120, 0, 40, 40), box(0, 60, 40, 40), box(60, 60, 40, 40), box(120, 60, 40, 40)];
    expect(nextFocus(grid, 1, "down")).toBe(4);
    expect(nextFocus(grid, 4, "right")).toBe(5);
    expect(nextFocus(grid, 5, "up")).toBe(2);
  });
});
