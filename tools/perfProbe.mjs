/**
 * Frame time, draw calls and ground tiles over a scripted drive, on the built game.
 *
 * A measurement, not a check: it prints numbers and exits 0. It exists so a performance change
 * can be stated as before-and-after figures from one tool on one machine rather than from
 * impressions. It reads only `renderer.info` and the `__teetimeturrets` hook, both of which have
 * existed since before Stage 3, so it runs against an older build too.
 *
 * Usage: vite build && node tools/perfProbe.mjs                (serves dist on 4174)
 *        node tools/perfProbe.mjs http://localhost:5174 [dir]  (an already-running server;
 *                                                               [dir] is the dist to size chunks in)
 * Options (env): PERF_QUALITY=low|med|high sets the settings' quality before the match, on a build
 * that has one. PERF_DRIVE_S sets the drive (default 30). PERF_HEADFUL=1 opens a real window,
 * which on a desktop means the real GPU rather than headless Chrome's.
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer";

const PORT = 4174;
const URL = process.argv[2] ?? `http://localhost:${PORT}`;
const DIST = resolve(process.argv[3] ?? "dist");
const OWNS_SERVER = process.argv[2] === undefined;
const DRIVE_S = Number(process.env.PERF_DRIVE_S ?? 30);
const QUALITY = process.env.PERF_QUALITY ?? null;

let server = null;
if (OWNS_SERVER) {
  server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`preview server did not start at ${URL}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
process.on("exit", () => {
  if (server !== null) {
    try {
      process.kill(-server.pid);
    } catch {
      /* already gone */
    }
  }
});

const chunks = (() => {
  try {
    const dir = join(DIST, "assets");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ file: f, kB: Math.round(statSync(join(dir, f)).size / 1024) }))
      .sort((a, b) => b.kB - a.kB);
  } catch {
    return [];
  }
})();

const browser = await puppeteer.launch({
  headless: process.env.PERF_HEADFUL ? false : true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
// A Retina laptop's shape: what DPR capping is for.
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("pageerror:", String(e)));

// Skip the first-match controls card (see docs/HANDOFF.md, Traps), and pick a preset if asked.
await page.evaluateOnNewDocument((quality) => {
  const settings = { version: 1, seenControls: true };
  try {
    const saved = JSON.parse(localStorage.getItem("teetimeturrets.settings") ?? "null");
    if (saved && typeof saved === "object") Object.assign(settings, saved, { seenControls: true });
  } catch {
    /* fresh profile */
  }
  if (quality) settings.quality = quality;
  localStorage.setItem("teetimeturrets.settings", JSON.stringify(settings));
}, QUALITY);

const t0 = Date.now();
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__teetimeturrets?.screen === "title", { timeout: 60000 });
const titleMs = Date.now() - t0;

async function play() {
  const start = Date.now();
  await page.evaluate(() => {
    [...document.querySelectorAll("#screens .title__menu .btn")].find((b) => b.textContent === "PLAY").click();
  });
  await page.waitForFunction(() => window.__teetimeturrets.screen === "match", { timeout: 120000, polling: 20 });
  const matchMs = Date.now() - start;
  await page.waitForFunction(
    () => {
      const { sim } = window.__teetimeturrets;
      return sim !== null && sim.match.remaining < sim.match.durationS - 0.1;
    },
    { timeout: 120000, polling: 50 },
  );
  return { matchMs, firstTickMs: Date.now() - start };
}

const gpu = await page.evaluate(() => {
  const gl = window.__teetimeturrets.renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
const first = await play();

// Frame times from the page's own clock, and a sample of the counters every half second.
await page.evaluate(() => {
  window.__perf = { frames: [], work: [], samples: [] };
  // The frame's work, CPU and GPU both: the draw, then `gl.finish` so the GPU has actually done
  // it. A rAF interval alone reads 16.7 ms whenever the work fits, which says nothing about how much
  // room is left. The finish costs a little itself, so this is a slight over-estimate, the same way
  // on every build.
  const hook = window.__teetimeturrets;
  const gl = hook.renderer.getContext();
  const draw = hook.screens.draw.bind(hook.screens);
  hook.screens.draw = (alpha) => {
    const start = performance.now();
    draw(alpha);
    gl.finish();
    window.__perf.work.push(performance.now() - start);
  };
  let last = performance.now();
  const tick = (now) => {
    window.__perf.frames.push(now - last);
    last = now;
    if (window.__perf.frames.length < 100000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const sample = () =>
  page.evaluate(() => {
    const hook = window.__teetimeturrets;
    const info = hook.renderer.info;
    const ground = hook.render?.courseGround;
    let meshes = 0;
    hook.render?.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) meshes++;
    });
    const tiles = ground ? ground.group.children.length : 0;
    window.__perf.samples.push({
      calls: info.render.calls,
      triangles: info.render.triangles,
      meshes,
      nearVisible: ground?.nearTileCount ?? null,
      // Every mesh in the ground group is a tile level; this build's own count when it has one.
      nearResident: ground?.residentNearTiles ?? null,
      groundMeshes: tiles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: hook.renderer.getPixelRatio(),
    });
  });

// A drive: forward the whole time, weaving, so the camera crosses several tiles.
await page.keyboard.down("w");
const steer = ["a", "d"];
const end = Date.now() + DRIVE_S * 1000;
let s = 0;
while (Date.now() < end) {
  const key = steer[s++ % 2];
  await page.keyboard.down(key);
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 500));
    await sample();
  }
  await page.keyboard.up(key);
  await new Promise((r) => setTimeout(r, 1000));
  await sample();
}
await page.keyboard.up("w");

const perf = await page.evaluate(() => window.__perf);

// A second PLAY from the title, on the same page: what a player waits for after the first match.
await page.evaluate(() => window.__teetimeturrets.screens.show("title"));
await page.waitForFunction(() => window.__teetimeturrets.screen === "title");
const second = await play();

await browser.close();

const work = perf.work.slice(30).sort((a, b) => a - b);
const frames = perf.frames.slice(30).sort((a, b) => a - b); // drop the first half-second of compiles
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : NaN);
const calls = perf.samples.map((x) => x.calls).sort((a, b) => a - b);
const last = perf.samples[perf.samples.length - 1] ?? {};
const max = (key) => Math.max(...perf.samples.map((x) => x[key] ?? -1));

console.log(JSON.stringify(
  {
    url: URL,
    quality: QUALITY,
    pixelRatio: last.pixelRatio,
    titleMs,
    firstPlayMs: first.matchMs,
    firstPlayToFirstTickMs: first.firstTickMs,
    secondPlayMs: second.matchMs,
    frameMs: {
      median: +pct(frames, 0.5).toFixed(2),
      p95: +pct(frames, 0.95).toFixed(2),
      p99: +pct(frames, 0.99).toFixed(2),
      frames: frames.length,
    },
    workMs: {
      median: +pct(work, 0.5).toFixed(2),
      p95: +pct(work, 0.95).toFixed(2),
      p99: +pct(work, 0.99).toFixed(2),
    },
    gpu,
    drawCalls: { median: pct(calls, 0.5), max: calls[calls.length - 1] },
    triangles: last.triangles,
    meshes: last.meshes,
    groundMeshesMax: max("groundMeshes"),
    nearResidentMax: max("nearResident"),
    nearVisibleMax: max("nearVisible"),
    geometries: last.geometries,
    textures: last.textures,
    chunks,
  },
  null,
  2,
));
process.exit(0);
