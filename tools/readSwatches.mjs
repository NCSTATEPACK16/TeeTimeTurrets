/**
 * Reads a biome colour sheet and emits the `BiomePalette` entry for it.
 *
 * This exists because the obvious two ways to get colours off one of these sheets both fail:
 *
 * 1. **Reading the printed hex codes does not work.** docs/COURSE_PIPELINE.md section 7.1 asks the
 *    image model to print each swatch's hex under it. On the first real parkland sheets, *not one*
 *    printed code matched its swatch: several were the literal string `#RRGGBB` copied out of the
 *    prompt, several contained non-hex characters (`#899G42`, `#0UEGBF`), several were seven
 *    characters long, and the ones that were valid hex named entirely different colours -- a
 *    magenta `#C11ACF` under a blue sky swatch. Image models draw text as pixels; they cannot
 *    encode precise alphanumerics. That instruction has been retired.
 * 2. **Eye-droppering a single pixel is noisy.** These arrive as JPEGs, so even a dead-flat swatch
 *    carries ringing of a few units per channel, and a single sample lands wherever it lands.
 *
 * Taking the *median* over the middle of each detected swatch fixes both: it is exact, repeatable,
 * and immune to both compression ringing and to whichever pixel a human would have clicked.
 *
 * The sheets are two stacked panels -- swatches above, prop silhouettes on their own darker ground
 * below -- so detection finds the seam between them first and reads only the panel above it. See
 * the comment on that step for what goes wrong without it.
 *
 * Usage:
 *   node tools/readSwatches.mjs <image> --biome=parkland
 *   node tools/readSwatches.mjs <image> --biome=links --map=0:green,1:fairway,...
 *   node tools/readSwatches.mjs <image> --inspect       (just list what it found)
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer";

/** The nine fields a sheet supplies, in the reading order the prompt asks for. */
const CANONICAL = [
  "green",
  "fairway",
  "rough",
  "sand",
  "water",
  "sky",
  "foliageLight",
  "foliageDark",
  "trunk",
];

/**
 * Pairs whose contrast carries real gameplay meaning, with the separation the shipped placeholder
 * palette achieves for each.
 *
 * These are *heuristic thresholds anchored to a known-good palette*, not measured constants: the
 * placeholders read correctly from the chase camera, so falling well under what they achieve is a
 * reason to look rather than a proof of failure. Relative luminance, Rec. 709.
 */
