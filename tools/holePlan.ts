/**
 * Hole plan renderer. Imports the REAL src/sim modules (no copies) and rasterises every hole of
 * a course to a true top-down orthographic SVG plan.
 *
 * This exists because a concept-art "aerial" of a hole is a plausible painting, while this is
 * correct by construction: every pixel of surface colour comes from `surfaces.surfaceAt`, every
 * contour from `terrain.heightAt`, and the centreline from the same spline the carving uses. If
 * the plan and the game disagree, the plan is right and the renderer has a bug -- they read the
 * same functions.
 *
 * DOM-free and Three-free by construction, which is what lets it run in Node at all: see the
 * AGENTS.md invariant that `src/sim/**` stays Node-runnable. Built via a vite SSR build (see
 * `tools/holePlan.vite.config.ts`), then `node tools/.plan-out/holePlan.mjs`.
 *
 * Usage:  npm run plan [-- --seed=<uint32> --holes=<n> --out=<dir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "../src/sim/carry";
import { generateCourse } from "../src/sim/course";
import type { HoleSpec } from "../src/sim/course";
import { BLEND_WIDTH, createTerrain, halfWidthAt } from "../src/sim/terrain";
import type { Terrain } from "../src/sim/terrain";
import { SurfaceId, createSurfaces } from "../src/sim/surfaces";
import type { Surfaces } from "../src/sim/surfaces";

/**
 * (Moved to src/sim/course.ts, where validateHole check 6 also needs it. Kept as a re-export
 * comment anchor only.)
 *
 * The driver's carry, in metres, as distinct from REFERENCE_CARRY_M's 129 m total. Both numbers
 * come from the same Phase 0 probe measurement documented on REFERENCE_CARRY_M in course.ts:
 * 129 m total = 69.5 m carry + 59.5 m roll-out.
 *
 * Both rings matter and they answer different questions. The carry ring is where the ball first
 * touches down, so it is the one a forced carry over water has to clear; the total ring is where
 * it comes to rest, so it is the one that decides whether a green is reachable. A plan that drew
 * only one of them would silently mislead on half the design decisions.
 */


/** Plot area, px. The SVG scales to fit, so a 160 m par 3 and a 300 m par 5 render the same size. */
const PLOT_PX = 1000;
/** Room for the title block and the scale bar. */
const MARGIN_PX = 64;

/**
 * Surface samples per axis, fixed rather than derived from fieldSize so every plan costs the
 * same to draw and to diff regardless of the hole's size. At 200 across a 300 m field that is a
 * 1.5 m sample; across a 160 m field, 0.8 m.
 */
const SURFACE_SAMPLES = 200;
/**
 * Contours are low-frequency, so they get a coarser grid than the surface fill. The cost is
 * quadratic in this number and the contour path is the single largest thing in the file, so it
 * is set as coarse as still reads smoothly rather than as fine as the terrain supports.
 */
const CONTOUR_SAMPLES = 80;
/** Aim for roughly this many contour lines; the interval is chosen per hole to land near it. */
const TARGET_CONTOURS = 9;
/** Centreline polyline resolution. */
const CENTRELINE_STEPS = 240;

/**
 * Flat cartoon palette, matching the art direction in docs/concept/ -- saturated, unshaded, no
 * naturalistic grading. These are plan-view colours for reading a layout, deliberately NOT the
 * in-game material colours: a plan wants maximum separation between adjacent surface types, and
 * the game wants the hole to look like a golf course.
 */
const SURFACE_FILL: Readonly<Record<SurfaceId, string>> = {
  [SurfaceId.Green]: "#8fd94f",
  [SurfaceId.Fairway]: "#5cb85c",
  [SurfaceId.Rough]: "#2f7d43",
  [SurfaceId.Sand]: "#e6cf9b",
  [SurfaceId.Water]: "#3f86d4",
  // The drivable crossing. Warm against the pond's blue on purpose: a plan is read to answer "can
  // I get across here?", and a deck that tinted toward the water would answer it wrongly.
  [SurfaceId.Bridge]: "#b08046",
};

interface Projection {
  /** World metres -> plot pixels. */
  readonly scale: number;
  x(worldX: number): number;
  y(worldZ: number): number;
}

