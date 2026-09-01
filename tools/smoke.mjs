/**
 * Headless smoke check for the layer the unit tests cannot reach: the real browser path from a
 * key event, through KeyboardMouseSource and the InputSource interface, into Sim, and back out
 * to the HUD and the renderer.
 *
 * This is NOT the `tools/sceneGate.mjs` the roadmap asks for in Phase 1 -- there is no geometry
 * baseline and no perceptual diff here. It answers a narrower question: does the thing actually
 * boot and respond to a human pressing keys. Everything about whether the *physics* is right is
 * settled by `npm test` and `npm run probe`, per the AGENTS.md rule that a render check is never
 * evidence about simulation.
 *
 * Usage: npm run smoke  (builds, serves dist, drives it, tears the server down)
 *        node tools/smoke.mjs http://localhost:5173   (against an already-running server)
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";

const PORT = 4173;
const URL = process.argv[2] ?? `http://localhost:${PORT}`;
const SHOT = resolve(process.argv[3] ?? "tools/.smoke-out/cart.png");
/** Only manage a server if the caller did not point us at one they are running themselves. */
const OWNS_SERVER = process.argv[2] === undefined;

let server = null;
if (OWNS_SERVER) {
  server = spawn("npx", ["vite", "preview", "--port", String(PORT)], { stdio: "ignore" });
  await waitForServer(URL, 20000);
}

process.on("exit", () => server?.kill());

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
  throw new Error(`preview server did not start at ${url}`);
}

const failures = [];
function check(name, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  console.log(`  ${status} - ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

/** Hold a key for a wall-clock duration, so the fixed-step loop sees it across many ticks. */
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, ms));
  await page.keyboard.up(key);
}

const browser = await puppeteer.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log(`=== BOOT (${URL}) ===`);
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__teetimeturrets !== undefined, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 600));

const canvas = await page.evaluate(() => {
  const el = document.querySelector("canvas");
  return el ? { w: el.width, h: el.height } : null;
});
check("canvas present and sized", canvas !== null && canvas.w > 0 && canvas.h > 0, canvas && `${canvas.w}x${canvas.h}`);

const read = () =>
  page.evaluate(() => {
    const { sim } = window.__teetimeturrets;
    return {
      mode: sim.mode,
      club: sim.cart.equippedClub,
      strokes: sim.strokes,
      loaded: sim.ballLoaded,
      inReach: sim.ballInReach,
      cart: { ...sim.cart.position },
      ball: { ...sim.current.position },
      heading: sim.cart.heading,
      turretYaw: sim.cart.turretYaw,
      turretOffset: sim.cart.turretOffset,
      hudMode: document.getElementById("hud-mode").textContent,
      hudClub: document.getElementById("hud-club").textContent,
    };
  });

const boot = await read();
check("starts in stationary mode", boot.mode === "stationary", boot.mode);
check("HUD reflects sim mode", boot.hudMode === "STANDING", boot.hudMode);

console.log("=== MODE TOGGLE (C) ===");
await page.keyboard.press("KeyC");
await new Promise((r) => setTimeout(r, 200));
const carted = await read();
check("C switches to cart mode", carted.mode === "cart", carted.mode);
check("HUD follows the mode change", carted.hudMode === "CART", carted.hudMode);

console.log("=== DRIVE (W) ===");
const before = carted.cart;
await hold(page, "KeyW", 1600);
await new Promise((r) => setTimeout(r, 150));
const driven = await read();
const moved = Math.hypot(driven.cart.x - before.x, driven.cart.z - before.z);
check("cart moves under throttle", moved > 3, `${moved.toFixed(1)} m`);
check("cart does not fall through the world", Number.isFinite(driven.cart.y) && driven.cart.y > -20, `y=${driven.cart.y.toFixed(2)}`);

console.log("=== STEER (A) ===");
const headingBefore = driven.heading;
await hold(page, "KeyA", 700);
const steered = await read();
check("steering turns the chassis", Math.abs(steered.heading - headingBefore) > 0.1, `${(steered.heading - headingBefore).toFixed(2)} rad`);

console.log("=== TURRET (E) ===");
const headingAtAim = steered.heading;
await hold(page, "KeyE", 500);
const aimed = await read();
check("aiming swings the turret off the chassis", aimed.turretOffset > 0.1, `offset ${aimed.turretOffset.toFixed(2)} rad`);
check("aiming does not steer the cart", Math.abs(aimed.heading - headingAtAim) < 0.05, `${(aimed.heading - headingAtAim).toFixed(3)} rad`);

console.log("=== CLUB SELECT (1) ===");
await page.keyboard.press("Digit1");
await new Promise((r) => setTimeout(r, 150));
const putter = await read();
check("number row selects a club", putter.club === "putter", putter.club);
check("HUD shows the equipped club", putter.hudClub === "PUTTER", putter.hudClub);

console.log("=== BLANK FIRE (F, driven away from the ball) ===");
// The ball is still back at the tee, so this shot has nothing loaded: it must shove the cart
// without costing a stroke. That is the mechanic the phase exists for, and F is the key that
// makes it usable while a hand is already on WASD.
check("ball is not loaded once driven away from it", putter.loaded === false);
const strokesBefore = putter.strokes;
const cartBeforeShot = putter.cart;
await hold(page, "KeyF", 900);
await new Promise((r) => setTimeout(r, 400));
const fired = await read();
const shoved = Math.hypot(fired.cart.x - cartBeforeShot.x, fired.cart.z - cartBeforeShot.z);
check("blank costs no stroke", fired.strokes === strokesBefore, `strokes ${fired.strokes}`);
check("blank still shoves the cart (recoil propulsion)", shoved > 0.2, `${shoved.toFixed(2)} m`);

console.log("=== BALL ON THE TURRET ===");
await page.keyboard.press("KeyR");
// The tee ball spawns 0.3 m up and needs about half a second to settle before it can be scooped.
await new Promise((r) => setTimeout(r, 1200));
const loadedState = await read();
check("ball rides the turret once settled and in reach", loadedState.loaded === true);
check("cart is back in cart mode after reset", loadedState.mode === "cart", loadedState.mode);

// Swing the turret off-axis and pick the driver before the shot: dead astern the barrel is
// foreshortened to nothing, and the club-as-barrel is the whole point of the silhouette.
await page.keyboard.press("Digit3");
await hold(page, "KeyE", 620);
await new Promise((r) => setTimeout(r, 250));

mkdirSync(dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
console.log(`  screenshot -> ${SHOT}`);

console.log("=== FIRE FROM THE MUZZLE ===");
const groundBefore = loadedState.cart.y;
await hold(page, "KeyF", 1600);
await new Promise((r) => setTimeout(r, 120));
const shot = await read();
check("loaded shot counts a stroke", shot.strokes === 1, `strokes ${shot.strokes}`);
check("ball leaves from above the cart, not from the ground", shot.ball.y > groundBefore, `ball y=${shot.ball.y.toFixed(2)} vs cart y=${groundBefore.toFixed(2)}`);
check("ball unloads after being fired", shot.loaded === false);

check("no console errors during the session", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
server?.kill();

console.log(`\n${failures.length === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures.length}): ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
