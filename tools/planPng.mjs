/**
 * Rasterises the SVG hole plans written by `npm run plan` into PNGs.
 *
 * Two consumers, and they are different jobs. The SVGs are the reviewable, diffable artifact and
 * are what gets committed; the PNGs are throwaway, and exist because an image model needs a
 * raster to condition on. Feeding a plan PNG to Gemini image-to-image is what stops two holes
 * from collapsing into the same picture -- their conditioning images differ by construction, so
 * the outputs cannot converge the way two independent text-to-image draws did.
 *
 * Puppeteer rather than a raster library: it is already a devDependency (the scene gate and the
 * smoke check both use it), so this adds no new dependency to render an SVG correctly.
 *
 * Usage:  node tools/planPng.mjs [--in=<dir>] [--out=<dir>] [--scale=<n>]
 */
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer";

function arg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + 3);
}

const inDir = arg("in", join("docs", "course", "plans"));
// Default outside docs/: these are regenerable and an image model's input, not documentation.
//
// A sibling of tools/.plan-out rather than a child of it, and that is not cosmetic:
// holePlan.vite.config.ts sets `emptyOutDir: true` on tools/.plan-out, so every `npm run plan`
// wipes that directory. Writing the PNGs inside it meant regenerating the plans silently deleted
// the conditioning images COURSE_PIPELINE.md section 7.3 tells you to attach.
const outDir = arg("out", join("tools", ".plan-png"));
const scale = Number.parseFloat(arg("scale", "1"));

const files = readdirSync(inDir).filter((f) => f.endsWith(".svg")).sort();
if (files.length === 0) {
  console.error(`no .svg files in ${inDir} -- run \`npm run plan\` first`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch();
const page = await browser.newPage();

for (const file of files) {
  const svg = readFileSync(join(inDir, file), "utf8");
  const width = Number(svg.match(/width="(\d+)"/)?.[1] ?? 1128);
  const height = Number(svg.match(/height="(\d+)"/)?.[1] ?? 1154);

  await page.setViewport({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    deviceScaleFactor: 1,
  });
  // A data URL would need escaping the SVG; setContent with zeroed margins is exact.
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${Math.round(width * scale)}px;height:${Math.round(height * scale)}px}</style>${svg}`,
    { waitUntil: "load" },
  );

  const out = join(outDir, file.replace(/\.svg$/, ".png"));
  await page.screenshot({ path: resolve(out) });
  console.log(`  ${out}`);
}

await browser.close();
console.log(`${files.length} plan(s) rasterised to ${outDir}`);