function createProjection(fieldSize: number): Projection {
  const scale = PLOT_PX / fieldSize;
  return {
    scale,
    // World +X runs right and world +Z runs *down* the page, which is the same handedness the
    // heightfield uses (row -> Z, col -> X). Flipping Z here would mirror every dog-leg.
    x: (worldX: number) => MARGIN_PX + (worldX + fieldSize / 2) * scale,
    y: (worldZ: number) => MARGIN_PX + (worldZ + fieldSize / 2) * scale,
  };
}

/**
 * One decimal. These files are committed, and the contour path alone is thousands of segments --
 * at two decimals the set runs 3.7 MB. A tenth of a pixel is well under what a 1128 px render can
 * show, so the precision buys nothing and costs a third of the file size.
 */
function round(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Surface fill as run-length-encoded rows. One `<rect>` per sample would be 40,000 elements for
 * a single hole; merging horizontal runs of the same surface takes that to a few thousand, which
 * is what keeps these files small enough to be worth committing and diffing.
 */
function renderSurfaces(spec: HoleSpec, surfaces: Surfaces, p: Projection): string {
  const step = spec.fieldSize / SURFACE_SAMPLES;
  const px = (PLOT_PX / SURFACE_SAMPLES) + 0.5; // +0.5 overdraw kills hairline seams between runs
  const out: string[] = [];

  for (let row = 0; row < SURFACE_SAMPLES; row++) {
    const worldZ = -spec.fieldSize / 2 + (row + 0.5) * step;
    const y = MARGIN_PX + row * (PLOT_PX / SURFACE_SAMPLES);

    let runStart = 0;
    let runSurface = surfaces.surfaceAt(-spec.fieldSize / 2 + 0.5 * step, worldZ);

    for (let col = 1; col <= SURFACE_SAMPLES; col++) {
      const surface =
        col === SURFACE_SAMPLES
          ? null
          : surfaces.surfaceAt(-spec.fieldSize / 2 + (col + 0.5) * step, worldZ);
      if (surface === runSurface) continue;

      const x = MARGIN_PX + runStart * (PLOT_PX / SURFACE_SAMPLES);
      const width = (col - runStart) * (PLOT_PX / SURFACE_SAMPLES) + 0.5;
      out.push(
        `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(px)}" fill="${SURFACE_FILL[runSurface]}"/>`,
      );
      if (surface === null) break;
      runStart = col;
      runSurface = surface;
    }
  }
  return out.join("");
}

/**
 * Marching squares over `heightAt`. Saddle cells (four crossings) are paired in a fixed order
 * rather than disambiguated by the centre value -- a contour plot for reading terrain shape does
 * not need the topologically correct branch, and picking one keeps this readable.
 */
function renderContours(spec: HoleSpec, terrain: Terrain, p: Projection): { svg: string; interval: number } {
  const n = CONTOUR_SAMPLES;
  const step = spec.fieldSize / n;
  const grid = new Float64Array((n + 1) * (n + 1));
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row <= n; row++) {
    const worldZ = -spec.fieldSize / 2 + row * step;
    for (let col = 0; col <= n; col++) {
      const worldX = -spec.fieldSize / 2 + col * step;
      const h = terrain.heightAt(worldX, worldZ);
      grid[row * (n + 1) + col] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  // A "nice" interval (1, 2, 5 x 10^k) near range/TARGET_CONTOURS, so the legend reads in round
  // numbers instead of 0.3714 m.
  const raw = (max - min) / TARGET_CONTOURS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const normalised = raw / magnitude;
  const interval = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;

  const segments: string[] = [];
  const worldOf = (col: number, row: number) => ({
    x: -spec.fieldSize / 2 + col * step,
    z: -spec.fieldSize / 2 + row * step,
  });

  for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const h00 = grid[row * (n + 1) + col]!;
        const h10 = grid[row * (n + 1) + col + 1]!;
        const h11 = grid[(row + 1) * (n + 1) + col + 1]!;
        const h01 = grid[(row + 1) * (n + 1) + col]!;

        const crossings: { x: number; y: number }[] = [];
        const edge = (
          ha: number,
          hb: number,
          ax: number,
          az: number,
          bx: number,
          bz: number,
        ): void => {
          if (ha < level === hb < level) return;
          const t = (level - ha) / (hb - ha);
          crossings.push({ x: p.x(ax + (bx - ax) * t), y: p.y(az + (bz - az) * t) });
        };

        const a = worldOf(col, row);
        const b = worldOf(col + 1, row);
        const c = worldOf(col + 1, row + 1);
        const d = worldOf(col, row + 1);
        edge(h00, h10, a.x, a.z, b.x, b.z);
        edge(h10, h11, b.x, b.z, c.x, c.z);
        edge(h11, h01, c.x, c.z, d.x, d.z);
        edge(h01, h00, d.x, d.z, a.x, a.z);

        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const from = crossings[i]!;
          const to = crossings[i + 1]!;
          segments.push(`M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}`);
        }
      }
    }
  }

  return {
    svg: `<path d="${segments.join("")}" fill="none" stroke="#1d3b24" stroke-width="0.7" stroke-opacity="0.32"/>`,
    interval,
  };
}