const CONTRAST_CHECKS = [
  { a: "fairway", b: "rough", min: 25, note: "the corridor edge -- the read the whole hole depends on" },
  { a: "green", b: "fairway", min: 20, note: "the putting surface against its approach" },
  { a: "foliageLight", b: "foliageDark", min: 20, note: "the two-tone flat-shaded tree read" },
];

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hex([r, g, b]) {
  return `0x${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function arg(name) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? null : raw.slice(name.length + 3);
}

const imagePath = process.argv[2];
if (!imagePath || imagePath.startsWith("--")) {
  console.error("usage: node tools/readSwatches.mjs <image> --biome=<parkland|links|marsh>");
  process.exit(1);
}
if (!existsSync(imagePath)) {
  console.error(`no such file: ${imagePath}`);
  process.exit(1);
}

const biome = arg("biome");
const inspect = process.argv.includes("--inspect");
if (!biome && !inspect) {
  console.error("pass --biome=<parkland|links|marsh>, or --inspect to just list what was found");
  process.exit(1);
}

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto(`file://${resolve(imagePath)}`, { waitUntil: "load" });

const found = await page.evaluate(async () => {
  const img = document.querySelector("img");
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // These sheets arrive as two stacked panels: the swatches on the sheet's own ground, and a row
  // of prop silhouettes below on a darker one. That breaks the two assumptions further down --
  // that the bottom edge is background, and that 0.6 * height clears the silhouettes -- and it
  // breaks them silently: the darker ground wins the background vote, every swatch then counts as
  // foreground, and the whole panel collapses into a single detected cell.
  //
  // So find the seam first. The left margin is bare ground in both panels, so walking down it and
  // taking the first colour change that *persists* (a stray label or antialiased pixel does not)
  // lands on the boundary. A one-panel sheet simply never changes, and everything below behaves
  // exactly as it did before.
  const marginX = Math.max(1, Math.round(W * 0.01));
  const marginBg = at(marginX, Math.max(1, Math.round(H * 0.02)));
  const differs = (p, q) => Math.abs(p[0] - q[0]) > 12 || Math.abs(p[1] - q[1]) > 12 || Math.abs(p[2] - q[2]) > 12;
  const persist = Math.max(4, Math.round(H * 0.03));
  let seam = H;
  for (let y = Math.round(H * 0.25); y < H - persist; y++) {
    if (!differs(at(marginX, y), marginBg)) continue;
    let held = true;
    for (let k = 1; k < persist && held; k++) if (!differs(at(marginX, y + k), marginBg)) held = false;
    if (held) {
      seam = y;
      break;
    }
  }

  // Background is the modal colour of the panel's own top and bottom edge strips.
  const counts = new Map();
  const strip = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [i, seam - 8 + i]);
  for (let x = 0; x < W; x += 4) {
    for (const y of strip) {
      const key = at(x, y).join(",");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bg = [0, 0, 0];
  let best = -1;
  for (const [key, n] of counts) {
    if (n > best) {
      best = n;
      bg = key.split(",").map(Number);
    }
  }
  const isBg = (p) => Math.abs(p[0] - bg[0]) <= 18 && Math.abs(p[1] - bg[1]) <= 18 && Math.abs(p[2] - bg[2]) <= 18;

  // Swatches occupy the upper region; the silhouette row sits below and must not be detected.
  const top = seam < H ? seam : Math.floor(H * 0.6);

  const bands = (mass, minLen) => {
    const threshold = Math.max(...mass) * 0.35;
    const out = [];
    let run = null;
    for (let i = 0; i < mass.length; i++) {
      if (mass[i] >= threshold) {
        if (run === null) run = i;
      } else if (run !== null) {
        if (i - run >= minLen) out.push([run, i]);
        run = null;
      }
    }
    if (run !== null && mass.length - run >= minLen) out.push([run, mass.length]);
    return out;
  };

  const colMass = [];
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < top; y += 3) if (!isBg(at(x, y))) n++;
    colMass.push(n);
  }
  const rowMass = [];
  for (let y = 0; y < top; y++) {
    let n = 0;
    for (let x = 0; x < W; x += 3) if (!isBg(at(x, y))) n++;
    rowMass.push(n);
  }

  const cols = bands(colMass, Math.floor(W * 0.05));
  const rows = bands(rowMass, Math.floor(H * 0.04));

  const median = (arr) => {
    arr.sort((p, q) => p - q);
    return arr[Math.floor(arr.length / 2)];
  };

  const cells = [];
  for (const [y0, y1] of rows) {
    for (const [x0, x1] of cols) {
      // Inner half only: labels, borders and antialiased edges never reach the sample.
      const ix0 = Math.round(x0 + (x1 - x0) * 0.25);
      const ix1 = Math.round(x0 + (x1 - x0) * 0.75);
      const iy0 = Math.round(y0 + (y1 - y0) * 0.25);
      const iy1 = Math.round(y0 + (y1 - y0) * 0.75);
      const rs = [], gs = [], bs = [];
      for (let x = ix0; x < ix1; x += 2) {
        for (let y = iy0; y < iy1; y += 2) {
          const p = at(x, y);
          rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
        }
      }
      if (rs.length === 0) continue;
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      const sd = (a) => {
        const m = mean(a);
        return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
      };
      cells.push({
        rgb: [median(rs.slice()), median(gs.slice()), median(bs.slice())],
        spread: Math.max(sd(rs), sd(gs), sd(bs)),
        box: [x0, y0, x1, y1],
      });
    }
  }
  return { W, H, bg, cells, cols: cols.length, rows: rows.length, seam };
});

