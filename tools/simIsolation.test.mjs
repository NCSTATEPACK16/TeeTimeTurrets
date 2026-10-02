import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gameplay does not depend on anything a player can set for looks or comfort. The quality presets
 * (`src/render/quality.ts`) and the settings (`src/app/settings.ts`) are the obvious ways it could
 * start to: a tree cap read by collision, a shadow toggle read by bot sight. So nothing under
 * `src/sim/**` or `src/physics/**` may import from `src/render/**`, `src/ui/**` or `src/app/**`,
 * type-only imports included -- a type is how a value's shape leaks in first.
 */

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(path));
    else if (path.endsWith(".ts") && !path.includes(".test.")) out.push(path);
  }
  return out;
}

const FORBIDDEN = /from\s+"(\.\.\/)+(render|ui|app)\//;

describe("the simulation", () => {
  it("imports nothing from render, ui or app, so no preset or setting can change a match", () => {
    const offenders = [...files(join("src", "sim")), ...files(join("src", "physics"))].filter((file) =>
      FORBIDDEN.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("reads the real tree", () => {
    expect(files(join("src", "sim")).length).toBeGreaterThan(30);
    expect(FORBIDDEN.test('import { QUALITY_PRESETS } from "../render/quality";')).toBe(true);
    expect(FORBIDDEN.test('import type { Settings } from "../../app/settings";')).toBe(true);
  });
});