/** Centreline, plus the corridor edges offset along the spline normal. */
function renderCorridor(terrain: Terrain, p: Projection): string {
  const spline = terrain.spline;
  const corridor = terrain.spec.corridor;
  const centre: string[] = [];
  const left: string[] = [];
  const right: string[] = [];
  const tangent = { x: 0, z: 0 };

  for (let i = 0; i <= CENTRELINE_STEPS; i++) {
    const t = i / CENTRELINE_STEPS;
    const point = spline.pointAt(t);
    spline.tangentInto(t, tangent);
    const normalX = -tangent.z;
    const normalZ = tangent.x;

    // The hole's own half-width at this t, not a global constant: since Tier 2 a corridor
    // pinches and reopens, and an edge drawn at a fixed width would be a picture of a different
    // hole from the one the physics runs.
    const half = halfWidthAt(corridor, t);

    centre.push(`${round(p.x(point.x))} ${round(p.y(point.z))}`);
    left.push(`${round(p.x(point.x + normalX * half))} ${round(p.y(point.z + normalZ * half))}`);
    right.push(`${round(p.x(point.x - normalX * half))} ${round(p.y(point.z - normalZ * half))}`);
  }

  return [
    `<polyline points="${left.join(" ")}" fill="none" stroke="#14532d" stroke-width="1.5" stroke-opacity="0.55" stroke-dasharray="6 5"/>`,
    `<polyline points="${right.join(" ")}" fill="none" stroke="#14532d" stroke-width="1.5" stroke-opacity="0.55" stroke-dasharray="6 5"/>`,
    `<polyline points="${centre.join(" ")}" fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.75" stroke-dasharray="10 8"/>`,
  ].join("");
}

/**
 * Distance rings from the tee. These are what make this a design tool rather than a picture:
 * you can see at a glance where a drive lands, which is the question every hazard placement is
 * really answering.
 */
function renderDistanceRings(spec: HoleSpec, p: Projection): string {
  const cx = p.x(spec.tee.x);
  const cy = p.y(spec.tee.z);

  // Labels sit on the ring along the tee->cup bearing rather than at its top. On a 160 m field
  // the 129 m ring runs off the plot, and a top-anchored label ends up in the title block; the
  // playing line is always inside the field, so it is both in-bounds and where the eye already is.
  const toCupX = spec.cup.x - spec.tee.x;
  const toCupZ = spec.cup.z - spec.tee.z;
  const bearing = Math.hypot(toCupX, toCupZ) || 1;
  const dirX = toCupX / bearing;
  const dirZ = toCupZ / bearing;

  const ring = (metres: number, label: string, dash: string): string => {
    const r = metres * p.scale;
    const labelX = cx + dirX * r;
    const labelY = cy + dirZ * r;
    return (
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" ` +
      `stroke="#ffffff" stroke-width="1.6" stroke-opacity="0.6" stroke-dasharray="${dash}"/>` +
      `<text x="${round(labelX)}" y="${round(labelY - 8)}" fill="#ffffff" fill-opacity="0.9" ` +
      `stroke="#1a1a1a" stroke-width="2.5" stroke-opacity="0.35" paint-order="stroke" ` +
      `font-family="ui-monospace,Menlo,monospace" font-size="15" text-anchor="middle">${label}</text>`
    );
  };
  return (
    ring(DRIVER_CARRY_M, `${DRIVER_CARRY_M}m carry`, "3 6") +
    ring(REFERENCE_CARRY_M, `${REFERENCE_CARRY_M}m total`, "9 6")
  );
}