await browser.close();

const panel = found.seam < found.H ? `, swatch panel above y=${found.seam}` : "";
console.log(`\n${imagePath}`);
console.log(`  ${found.W}x${found.H}${panel}, background rgb(${found.bg.join(", ")}), grid ${found.cols} x ${found.rows} = ${found.cells.length} swatches\n`);

found.cells.forEach((cell, i) => {
  const flat = cell.spread > 6 ? `  NOT FLAT (sd ${cell.spread.toFixed(1)}) -- gradient or texture` : "";
  console.log(`  [${String(i).padStart(2)}] ${hex(cell.rgb)}  rgb(${cell.rgb.join(", ")})${flat}`);
});

if (inspect) process.exit(0);

// Map cells to fields. Default to the canonical reading order, which is only safe when the sheet
// has exactly the nine swatches the prompt asked for -- the first real sheets came back with ten,
// one label duplicated to fill a 5x2 grid, and silently mapping those by position would assign
// every field after the duplicate to the wrong colour.
const mapArg = arg("map");
let mapping;
if (mapArg) {
  mapping = {};
  for (const pair of mapArg.split(",")) {
    const [index, field] = pair.split(":");
    if (!CANONICAL.includes(field)) {
      console.error(`\nunknown field "${field}" -- expected one of: ${CANONICAL.join(", ")}`);
      process.exit(1);
    }
    mapping[field] = found.cells[Number(index)]?.rgb;
    if (!mapping[field]) {
      console.error(`\nno swatch at index ${index}`);
      process.exit(1);
    }
  }
  const missing = CANONICAL.filter((f) => !(f in mapping));
  if (missing.length > 0) {
    console.error(`\n--map is missing: ${missing.join(", ")}`);
    process.exit(1);
  }
} else if (found.cells.length === CANONICAL.length) {
  mapping = Object.fromEntries(CANONICAL.map((f, i) => [f, found.cells[i].rgb]));
} else {
  console.error(
    `\nFound ${found.cells.length} swatches, expected ${CANONICAL.length}. Refusing to guess.\n` +
      `Read the labels off the sheet and pass an explicit map, e.g.\n\n` +
      `  --map=${CANONICAL.map((f, i) => `${i}:${f}`).join(",")}\n`,
  );
  process.exit(1);
}

const notFlat = found.cells.filter((c) => c.spread > 6);
if (notFlat.length > 0) {
  console.log(`\n  WARNING: ${notFlat.length} swatch(es) are not flat colour. The sheet was asked for`);
  console.log(`  solid uniform rectangles; a gradient means the median is an average, not the colour.`);
}

console.log("\n  contrast checks (Rec. 709 relative luminance):");
let anyLow = false;
for (const check of CONTRAST_CHECKS) {
  const delta = Math.abs(luminance(mapping[check.a]) - luminance(mapping[check.b]));
  const ok = delta >= check.min;
  if (!ok) anyLow = true;
  console.log(
    `    ${ok ? "ok  " : "LOW "} ${check.a} vs ${check.b}: ${delta.toFixed(1)} ` +
      `(want >= ${check.min}) -- ${check.note}`,
  );
}
if (anyLow) {
  console.log(`\n  A LOW result is a reason to look at the sheet in the game, not to reject it outright.`);
}

console.log(`\n  paste into src/render/biomes.ts:\n`);
console.log(`  ${biome}: {`);
for (const field of CANONICAL) {
  console.log(`    ${field}: ${hex(mapping[field])},`);
}
console.log(`    // treeDensity, treeHeight and treeForm are tuned, not sampled -- keep them.`);
console.log(`  },\n`);
