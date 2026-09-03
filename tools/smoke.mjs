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
      ammo: sim.cart.ammo,
      health: sim.cart.health.hp,
      dead: sim.cart.dead,
      // The highest-flying active pooled ball. Cart-mode shots are pooled bodies, not Sim.ball,
      // so this is the only honest way to ask "did a ball leave the muzzle".
      topPooledBallY: (() => {
        const stride = 8;
        let best = null;
        for (let i = 0; i < sim.currentPoolTransforms.length; i += stride) {
          if (sim.currentPoolTransforms[i + 7] !== 1) continue;
          const y = sim.currentPoolTransforms[i + 1];
          if (best === null || y > best) best = y;
        }
        return best;
      })(),
      hudCombatHidden: document.getElementById("hud-combat").hidden,
      hudAmmo: document.getElementById("ammo-count").textContent,
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

console.log("=== FIRE WHILE DRIVING (F) ===");
// Cart-mode fire is propulsion first: recoil opposes the shot, so firing shoves the cart. It
// costs no stroke whether or not a ball spawns, because Sim.strokes only moves on death, water
// and a stationary launch. Both assertions below still hold; only the reason has changed.
const strokesBefore = putter.strokes;
const cartBeforeShot = putter.cart;
await hold(page, "KeyF", 900);
await new Promise((r) => setTimeout(r, 400));
const fired = await read();
const shoved = Math.hypot(fired.cart.x - cartBeforeShot.x, fired.cart.z - cartBeforeShot.z);
check("blank costs no stroke", fired.strokes === strokesBefore, `strokes ${fired.strokes}`);
check("blank still shoves the cart (recoil propulsion)", shoved > 0.2, `${shoved.toFixed(2)} m`);

console.log("=== RESET AND RELOAD ===");
await page.keyboard.press("KeyR");
await new Promise((r) => setTimeout(r, 1200));
const readyState = await read();
check("cart is back in cart mode after reset", readyState.mode === "cart", readyState.mode);
check("cart has ammo to fire", readyState.ammo > 0, `ammo ${readyState.ammo}`);
check("health is restored by a reset", readyState.health > 0, `hp ${readyState.health}`);

// Swing the turret off-axis and pick the driver before the shot: dead astern the barrel is
// foreshortened to nothing, and the club-as-barrel is the whole point of the silhouette.
await page.keyboard.press("Digit3");
await hold(page, "KeyE", 620);
await new Promise((r) => setTimeout(r, 250));

mkdirSync(dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
console.log(`  screenshot -> ${SHOT}`);

console.log("=== FIRE FROM THE MUZZLE ===");
// Cart mode fires pooled balls off an ammo counter, not Sim.ball off the turf, and a cart-mode
// shot is not a stroke -- Sim.strokes only moves on death, water, and a stationary launch. The
// assertions here are the mechanic that exists, not the pre-ammo one they replaced.
const ammoBefore = readyState.ammo;
const groundBefore = readyState.cart.y;
await hold(page, "KeyF", 1600);
await new Promise((r) => setTimeout(r, 120));
const shot = await read();
check("firing spends a round of ammo", shot.ammo === ammoBefore - 1, `${ammoBefore} -> ${shot.ammo}`);
check("a pooled ball is in flight", shot.topPooledBallY !== null, `y=${shot.topPooledBallY}`);
check(
  "the ball leaves from above the cart, not from the ground",
  shot.topPooledBallY !== null && shot.topPooledBallY > groundBefore,
  `ball y=${shot.topPooledBallY?.toFixed(2)} vs cart y=${groundBefore.toFixed(2)}`,
);

console.log("=== COMBAT HUD ===");
check("health and ammo are visible in cart mode", shot.hudCombatHidden === false);
check("the ammo card matches the sim", shot.hudAmmo === String(shot.ammo), `${shot.hudAmmo} vs ${shot.ammo}`);
await page.keyboard.press("KeyC");
await new Promise((r) => setTimeout(r, 200));
const standing = await read();
check("health and ammo hide in stationary mode", standing.hudCombatHidden === true);

check("no console errors during the session", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
server?.kill();

console.log(`\n${failures.length === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures.length}): ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