function renderMarkers(spec: HoleSpec, p: Projection): string {
  const teeX = p.x(spec.tee.x);
  const teeY = p.y(spec.tee.z);
  const cupX = p.x(spec.cup.x);
  const cupY = p.y(spec.cup.z);
  // The green as its actual ellipse, rotation included -- an ellipse drawn as a circle would
  // put the putting surface somewhere it is not.
  const g = spec.green;
  const greenOutline =
    `<ellipse cx="${round(p.x(g.x))}" cy="${round(p.y(g.z))}" ` +
    `rx="${round(g.radiusX * p.scale)}" ry="${round(g.radiusZ * p.scale)}" ` +
    `transform="rotate(${round((g.rotation * 180) / Math.PI)} ${round(p.x(g.x))} ${round(p.y(g.z))})" ` +
    `fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.9"/>`;

  return [
    greenOutline,
    // Flagstick, drawn as a pole and pennant so the cup reads at a glance next to the tee square.
    `<line x1="${round(cupX)}" y1="${round(cupY)}" x2="${round(cupX)}" y2="${round(cupY - 26)}" stroke="#1a1a1a" stroke-width="2.2"/>`,
    `<polygon points="${round(cupX)},${round(cupY - 26)} ${round(cupX + 16)},${round(cupY - 21)} ${round(cupX)},${round(cupY - 16)}" fill="#e23b3b"/>`,
    `<circle cx="${round(cupX)}" cy="${round(cupY)}" r="3.2" fill="#1a1a1a"/>`,
    `<rect x="${round(teeX - 6)}" y="${round(teeY - 6)}" width="12" height="12" fill="#ffffff" stroke="#1a1a1a" stroke-width="2"/>`,
    `<text x="${round(teeX)}" y="${round(teeY + 26)}" fill="#ffffff" font-family="ui-monospace,Menlo,monospace" font-size="15" text-anchor="middle">TEE</text>`,
  ].join("");
}

/** Scale bar sized to a round number of metres near a fifth of the field. */
function renderScaleBar(spec: HoleSpec, p: Projection): string {
  const rough = spec.fieldSize / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const metres = Math.round(rough / magnitude) * magnitude;
  const width = metres * p.scale;
  const x = MARGIN_PX;
  const y = MARGIN_PX + PLOT_PX + 26;
  return [
    `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + width)}" y2="${round(y)}" stroke="#1a1a1a" stroke-width="3"/>`,
    `<line x1="${round(x)}" y1="${round(y - 5)}" x2="${round(x)}" y2="${round(y + 5)}" stroke="#1a1a1a" stroke-width="3"/>`,
    `<line x1="${round(x + width)}" y1="${round(y - 5)}" x2="${round(x + width)}" y2="${round(y + 5)}" stroke="#1a1a1a" stroke-width="3"/>`,
    `<text x="${round(x + width / 2)}" y="${round(y + 21)}" fill="#1a1a1a" font-family="ui-monospace,Menlo,monospace" font-size="15" text-anchor="middle">${metres} m</text>`,
  ].join("");
}

function renderTitleBlock(
  spec: HoleSpec,
  terrain: Terrain,
  contourInterval: number,
): string {
  const separation = Math.hypot(spec.cup.x - spec.tee.x, spec.cup.z - spec.tee.z);
  const left = MARGIN_PX;
  const right = MARGIN_PX + PLOT_PX;

  const facts = [
    `par ${spec.par}`,
    spec.biome,
    `corridor ${terrain.spline.length.toFixed(0)} m`,
    `tee-cup ${separation.toFixed(0)} m`,
    `field ${spec.fieldSize} m`,
    `mow ${((spec.stripeAngle * 180) / Math.PI).toFixed(0)}°`,
    `contours ${contourInterval} m`,
    `seed 0x${(spec.seed >>> 0).toString(16)}`,
  ].join("   ·   ");

  return [
    `<text x="${left}" y="${MARGIN_PX - 26}" fill="#1a1a1a" font-family="ui-monospace,Menlo,monospace" font-size="30" font-weight="bold">HOLE ${spec.index + 1}</text>`,
    `<text x="${left}" y="${MARGIN_PX - 8}" fill="#4a4a4a" font-family="ui-monospace,Menlo,monospace" font-size="15">${escapeText(facts)}</text>`,
    // North arrow. World -Z is "up" the page, so up the page is north by convention here.
    `<text x="${right}" y="${MARGIN_PX - 30}" fill="#1a1a1a" font-family="ui-monospace,Menlo,monospace" font-size="15" text-anchor="end">N</text>`,
    `<polygon points="${right - 5},${MARGIN_PX - 26} ${right - 11},${MARGIN_PX - 12} ${right},${MARGIN_PX - 12}" fill="#1a1a1a"/>`,
  ].join("");
}

