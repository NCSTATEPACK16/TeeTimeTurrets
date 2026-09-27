import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the page has to download before the title screen can draw: everything `src/main.ts` reaches
 * through static imports. `REVAMP-PLAN.md` Stage 3 keeps Rapier out of it. The physics engine is
 * most of the bundle -- `rapier3d-compat` inlines its WASM as base64, about 2 MB of a 3.6 MB entry
 * -- and nothing on the title screen or in the clubhouse needs it. It is imported dynamically on
 * the first PLAY and prefetched while the title is up.
 *
 * Static imports only, and value imports only: a dynamic `import()` is the split this protects, and
 * a type import is erased before the bundler sees it. Bare specifiers are kept as `pkg:` nodes so a
 * path to a package can be reported, not just a path to a file.
 *
 * Lives in `tools/` with `importCycles.test.mjs` for the same reason: it reads the repo off disk.
 */

function staticValueImports(file) {
  const source = readFileSync(file, "utf8");
  const out = [];
  const pattern = /\bimport\s+([^;]*?)\s+from\s+"([^"]+)"\s*;/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    if (clause.startsWith("{")) {
      const specifiers = clause
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (specifiers.length > 0 && specifiers.every((s) => s.startsWith("type "))) continue;
    }
    const spec = match[2];
    if (!spec.startsWith(".")) {
      out.push(`pkg:${spec}`);
      continue;
    }
    const target = normalize(join(dirname(file), spec));
    // A JSON graph or any other asset is a leaf: it imports nothing.
    out.push(target.endsWith(".ts") || /\.[a-z]+$/.test(target) ? target : `${target}.ts`);
  }
  return out;
}

/** `import("...")` specifiers: the loads this test exists to keep dynamic. */
function dynamicImports(file) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
}

/** The import chain from `start` to `target`, or null if `target` is not reached. */
function pathTo(start, target) {
  const parent = new Map([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === target) break;
    if (file.startsWith("pkg:") || !file.endsWith(".ts")) continue;
    for (const next of staticValueImports(file)) {
      if (parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  if (!parent.has(target)) return null;
  const chain = [];
  for (let node = target; node !== null; node = parent.get(node)) chain.unshift(node);
  return chain;
}

const RAPIER = "pkg:@dimforge/rapier3d-compat";
const GLTF = "pkg:three/examples/jsm/loaders/GLTFLoader.js";

describe("the page's entry chunk", () => {
  it("does not load Rapier until a match needs it", () => {
    expect(pathTo(join("src", "main.ts"), RAPIER)?.join(" -> ") ?? null).toBeNull();
  });

  it("does not load GLTFLoader until a decorative model is asked for", () => {
    expect(pathTo(join("src", "main.ts"), GLTF)?.join(" -> ") ?? null).toBeNull();
  });

  it("still loads both, dynamically, from where they are needed", () => {
    // The split, not a deletion: the page does reach the sim, and the clubhouse does reach the loader.
    expect(dynamicImports(join("src", "main.ts"))).toContain("./sim/world");
    expect(dynamicImports(join("src", "render", "decor.ts"))).toContain("three/examples/jsm/loaders/GLTFLoader.js");
  });

  it("sees Rapier from the sim, so the checks above are not vacuous", () => {
    // A reader that found no imports at all would pass both checks forever.
    expect(pathTo(join("src", "sim", "world.ts"), RAPIER)).toEqual([join("src", "sim", "world.ts"), RAPIER]);
    expect(pathTo(join("src", "main.ts"), "pkg:three")).not.toBeNull();
    // Through the JSON-importing graph modules, which a reader that choked on them would not reach.
    expect(pathTo(join("src", "main.ts"), join("src", "entities", "graphs", "cart.json"))).not.toBeNull();
  });
});
