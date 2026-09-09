/**
 * Scene Gate -- AGENTS.md "Visual Critic / Scene Gate protocol", built as an independent design.
 * That section is explicit that the reference repo's comparator internals are Reserved Content
 * and must not be reverse-engineered; nothing here derives from them.
 *
 * Loads each subject on the fixed harness rig in headless Chrome, reads structural metrics off
 * the BufferGeometry and a downsampled perceptual signature off the canvas, and diffs both
 * against tools/gate-baseline/. Exits non-zero on drift.
 *
 * This is NOT tools/smoke.mjs: smoke drives the real input path and asserts no console errors,
 * and has no geometry baseline at all.
 *
 * Usage: npm run gate
 *        npm run gate -- --update-baseline    (review tools/.gate-out/*.png first)
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { compareMetrics, compareSignature } from "./gateCompare.mjs";

const PORT = 4174;
const DIST = "tools/.gate-dist";
const BASELINE_DIR = resolve("tools/gate-baseline");
const OUT_DIR = resolve("tools/.gate-out");
const UPDATE = process.argv.includes("--update-baseline");

const SUBJECTS = [
  "cart-driver",
  "cart-iron",
  "cart-putter",
  // The three above ship all three club heads and differ only by which is `visible`, so their
  // counts are identical and only the bbox and the signature tell them apart. These two differ
  // structurally: one is mid-backswing, one has no rider.
  "cart-backswing",
  "cart-empty",
  "cart-followthrough",
  "ball",
  "target",
  // Standing and felled are identical in every numeric check and obviously different in the
  // picture, which is what a gate screenshot is for. Keep this list in step with
  // tools/gate/gateScene.ts's SUBJECTS -- a subject added to only one of the two fails confusingly.
  "flagstick",
  "flagstick-felled",
  // The seven Blender-authored props, each merged to one draw call. Same rule as above: keep this
  // list in step with tools/gate/gateScene.ts's SUBJECTS, which builds these from PROP_NAMES.
  "tee_marker",
  "bunker_rake",
  "ball_washer",
  "distance_post",
  "cart_path_sign",
  "footbridge",
  // One 2 m module of the causeway deck, drawn on its own. The gate sees the section, never the
  // tiled run -- what a screenshot can settle here is the plank, the kerb and the railing, and the
  // run's geometry is settled against the crossing in props.test.ts instead.
  "boardwalk_section",
];

const server = spawn("npx", ["vite", "preview", "--outDir", DIST, "--port", String(PORT)], {
  stdio: "ignore",
});
process.on("exit", () => server.kill());

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`gate preview server did not start at ${url}`);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(resolve(BASELINE_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

await waitForServer(`http://localhost:${PORT}`, 20000);
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(BASELINE_DIR, { recursive: true });

// Software rasterisation, the same flag tools/smoke.mjs uses. This is what makes a signature
// portable between machines: every run goes through the same rasteriser rather than through
// whatever GPU driver happens to be installed.
//
// --no-sandbox/--disable-setuid-sandbox/--disable-dev-shm-usage: Chrome's OS-level sandbox needs
// privileges (an unprivileged user namespace, a writable /dev/shm) that most CI/build containers
// don't grant, and it protects against hostile page content -- moot here, since the only page
// ever loaded is this repo's own built output on localhost. Without these, launch() throws "No
// usable sandbox!" on exactly that class of host, which is what broke npm run build on Netlify.
const browser = await puppeteer.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

// try/finally so a mid-loop exception (a subject that never sets window.__gate.ready, a
// Puppeteer protocol error, a slow machine) still closes the browser before the script exits.
// The exception itself is deliberately left to propagate -- a subject that cannot render must
// crash the run, not be swallowed and skipped.
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });

  const baselineMetrics = readJson("metrics.json", {});
  const baselineSignatures = readJson("signatures.json", {});
  const nextMetrics = {};
  const nextSignatures = {};
  const failures = [];

  // The two subject lists -- this array and gateScene.ts's SUBJECTS -- have to agree, and a subject
  // added to only one of them otherwise fails as "unknown gate subject" or as a silently unrendered
  // asset. The harness already publishes its own list, so compare them once and say which side is
  // missing what instead of leaving the next person to work it out from a screenshot that never
  // appeared.
  await page.goto(`http://localhost:${PORT}/?subject=${SUBJECTS[0]}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__gate?.ready === true, { timeout: 20000 });
  const harnessSubjects = await page.evaluate(() => window.__gate.subjects);
  const missingHere = harnessSubjects.filter((s) => !SUBJECTS.includes(s));
  const missingThere = SUBJECTS.filter((s) => !harnessSubjects.includes(s));
  if (missingHere.length > 0 || missingThere.length > 0) {
    throw new Error(
      `gate subject lists disagree. In tools/gate/gateScene.ts but not tools/sceneGate.mjs: ` +
        `[${missingHere.join(", ")}]. In tools/sceneGate.mjs but not gateScene.ts: ` +
        `[${missingThere.join(", ")}].`,
    );
  }

  for (const subject of SUBJECTS) {
    await page.goto(`http://localhost:${PORT}/?subject=${subject}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__gate?.ready === true, { timeout: 20000 });

    const metrics = await page.evaluate(() => window.__gate.metrics());
    const signature = await page.evaluate(() => window.__gate.signature());
    nextMetrics[subject] = metrics;
    nextSignatures[subject] = signature;

    // Always written, baseline update or not: a failure is only reviewable if the render that
    // produced it is on disk next to the reference.
    await page.screenshot({ path: resolve(OUT_DIR, `${subject}.png`) });

    if (UPDATE) {
      await page.screenshot({ path: resolve(BASELINE_DIR, `${subject}.png`) });
      console.log(`  BASELINE - ${subject} (${metrics.triangles} tris, ${metrics.vertices} verts)`);
      continue;
    }

    const baseM = baselineMetrics[subject];
    const baseS = baselineSignatures[subject];
    if (!baseM || !baseS) {
      failures.push(`${subject}: no baseline (run: npm run gate -- --update-baseline)`);
      console.log(`  FAIL - ${subject} has no baseline`);
      continue;
    }

    const metricFailures = compareMetrics(baseM, metrics);
    const sig = compareSignature(baseS, signature);

    if (metricFailures.length === 0 && sig.ok) {
      console.log(`  PASS - ${subject} (signature mean delta ${sig.meanDelta.toFixed(2)})`);
      continue;
    }
    for (const f of metricFailures) {
      failures.push(`${subject}: ${f}`);
      console.log(`  FAIL - ${subject}: ${f}`);
    }
    if (!sig.ok) {
      const detail = `signature mean delta ${sig.meanDelta.toFixed(2)} (max ${sig.maxDelta}) over threshold`;
      failures.push(`${subject}: ${detail}`);
      console.log(`  FAIL - ${subject}: ${detail}`);
    }
  }

  if (UPDATE) {
    writeFileSync(resolve(BASELINE_DIR, "metrics.json"), `${JSON.stringify(nextMetrics, null, 2)}\n`);
    writeFileSync(resolve(BASELINE_DIR, "signatures.json"), `${JSON.stringify(nextSignatures)}\n`);
    console.log(`\nBASELINE UPDATED -> ${BASELINE_DIR}`);
    console.log("Review the PNGs before committing: a baseline is only as good as the eyes that approved it.");
  }

  if (!UPDATE) {
    console.log(`\n${failures.length === 0 ? "GATE PASS" : `GATE FAIL (${failures.length})`}`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  }
} finally {
  await browser.close();
  server.kill();
}