function renderLegend(): string {
  const y = MARGIN_PX + PLOT_PX + 26;
  const entries: [SurfaceId, string][] = [
    [SurfaceId.Green, "green"],
    [SurfaceId.Fairway, "fairway"],
    [SurfaceId.Rough, "rough"],
    [SurfaceId.Sand, "sand"],
    [SurfaceId.Water, "water"],
  ];
  let x = MARGIN_PX + PLOT_PX - 470;
  const out: string[] = [];
  for (const [id, label] of entries) {
    out.push(
      `<rect x="${x}" y="${y - 11}" width="15" height="15" fill="${SURFACE_FILL[id]}" stroke="#1a1a1a" stroke-width="1"/>`,
      `<text x="${x + 21}" y="${y + 1}" fill="#1a1a1a" font-family="ui-monospace,Menlo,monospace" font-size="14">${label}</text>`,
    );
    x += 95;
  }
  return out.join("");
}

export function renderHolePlan(spec: HoleSpec): string {
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  const p = createProjection(spec.fieldSize);
  const contours = renderContours(spec, terrain, p);

  const width = PLOT_PX + MARGIN_PX * 2;
  const height = PLOT_PX + MARGIN_PX * 2 + 26;

  // Per-hole rather than a bare "plot": SVG ids are document-global, so two plans inlined into
  // one HTML page would share a clipPath and the second would be clipped by the first's rect.
  const clipId = `plot-${spec.index + 1}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#f4f1e8"/>` +
    // Everything inside the plot is clipped to it: distance rings routinely run past the field
    // edge (a 129 m ring on a 160 m field), and unclipped they spill into the title block.
    `<defs><clipPath id="${clipId}"><rect x="${MARGIN_PX}" y="${MARGIN_PX}" width="${PLOT_PX}" height="${PLOT_PX}"/></clipPath></defs>` +
    `<g clip-path="url(#${clipId})">` +
    renderSurfaces(spec, surfaces, p) +
    contours.svg +
    renderCorridor(terrain, p) +
    renderDistanceRings(spec, p) +
    renderMarkers(spec, p) +
    `</g>` +
    `<rect x="${MARGIN_PX}" y="${MARGIN_PX}" width="${PLOT_PX}" height="${PLOT_PX}" fill="none" stroke="#1a1a1a" stroke-width="2"/>` +
    renderTitleBlock(spec, terrain, contours.interval) +
    renderScaleBar(spec, p) +
    renderLegend() +
    `</svg>\n`
  );
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.slice(name.length + 3), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function main(): void {
  // Fixed default so `npm run plan` twice in a row produces a clean `git diff` -- the plans are
  // committed, and a wall-clock or random seed would make every run a spurious change.
  const seed = parseArg("seed", 0x7ee7c0);
  const holeCount = parseArg("holes", 18);
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outDir = outArg === undefined ? join("docs", "course", "plans") : outArg.slice(6);

  mkdirSync(outDir, { recursive: true });
  const course = generateCourse(seed, holeCount);

  console.log(`course 0x${(seed >>> 0).toString(16)} -> ${outDir}`);
  let totalPar = 0;
  for (const spec of course.holes) {
    const name = `hole-${String(spec.index + 1).padStart(2, "0")}.svg`;
    writeFileSync(join(outDir, name), renderHolePlan(spec), "utf8");
    totalPar += spec.par;
    const terrain = createTerrain(spec);
    console.log(
      `  ${name}  par ${spec.par}  corridor ${terrain.spline.length.toFixed(0).padStart(3)} m  field ${spec.fieldSize} m`,
    );
  }
  console.log(`  total par ${totalPar} over ${course.holes.length} holes`);
}

main();
