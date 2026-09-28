import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The first chunk the browser loads -- the title, the clubhouse, the settings -- must not contain
 * Rapier. Its WASM ships inline and is most of the download; the match path reaches it through one
 * dynamic import (`src/app/matchPath.ts`) that the title prefetches. A single static import of
 * anything that imports Rapier, however far down, puts all of it back in front of the menu: a
 * `POOL_SIZE` taken from `BallPool.ts` by the ball renderer once did exactly that.
 *
 * Walks the static value imports from `src/main.ts` -- `import ... from` and `export ... from`,
 * never `import type` and never a dynamic `import()`, since the bundler splits on exactly those.
 */

const RAPIER = "@dimforge/rapier3d-compat";

/** A module's static value dependencies: relative ones resolved to files, and bare package names. */
function staticImports(file) {
  const source = readFileSync(file, "utf8");
  const relative = [];
  const packages = [];
  // No `;` inside the clause, so one statement cannot run on into the next one's specifier.
  const pattern = /\b(import|export)\s+([^;]*?)\s+from\s+"([^"]+)"\s*;/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[2].trim();
    if (clause.startsWith("type ")) continue;
    if (clause.startsWith("{")) {
      const names = clause.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length > 0 && names.every((s) => s.startsWith("type "))) continue;
    }
    const specifier = match[3];
    if (!specifier.startsWith(".")) {
      packages.push(specifier);
      continue;
    }
    const target = normalize(join(dirname(file), specifier));
    relative.push(target.endsWith(".ts") ? target : `${target}.ts`);
  }
  return { relative, packages };
}

/** Every module statically reachable from `entry`, with the package imports of each. */
function reachable(entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    const imports = staticImports(file);
    seen.set(file, imports.packages);
    queue.push(...imports.relative);
  }
  return seen;
}

describe("the first chunk", () => {
  it("reaches Rapier through no static import from src/main.ts", () => {
    const graph = reachable(join("src", "main.ts"));
    const importers = [...graph.entries()].filter(([, packages]) => packages.includes(RAPIER)).map(([file]) => file);
    expect(importers).toEqual([]);
  });

  /** The controls: the walk covers the screens the title shows, and it can see Rapier where it is. */
  it("walks the title's screens, and finds Rapier from the match path", () => {
    const graph = reachable(join("src", "main.ts"));
    expect(graph.has(join("src", "ui", "screens", "TitleScreen.ts"))).toBe(true);
    expect(graph.has(join("src", "ui", "screens", "ClubhouseScreen.ts"))).toBe(true);
    expect(graph.has(join("src", "entities", "BallSwarm.ts"))).toBe(true);
    const match = reachable(join("src", "app", "matchPath.ts"));
    expect([...match.values()].some((packages) => packages.includes(RAPIER))).toBe(true);
  });
});
