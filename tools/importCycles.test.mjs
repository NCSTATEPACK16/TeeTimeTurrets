import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A value-import cycle in `src/**` is a shipping hazard, not a style complaint, and this is the
 * only check in the suite that can see one.
 *
 * The bug it exists to prevent shipped. `placement.ts` computed a module-level constant from
 * `WOODS_WEIGHT`, exported by `surfaces.ts`, and the graph was
 * `course -> placement -> surfaces -> course`. Rollup emitted `surfaces.ts`'s initialiser *after*
 * `placement.ts`'s module body, and the minifier had rewritten the `const` as a hoisted `var`, so
 * the read returned `undefined` instead of throwing a TDZ error. The derived constant became NaN,
 * every bunker on all eighteen holes got NaN coordinates, `heightAt` returned NaN everywhere, and
 * the built game rendered a plain blue rectangle -- sky, and not one vertex of anything else.
 *
 * `npm test` could not see it and still cannot see it directly: an unbundled ESM graph evaluates a
 * cycle in the order the language specifies, so the value is always initialised in time here. The
 * defect exists only after bundling. What a test *can* check is the precondition -- that no cycle
 * exists for a bundler to order wrongly -- and that is what this asserts.
 *
 * Lives in `tools/` beside `gateCompare.test.mjs` rather than in `src/`: it reads the repo off
 * disk with `node:fs`, and `src/**` is typechecked as browser code with no node types. It is a
 * test about the shape of the module graph, not about the game.
 *
 * Type-only imports are excluded because they are erased before a bundler ever sees them and
 * cannot participate in an initialisation order. Both spellings are excluded: a whole-statement
 * `import type { X } from`, and an `import { type X } from` whose every specifier is inline-typed.
 *
 * Test files are excluded from the graph: nothing imports them, so they cannot be in a cycle.
 *
 * **When this fails**, do not silence it by making the derived value lazy. Move the shared
 * constant into a module that is strictly upstream of both ends with no path back -- that is what
 * `terrain.ts` is for `WOODS_WEIGHT` and what `carry.ts` is for the two driver distances.
 */

const ROOT = "src";

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/**
 * Relative-path value imports only. The clause is matched without a `;` in it so one statement
 * cannot swallow the next -- a lazy match running from `import * as THREE from "three"` into the
 * following line's relative specifier reports edges that do not exist, and the first draft of this
 * detector did exactly that on `terrain.ts`.
 */
function valueImports(file) {
  const source = readFileSync(file, "utf8");
  const out = [];
  const pattern = /\bimport\s+([^;]*?)\s+from\s+"(\.[^"]+)"\s*;/g;
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
    const target = normalize(join(dirname(file), match[2]));
    out.push(target.endsWith(".ts") ? target : `${target}.ts`);
  }
  return out;
}

function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];

  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 2);
  }

  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

describe("the src/** module graph", () => {
  it("has no value-import cycle for a bundler to order wrongly", () => {
    const files = sourceFiles(ROOT);
    const known = new Set(files);
    const graph = new Map(
      files.map((file) => [file, valueImports(file).filter((target) => known.has(target))]),
    );

    const cycles = findCycles(graph).map((cycle) =>
      cycle.map((file) => relative(ROOT, file)).join(" -> "),
    );
    expect(cycles).toEqual([]);
  });

  it("sees a cycle when there is one, so the check above is not vacuous", () => {
    // The exact shape that shipped, as a synthetic graph. The assertion above passing means
    // nothing unless the detector can still fail: a traversal that never reported anything would
    // satisfy it forever.
    const graph = new Map([
      ["src/sim/course.ts", ["src/sim/placement.ts"]],
      ["src/sim/placement.ts", ["src/sim/surfaces.ts"]],
      ["src/sim/surfaces.ts", ["src/sim/course.ts"]],
    ]);
    expect(findCycles(graph)).toEqual([
      ["src/sim/course.ts", "src/sim/placement.ts", "src/sim/surfaces.ts", "src/sim/course.ts"],
    ]);
  });

  it("reads the real graph, not an empty one", () => {
    // Guards the other half. `valueImports` returning nothing, or `sourceFiles` finding nothing,
    // would also make the cycle check pass, so both are pinned to facts about this repo.
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(30);
    expect(valueImports(join("src", "sim", "placement.ts"))).toContain(
      join("src", "sim", "terrain.ts"),
    );
    // A type-only import must not appear, or the check reports cycles a bundler never sees.
    expect(valueImports(join("src", "sim", "terrain.ts"))).not.toContain(
      join("src", "sim", "course.ts"),
    );
  });
});
