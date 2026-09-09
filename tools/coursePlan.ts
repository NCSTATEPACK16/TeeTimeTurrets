/**
 * Course plan renderer: where the eighteen holes sit relative to each other and the clubhouse.
 *
 * The sibling of `tools/holePlan.ts`. That one draws one hole in detail; this draws the routing --
 * the shape `src/sim/courseLayout.ts` solves, which is the thing worth arguing with before any
 * terrain is built on it. Both import the real `src/sim` modules, so neither can flatter the game.
 *
 * Corridor centrelines only, deliberately. Surfaces and contours at course scale collapse into a
 * wash; what this drawing is for is whether the routing closes, whether the walks are short and
 * whether two holes are trying to occupy the same ground.
 *
 * DOM-free and Three-free, like holePlan.ts, which is what lets it run in Node.
 *
 * Usage:  npm run plan:course [-- --seed=<uint32> --out=<file>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateCourse } from "../src/sim/course";
import { CLUBHOUSE_APRON_M, inspectLayout, solveCourseLayout } from "../src/sim/courseLayout";
import type { CourseLayout, LayoutHole } from "../src/sim/courseLayout";

const PLOT_PX = 1000;
const MARGIN_M = 80;

/** Front nine and back nine, so a returning-nines routing reads as two loops at a glance. */
const FRONT = "#7ee08a";
const BACK = "#7ab8f0";

interface Vec2 {
  readonly x: number;
  readonly z: number;
}

function parseArg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit === undefined ? NaN : Number(hit.slice(name.length + 3));
  return Number.isFinite(value) ? value : fallback;
}

function parseString(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

/** A hole's local point, in the course frame. */
function placed(layout: CourseLayout, index: number, p: Vec2): Vec2 {
  const q = layout.placements.find((r) => r.index === index);
  if (!q) return p;
  const cos = Math.cos(q.rotation);
  const sin = Math.sin(q.rotation);
  return { x: q.offsetX + p.x * cos - p.z * sin, z: q.offsetZ + p.x * sin + p.z * cos };
}

function round(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function main(): void {
  const seed = parseArg("seed", 2026);
  const out = parseString("out", "docs/course/plans/course.svg");

  const course = generateCourse(seed, 18);
  const holes: LayoutHole[] = course.holes.map((h) => ({
    index: h.index,
    tee: h.tee,
    cup: h.cup,
    control: h.control,
  }));
  const layout = solveCourseLayout(holes);
  const report = inspectLayout(holes, layout);

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const hole of holes) {
    for (const point of hole.control) {
      const w = placed(layout, hole.index, point);
      minX = Math.min(minX, w.x);
      maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z);
      maxZ = Math.max(maxZ, w.z);
    }
  }
  minX -= MARGIN_M;
  minZ -= MARGIN_M;
  maxX += MARGIN_M;
  maxZ += MARGIN_M;

  // One scale for both axes: a stretched routing misreports every angle on it.
  const scale = PLOT_PX / (maxX - minX);
  const height = Math.round((maxZ - minZ) * scale);
  const px = (x: number): number => (x - minX) * scale;
  const py = (z: number): number => (z - minZ) * scale;

  const parts: string[] = [`<rect width="${PLOT_PX}" height="${height}" fill="#12301c"/>`];

  const apron = CLUBHOUSE_APRON_M * scale;
  parts.push(
    `<circle cx="${round(px(layout.clubhouse.x))}" cy="${round(py(layout.clubhouse.z))}" r="${round(apron)}" fill="none" stroke="#ffd34d" stroke-width="2" stroke-opacity="0.6" stroke-dasharray="6 6"/>`,
  );

  for (const hole of holes) {
    const line = hole.control
      .map((p) => placed(layout, hole.index, p))
      .map((w) => `${round(px(w.x))} ${round(py(w.z))}`)
      .join(" ");
    parts.push(
      `<polyline points="${line}" fill="none" stroke="${hole.index < 9 ? FRONT : BACK}" stroke-width="9" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    );

    const tee = placed(layout, hole.index, hole.tee);
    const cup = placed(layout, hole.index, hole.cup);
    parts.push(
      `<rect x="${round(px(tee.x) - 3)}" y="${round(py(tee.z) - 3)}" width="6" height="6" fill="#ffffff"/>`,
      `<circle cx="${round(px(cup.x))}" cy="${round(py(cup.z))}" r="4" fill="#d94a3d"/>`,
      `<text x="${round(px(tee.x) + 8)}" y="${round(py(tee.z) - 6)}" fill="#ffffff" font-family="sans-serif" font-size="13" font-weight="600">${hole.index + 1}</text>`,
    );
  }

  parts.push(
    `<circle cx="${round(px(layout.clubhouse.x))}" cy="${round(py(layout.clubhouse.z))}" r="7" fill="#ffd34d"/>`,
  );

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PLOT_PX}" height="${height}" viewBox="0 0 ${PLOT_PX} ${height}">${parts.join("")}</svg>`,
  );

  console.log(`  ${out}`);
  console.log(`  footprint ${Math.round(maxX - minX - MARGIN_M * 2)} x ${Math.round(maxZ - minZ - MARGIN_M * 2)} m`);
  console.log(`  longest walk green to tee ${report.maxTransitionM.toFixed(1)} m`);
  console.log(`  hole 9 finishes ${report.frontReturnM.toFixed(1)} m from the clubhouse`);
  console.log(`  hole 18 finishes ${report.backReturnM.toFixed(1)} m from the clubhouse`);
  console.log(`  closest two corridors off the apron ${report.minClearanceM.toFixed(1)} m`);
  console.log(`  conflicts ${report.conflicts.length}`);
}

main();
