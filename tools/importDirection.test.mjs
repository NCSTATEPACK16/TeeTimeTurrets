import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Which way imports may point, as AGENTS.md sets it out: `src/sim/**` and `src/physics/**` are the
 * authoritative, Node-runnable core, and the render, entity, UI and app layers are consumers of
 * it. A core file that imports `three`, or reaches up into a consumer, is a failed change -- the
 * multiplayer server has to run the core with none of the browser behind it.
 *
 * Type-only imports count too: they are erased, but a core type written in terms of a render type
 * is the same dependency pointing the wrong way, waiting to become a value import.
 *
 * Test files are exempt: a sim test may build a scene to check what it draws.
 */

const CORE = ["src/sim", "src/physics"];
const CONSUMERS = ["src/render", "src/entities", "src/ui", "src/app", "src/input", "src/audio", "src/engine"];
const FORBIDDEN_PACKAGES = ["three"];

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function importsOf(file) {
  const text = readFileSync(file, "utf8");
  const out = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

export function violations(roots = CORE) {
  const found = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) {
          const target = normalize(join(dirname(file), spec));
          if (CONSUMERS.some((c) => target === c || target.startsWith(c + "/"))) found.push(`${file} -> ${spec}`);
        } else if (FORBIDDEN_PACKAGES.some((p) => spec === p || spec.startsWith(p + "/"))) {
          found.push(`${file} -> ${spec}`);
        }
      }
    }
  }
  return found;
}

describe("import direction", () => {
  it("keeps the sim and physics free of three and of every consumer layer", () => {
    expect(violations()).toEqual([]);
  });

  it("would see a violation: the render layer imports three", () => {
    expect(violations(["src/render"]).some((v) => v.endsWith("-> three"))).toBe(true);
  });
});
