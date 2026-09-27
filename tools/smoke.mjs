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
  // A server already answering here would be tested in place of this build: see sceneGate.mjs.
  if (await isServing(URL)) throw new Error(`something is already serving ${URL}; stop it and rerun`);
  server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
  await waitForServer(URL, 20000);
}

/** The whole process group: `npx` -> `sh` -> `vite`, and killing `npx` alone orphans `vite`. */
function stopServer() {
  if (server === null) return;
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
  server = null;
}

process.on("exit", stopServer);

async function isServing(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

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

/**
 * True once the player's cart shows a charge, false after 3 s without one. A trigger is held until
 * this, not for a wall-clock time: on a slow renderer a hold that starts and ends between two
 * ticks' input samples is a press the game never saw.
 */
function chargeBuilt() {
  return page
    .waitForFunction(() => window.__teetimeturrets.sim.cart.charge > 0, { timeout: 3000, polling: 16 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Presses and releases a trigger until a shot leaves, at most `tries` times, and says what happened.
 *
 * Retried because of a game behaviour, not a harness one: when every one of the 32 pooled balls
 * is up in the air at once, `Sim.resolveShot` refunds the round and fires nothing. Since the pool
 * recycles balls rolling on the ground that is rare (6 refusals across eight carts in a measured
 * minute), but it is not impossible. A refusal shows as a charge that built and a shot count that
 * did not move, and is reported in the detail rather than read as the input path failing.
 */
async function fireUntilAShotLeaves(press, release, tries = 10) {
  let refused = 0;
  let charged = false;
  for (let i = 0; i < tries; i++) {
    const before = (await read()).shotsFired;
    await press();
    charged = await chargeBuilt();
    await release();
    const left = await page
      .waitForFunction((n) => window.__teetimeturrets.sim.stats.shotsFired !== n, { timeout: 2000, polling: 16 }, before)
      .then(() => true)
      .catch(() => false);
    if (left) return { fired: true, charged, refused };
    if (!charged) return { fired: false, charged, refused };
    refused++;
    await waitForSimSeconds(0.3);
  }
  return { fired: false, charged, refused };
}

/** Resolves once the sim has stepped `seconds` more of match time: wall time says nothing here. */
async function waitForSimSeconds(seconds) {
  const until = (await page.evaluate(() => window.__teetimeturrets.sim.match.remaining)) - seconds;
  await page.waitForFunction((t) => window.__teetimeturrets.sim.match.remaining <= t, { timeout: 20000, polling: 50 }, until);
}

/** Hold a key for a wall-clock duration, so the fixed-step loop sees it across many ticks. */
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, ms));
  await page.keyboard.up(key);
}

// --no-sandbox/--disable-setuid-sandbox/--disable-dev-shm-usage: see tools/sceneGate.mjs's launch
// call for why these are needed on CI/build containers and why dropping the OS sandbox is fine
// here (the only page ever loaded is this repo's own built output on localhost).
const browser = await puppeteer.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log(`=== BOOT (${URL}) ===`);
// "load", not "networkidle0": on a software-rendered GPU (SwiftShader, as in a cloud container)
// the title backdrop keeps the main thread busy enough that Chrome never reports the network idle,
// though nothing is in flight. The `__teetimeturrets` wait below is the real readiness check.
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__teetimeturrets !== undefined, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 600));

const canvas = await page.evaluate(() => {
  const el = document.querySelector("canvas");
  return el ? { w: el.width, h: el.height } : null;
});
check("canvas present and sized", canvas !== null && canvas.w > 0 && canvas.h > 0, canvas && `${canvas.w}x${canvas.h}`);

// The game now boots to the title screen rather than straight into a hole (Phase 1.75), so every
// in-round check below has to get through it first. That is worth asserting rather than skipping
// past: the title is the first screen a player ever sees.
console.log("=== TITLE SCREEN ===");
const title = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("#screens .title__menu .btn")];
  return {
    screen: window.__teetimeturrets.screen,
    labels: buttons.map((b) => b.textContent),
    disabled: buttons.map((b) => b.disabled),
    simBeforePlay: window.__teetimeturrets.sim,
    version: document.querySelector("#screens .title__version")?.textContent ?? null,
  };
});
check("boots to the title screen", title.screen === "title", title.screen);
// The game is the arena and nothing else (docs/HANDOFF.md, 2026-09-24): PLAY is the arena, and
// the image-10 menu keeps its other three actions.
check(
  "shows the four actions from image 10",
  JSON.stringify(title.labels) === JSON.stringify(["PLAY", "CLUBHOUSE", "MULTIPLAYER", "SETTINGS"]),
  title.labels.join(" / "),
);
// ROADMAP.md: buttons for unbuilt screens are visibly disabled, not dead or absent. SETTINGS is
// built as of Stage 2; MULTIPLAYER is not.
check(
  "built screens are live and unbuilt ones are disabled, not absent",
  JSON.stringify(title.disabled) === JSON.stringify([false, false, true, false]),
  JSON.stringify(title.disabled),
);
check("no sim exists before PLAY is pressed", title.simBeforePlay === null, String(title.simBeforePlay));
check("shows a version string", typeof title.version === "string" && title.version.length > 0, title.version);

const clickTitle = (label) =>
  page.evaluate((l) => {
    [...document.querySelectorAll("#screens .title__menu .btn")].find((b) => b.textContent === l).click();
  }, label);

console.log("=== PLAY (the arena) ===");
// Eighteen holes routed and blended into one heightfield, built for the first time here, so this
// is the one boot path in the file that earns a generous timeout.
await clickTitle("PLAY");
await page.waitForFunction(() => window.__teetimeturrets.screen === "match", { timeout: 30000 });

console.log("=== CONTROLS CARD (first play) ===");
// A fresh browser profile is a first play, so the match opens paused on the controls card. The
// overlay is built by the match screen, never shipped in markup, so only the code can show it.
await page
  .waitForFunction(() => document.getElementById("pause-overlay")?.hidden === false, { timeout: 20000 })
  .catch(() => {});
const card = await page.evaluate(() => ({
  shown: document.getElementById("pause-overlay")?.hidden === false,
  title: document.querySelector("#pause-overlay .pause__title")?.textContent ?? null,
  remaining: window.__teetimeturrets.sim.match.remaining,
  duration: window.__teetimeturrets.sim.match.durationS,
}));
check("the first match opens on the controls card", card.shown && card.title === "HOW TO PLAY", `${card.shown} ${card.title}`);
await new Promise((r) => setTimeout(r, 1500));
const heldClock = await page.evaluate(() => window.__teetimeturrets.sim.match.remaining);
check("the clock does not run behind the card", heldClock === card.duration, `${heldClock} of ${card.duration}`);
await page.keyboard.press("Enter");
// Until the clock moves, no input can: on a software-rendered GPU the match's first frames compile
// shaders for seconds, and a fixed sleep here once let the whole DRIVE hold land before the first
// tick. Wait for the sim itself to have stepped.
await page.waitForFunction(
  () => {
    const { sim } = window.__teetimeturrets;
    return sim !== null && sim.match.remaining < sim.match.durationS - 0.1;
  },
  { timeout: 60000, polling: 100 },
);
const arena = await page.evaluate(() => ({
  screen: window.__teetimeturrets.screen,
  teamScoreHidden: document.getElementById("hud-team-score").hidden,
  teamScoreText: document.getElementById("hud-team-score").textContent,
  pointsHidden: document.getElementById("hud-points").hidden,
}));
check("PLAY starts the match screen", arena.screen === "match", arena.screen);
// index.html ships #hud-team-score empty and hidden, so non-empty text can only be drawHud's.
check(
  "the HUD shows a non-empty team score",
  arena.teamScoreHidden === false && arena.teamScoreText.length > 0,
  `hidden=${arena.teamScoreHidden} text="${arena.teamScoreText}"`,
);
check("the HUD shows the kills readout", arena.pointsHidden === false, `hidden=${arena.pointsHidden}`);

const read = () =>
  page.evaluate(() => {
    const { sim, render } = window.__teetimeturrets;
    const plates = [...document.querySelectorAll("#nameplates .nameplate")];
    // The first plate the per-frame path has shown. A plate is built `hidden = true` with no
    // transform, fill or distance, so everything read off it can only have been written by
    // Nameplates.setPlate, never by the constructor.
    const shown = plates.find((p) => p.hidden === false) ?? null;
    return {
      club: sim.cart.equippedClub,
      ammo: sim.cart.ammo,
      charge: sim.cart.charge,
      // The player's shots that put a ball in the air. Unlike ammo, a pickup cannot move it, so a
      // shot and a landed ball collected in the same window cannot cancel out.
      shotsFired: sim.stats.shotsFired,
      health: sim.cart.health.hp,
      dead: sim.cart.dead,
      // The highest of the player's own balls in the air: bots fire from the first second, so any
      // ball in flight says nothing about the player's shot. `ballPool` is TS-private, not hidden.
      topPlayerBallY: (() => {
        let best = null;
        for (const b of sim.ballPool.all) {
          if (b.state !== "flying" || b.firedBy !== 0) continue;
          const y = b.body.translation().y;
          if (best === null || y > best) best = y;
        }
        return best;
      })(),
      bots: sim.bots.length,
      nameplates: plates.length,
      shownPlateTransform: shown?.style.transform ?? null,
      shownPlateFillWidth: shown?.querySelector(".nameplate-fill")?.style.width ?? null,
      shownPlateDistance: shown?.querySelector(".nameplate-distance")?.textContent ?? null,
      shownPlateClass: shown?.className ?? null,
      hudCombatHidden: document.getElementById("hud-combat").hidden,
      hudAmmo: document.getElementById("ammo-count").textContent,
      cart: { ...sim.cart.position },
      heading: sim.cart.heading,
      turretOffset: sim.cart.turretOffset,
      camera: render ? { x: render.camera.position.x, z: render.camera.position.z } : null,
      pointerLocked: document.pointerLockElement === document.querySelector("canvas"),
      hudClub: document.getElementById("hud-club").textContent,
      timer: document.getElementById("hud-timer").textContent,
    };
  });

// No unit test can see a course whose geometry has gone NaN in the *bundle*: the sim keeps
// running and the renderer clears to sky colour. That shipped once, when `WOODS_OFFSET_M` read an
// uninitialised constant across an import cycle (src/sim/terrain.ts), and only the bundle's
// module order reproduced it.
console.log("=== COURSE GEOMETRY IS FINITE ===");
const geometry = await page.evaluate(() => {
  const { course, render } = window.__teetimeturrets;
  const bad = [];
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  course.holes.forEach((hole, i) => {
    for (const b of hole.bunkers) {
      if (!finite(b.x) || !finite(b.z) || !finite(b.radiusX) || !finite(b.radiusZ) || !finite(b.rotation)) {
        bad.push(`hole ${i} bunker`);
      }
    }
    for (const poly of hole.water) {
      for (const p of poly.points) if (!finite(p.x) || !finite(p.z)) bad.push(`hole ${i} water`);
    }
    for (const p of [hole.tee, hole.cup, hole.green]) {
      if (!finite(p.x) || !finite(p.z)) bad.push(`hole ${i} anchor`);
    }
  });
  // Every mesh the match scene holds, not one named ground mesh: the course ground is tiled.
  let meshes = 0;
  let vertices = 0;
  let nanVertexComponents = 0;
  render.scene.traverse((o) => {
    const position = o.isMesh ? o.geometry?.getAttribute("position") : null;
    if (!position) return;
    meshes++;
    vertices += position.count;
    for (let i = 0; i < position.array.length; i++) if (!Number.isFinite(position.array[i])) nanVertexComponents++;
  });
  return { bad: bad.slice(0, 6), badCount: bad.length, meshes, vertices, nanVertexComponents };
});
check(
  "every hole's placed hazards have finite coordinates",
  geometry.badCount === 0,
  geometry.badCount === 0 ? "18 holes" : `${geometry.badCount}: ${geometry.bad.join(", ")}`,
);
// Guard against the check below passing vacuously on an empty scene.
check("the match scene holds ground geometry", geometry.vertices > 10000, `${geometry.meshes} meshes, ${geometry.vertices} vertices`);
check("no mesh in the match scene has NaN vertices", geometry.nanVertexComponents === 0, `${geometry.nanVertexComponents} NaN components`);

// Since bots got their minds (Stage 1.8) they close on the player's spawn and kill an idle cart
// in well under the time these checks take -- 7 HP to 0 during the FIRE section, twice in two
// runs. A dead cart takes no input, so every control check below would really be asking whether
// the bots missed. The harness holds the player at full health until MATCH OVER; nothing checked
// in between is about health.
console.log("  (harness) the player's cart is held at full health until MATCH OVER");
await page.evaluate(() => {
  window.__smokeKeepAlive = setInterval(() => {
    const cart = window.__teetimeturrets.sim?.cart;
    if (cart && !cart.dead) cart.health.hp = cart.health.max;
  }, 16);
});

const boot = await read();

console.log("=== DRIVE (W) ===");
await hold(page, "KeyW", 1600);
await new Promise((r) => setTimeout(r, 150));
const driven = await read();
const moved = Math.hypot(driven.cart.x - boot.cart.x, driven.cart.z - boot.cart.z);
check("cart moves under throttle", moved > 3, `${moved.toFixed(1)} m`);
// `y` arrives as null when the page's value was NaN (page.evaluate serialises through JSON).
check(
  "cart does not fall through the world",
  Number.isFinite(driven.cart.y) && driven.cart.y > -20,
  `y=${Number.isFinite(driven.cart.y) ? driven.cart.y.toFixed(2) : String(driven.cart.y)}`,
);

console.log("=== STEER (A) ===");
await hold(page, "KeyA", 700);
const steered = await read();
check("steering turns the chassis", Math.abs(steered.heading - driven.heading) > 0.1, `${(steered.heading - driven.heading).toFixed(2)} rad`);

console.log("=== TURRET (E) ===");
await hold(page, "KeyE", 500);
const aimed = await read();
check("aiming swings the turret off the chassis", Math.abs(aimed.turretOffset) > 0.1, `offset ${aimed.turretOffset.toFixed(2)} rad`);
check("aiming does not steer the cart", Math.abs(aimed.heading - steered.heading) < 0.05, `${(aimed.heading - steered.heading).toFixed(3)} rad`);

console.log("=== TURRET CAMERA ===");
// The chase camera sits behind the turret, not the chassis (render/chaseCamera.ts). Its unit test
// covers the pose math; this is the rendered camera, read after it has had time to ease in. The
// turret is ~0.8 rad off the chassis here, so the two answers are far apart.
await new Promise((r) => setTimeout(r, 1500));
const framed = await read();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lookYaw = Math.atan2(framed.cart.z - framed.camera.z, framed.cart.x - framed.camera.x);
const offTurret = Math.abs(wrap(lookYaw - (framed.heading + framed.turretOffset)));
const offChassis = Math.abs(wrap(lookYaw - framed.heading));
check(
  "the camera looks along the turret, not the chassis",
  offTurret < 0.15 && offChassis > 0.4,
  `${offTurret.toFixed(2)} rad off the turret, ${offChassis.toFixed(2)} rad off the chassis`,
);

console.log("=== PAUSE (Esc) ===");
// Not pointer-locked yet (that is MOUSE FIRE's), so the key reaches the page.
await page.keyboard.press("Escape");
await page
  .waitForFunction(() => document.getElementById("pause-overlay")?.hidden === false, { timeout: 5000 })
  .catch(() => {});
const pausedAt = await page.evaluate(() => ({
  shown: document.getElementById("pause-overlay")?.hidden === false,
  title: document.querySelector("#pause-overlay .pause__title")?.textContent ?? null,
  remaining: window.__teetimeturrets.sim.match.remaining,
}));
check("Esc pauses on the pause overlay", pausedAt.shown && pausedAt.title === "PAUSED", `${pausedAt.shown} ${pausedAt.title}`);
await new Promise((r) => setTimeout(r, 1000));
const pausedLater = await page.evaluate(() => window.__teetimeturrets.sim.match.remaining);
check("the clock stops while paused", pausedLater === pausedAt.remaining, `${pausedAt.remaining} -> ${pausedLater}`);
await page.keyboard.press("Escape");
const resumed = await waitForSimSeconds(0.2).then(
  () => true,
  () => false,
);
const overlayAfter = await page.evaluate(() => document.getElementById("pause-overlay")?.hidden === false);
check("Esc again resumes", resumed && !overlayAfter, `clock moving ${resumed}, overlay ${overlayAfter}`);

console.log("=== CLUB SELECT (3, then 1) ===");
// Select away and back, so the putter check cannot pass on a cart that simply spawned with it.
await page.keyboard.press("Digit3");
await new Promise((r) => setTimeout(r, 150));
const driver = await read();
check("3 selects the driver", driver.club === "driver" && driver.hudClub === "DRIVER", `${driver.club} / ${driver.hudClub}`);
await page.keyboard.press("Digit1");
await new Promise((r) => setTimeout(r, 150));
const putter = await read();
check("1 selects the putter", putter.club === "putter", putter.club);
check("HUD shows the equipped club", putter.hudClub === "PUTTER", putter.hudClub);

console.log("=== FIRE (F) ===");
// Counted in shots that left, not in ammo: buckets and landed balls refill ammo, and a cart parked
// next to the ball it just fired picks it straight back up.
const cartBeforeShot = putter.cart;
// The bots' magazines are held empty for this section, so the smoke and sound counters below can
// only be moved by the player's shot. Measured with the bots firing, they climbed by hundreds
// between two reads and would have passed with the player's shot doing nothing.
await page.evaluate(() => {
  window.__smokeQuietBots = setInterval(() => {
    for (const bot of window.__teetimeturrets.sim?.bots ?? []) bot.ammo = 0;
  }, 16);
});
await new Promise((r) => setTimeout(r, 1500)); // let any bot shot already in the air finish
const juiceBefore = await page.evaluate(() => ({
  puffs: window.__teetimeturrets.render.effects.spawned,
  cues: window.__teetimeturrets.audio.stats.byCue.putter ?? 0,
}));
const fShot = await fireUntilAShotLeaves(
  () => page.keyboard.down("KeyF"),
  () => page.keyboard.up("KeyF"),
);
const shot = await read();
check(
  "F fires a ball",
  fShot.fired,
  `charge ${fShot.charged ? "built" : "never built"}, ${fShot.refused} refused by a full pool`,
);
check("the player's own ball is in flight", shot.topPlayerBallY !== null, `y=${shot.topPlayerBallY}`);
check(
  "the ball leaves from above the ground under the cart",
  shot.topPlayerBallY !== null && shot.topPlayerBallY > cartBeforeShot.y,
  `ball y=${shot.topPlayerBallY?.toFixed(2)} vs cart y=${cartBeforeShot.y.toFixed(2)}`,
);

// Counters, not a live count: a putter's smoke is gone in a third of a second, which a slow
// renderer can spend on one frame.
const juiceAfter = await page.evaluate(() => ({
  puffs: window.__teetimeturrets.render.effects.spawned,
  cues: window.__teetimeturrets.audio.stats.byCue.putter ?? 0,
}));
check("a shot puts smoke at the muzzle", juiceAfter.puffs > juiceBefore.puffs, `${juiceBefore.puffs} -> ${juiceAfter.puffs} puffs`);
check("a shot asks for the putter's report", juiceAfter.cues > juiceBefore.cues, `${juiceBefore.cues} -> ${juiceAfter.cues}`);
await page.evaluate(() => {
  clearInterval(window.__smokeQuietBots);
  for (const bot of window.__teetimeturrets.sim?.bots ?? []) bot.ammo = 30;
});

console.log("=== COMBAT HUD ===");
check("health and ammo are always visible", shot.hudCombatHidden === false);
check("the ammo card matches the sim", shot.hudAmmo === String(shot.ammo), `${shot.hudAmmo} vs ${shot.ammo}`);

console.log("=== MOUSE FIRE (pointer lock) ===");
// The left button is the main trigger, and it only counts while the canvas holds the pointer lock
// (input/KeyboardMouseSource.ts), so the click that takes the lock must not also fire. Counted in
// shots rather than ammo: the cart is sitting next to the ball it just fired, and picks it up.
const beforeLock = await read();
check("the pointer starts unlocked", beforeLock.pointerLocked === false, `${beforeLock.pointerLocked}`);
// Held across real sim time before it is let go, as a person's click is: a click whose down and up
// both land between two ticks cannot fire whatever the guard does, so it would prove nothing. The
// charge is read mid-hold as well as the shots after it, since a full pool can refuse the shot.
await waitForSimSeconds(0.5); // the putter's reload after the F shot
await page.mouse.move(640, 400);
await page.mouse.down({ button: "left" });
await waitForSimSeconds(0.3);
const midClick = await read();
await page.mouse.up({ button: "left" });
await page
  .waitForFunction(() => document.pointerLockElement === document.querySelector("canvas"), { timeout: 3000, polling: 50 })
  .catch(() => {});
await waitForSimSeconds(0.5); // for a stray shot to show
const locked = await read();
check("clicking the canvas takes the pointer lock", locked.pointerLocked === true, `${locked.pointerLocked}`);
const audioRunning = await page.evaluate(() => window.__teetimeturrets.audio.running);
check("a click unlocks the audio", audioRunning === true, `${audioRunning}`);
check(
  "the click that takes the lock does not fire",
  midClick.charge === 0 && locked.shotsFired === beforeLock.shotsFired,
  `charge ${midClick.charge} mid-click, ${beforeLock.shotsFired} -> ${locked.shotsFired} shots`,
);

const leftShot = await fireUntilAShotLeaves(
  () => page.mouse.down({ button: "left" }),
  () => page.mouse.up({ button: "left" }),
);
check(
  "the left button fires",
  leftShot.fired,
  `charge ${leftShot.charged ? "built" : "never built"}, ${leftShot.refused} refused by a full pool`,
);

// Right-click while charging cancels the shot. Asserted on the charge while the left button is still
// held -- a held putter otherwise sits at full charge. Not on "the release then fires nothing": that
// check was written, and stayed green with the cancel disabled, because the full pool refused the
// shot the release did make.
await waitForSimSeconds(0.5);
await page.mouse.down({ button: "left" });
const cancelCharged = await chargeBuilt();
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await waitForSimSeconds(0.2);
const heldAfterCancel = await read();
await page.mouse.up({ button: "left" });
check(
  "a right-click drops the charge while the trigger is still held",
  cancelCharged && heldAfterCancel.charge === 0,
  `charge ${cancelCharged ? "built" : "never built"}, then ${heldAfterCancel.charge}`,
);

// Swing the turret off-axis and pick the driver for the screenshot: dead astern the barrel is
// foreshortened to nothing, and the club-as-barrel is the whole point of the silhouette.
await page.keyboard.press("Digit3");
await hold(page, "KeyE", 620);
await new Promise((r) => setTimeout(r, 250));
mkdirSync(dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
console.log(`  screenshot -> ${SHOT}`);

console.log("=== NAMEPLATES ===");
// H13's data source is remote cart positions (docs/UI-SPEC.md): the player's own cart is never
// plated, so there is one plate per bot.
check("one nameplate per remote cart", shot.nameplates === shot.bots && shot.bots > 0, `${shot.nameplates} plates, ${shot.bots} bots`);

// Wait for the per-frame path to show a plate: that needs a bot on screen and inside coarse
// range, which only the bots' own driving can bring about. Bounded, because bots that never
// arrive are exactly the regression this exists to catch.
const onScreen = await page
  .waitForFunction(() => [...document.querySelectorAll("#nameplates .nameplate")].some((p) => p.hidden === false), {
    timeout: 60000,
    polling: 250,
  })
  .then(() => true)
  .catch(() => false);
check("a bot closes until its plate is on screen", onScreen);

const plated = await read();
// The browser's CSSOM normalises the trailing unitless "0" in translate3d(...) to "0px".
const transformMatch = plated.shownPlateTransform?.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0(?:px)?\)/) ?? null;
check(
  "a shown plate's transform places it inside the viewport",
  transformMatch !== null &&
    Number(transformMatch[1]) >= 0 &&
    Number(transformMatch[1]) <= canvas.w &&
    Number(transformMatch[2]) >= 0 &&
    Number(transformMatch[2]) <= canvas.h,
  `${plated.shownPlateTransform}`,
);
check("a shown plate's health fill is a percentage width", /^\d+%$/.test(plated.shownPlateFillWidth ?? ""), `${plated.shownPlateFillWidth}`);
// The tier grammar from src/ui/plateState.ts: whole metres under 100, `~` and a multiple of 25 out
// to coarse range. A shown plate is inside that range, so an empty string is a failure.
check("a shown plate carries a distance in the tier grammar", /^~?\d+ m$/.test(plated.shownPlateDistance ?? ""), `${plated.shownPlateDistance}`);
check("a shown plate carries a team class", /nameplate-(ally|enemy)/.test(plated.shownPlateClass ?? ""), `${plated.shownPlateClass}`);

// A point far behind the chase camera along the cart's own heading is behind the near plane.
const behindCamera = await page.evaluate(() => {
  const { render, sim } = window.__teetimeturrets;
  const out = { x: 0, y: 0 };
  const p = sim.cart.position;
  return render.projectToScreen(p.x - Math.cos(sim.cart.heading) * 100000, p.y, p.z - Math.sin(sim.cart.heading) * 100000, out);
});
check("a point far behind the camera projects as not visible", behindCamera === false, `${behindCamera}`);

console.log("=== FEEDBACK (kill feed, hit marker, damage flash, score strip) ===");
// Driven through the sim's own handlers, the ones combat.ts calls, so every consumer downstream of
// Sim.events is the real one. The player's hit lands just ahead of the cart along the camera's
// line, which puts its marker on screen.
const feedback = await page.evaluate(async () => {
  const { sim, render } = window.__teetimeturrets;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const p = sim.cart.position;
  const cam = render.camera.position;
  const hx = p.x + (p.x - cam.x);
  const hz = p.z + (p.z - cam.z);
  const onScreen = render.projectToScreen(hx, p.y + 1.5, hz, { x: 0, y: 0 });
  sim.combatContext.onBallHit(0, 1, 2, hx, p.y, hz);
  sim.killCart(sim.bots[0], 1, 0);
  sim.combatContext.onBallHit(2, 0, 1, p.x, p.y, p.z);
  await frame();
  await frame();
  return {
    lines: [...document.querySelectorAll("#kill-feed .kill-line")].filter((l) => !l.hidden).map((l) => l.textContent),
    markers: [...document.querySelectorAll("#hit-markers .hit-marker")].map((m) => m.textContent),
    wedges: [...document.querySelectorAll("#damage-flash .damage-wedge")].map((w) => Number(w.style.opacity || 0)),
    pulse: document.getElementById("score-strip").classList.contains("score-strip--pulse"),
    onScreen,
  };
});
// Anywhere in the feed, not necessarily on top: a bot can make a kill in the same frame.
check("a kill goes in the kill feed", feedback.lines.some((l) => /YOU\s*\u25b8\s*BOT 1/.test(l)), JSON.stringify(feedback.lines));
check(
  "a hit marker shows what the hit scored",
  feedback.markers.includes("+20"),
  `${JSON.stringify(feedback.markers)}, hit point ${feedback.onScreen ? "on" : "OFF"} screen`,
);
check("a hit on the player flashes a wedge", feedback.wedges.some((o) => o > 0.5), JSON.stringify(feedback.wedges));
check("a stroke pulses the score strip", feedback.pulse === true);

console.log("=== MAP (M) ===");
await page.keyboard.press("KeyM");
const mapOpen = await page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  await frame();
  await frame();
  const root = document.querySelector(".course-map");
  const canvas = document.querySelector(".course-map-canvas");
  if (!root || !canvas) return { visible: false, drawn: 0 };
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let drawn = 0;
  for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) drawn++;
  return { visible: !root.hidden, drawn };
});
check("M opens the course map", mapOpen.visible === true);
check("the map draws the course", mapOpen.drawn > 100, `${mapOpen.drawn} painted samples`);
await page.keyboard.press("KeyM");
await page.keyboard.press("KeyM");
const mapClosed = await page.evaluate(() => document.querySelector(".course-map")?.hidden === true);
check("M cycles the map closed again", mapOpen.visible === true && mapClosed === true);

console.log("=== MATCH OVER ===");
await page.evaluate(() => clearInterval(window.__smokeKeepAlive));
// The vignette follows health: off at full, closing in at one point left.
const vignette = await page.evaluate(async () => {
  const { sim } = window.__teetimeturrets;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const read = () => Number(document.getElementById("lowhp-vignette").style.opacity || 0);
  sim.cart.health.hp = sim.cart.health.max;
  await frame();
  await frame();
  const full = read();
  sim.cart.health.hp = 1;
  await frame();
  await frame();
  return { full, low: read() };
});
check("the low-health vignette is off at full health", vignette.full === 0, `${vignette.full}`);
check("and closes in at one point left", vignette.low > 0.5, `${vignette.low}`);
// Written on `sim.match.remaining`, the clock itself: `sim.matchTimeRemaining` is a getter with no
// setter, and page.evaluate's sloppy mode would swallow the assignment silently. One tick short of
// zero rather than `match.finish()`, so `Match.tick` ends the match the way a real one ends.
const lockedAtBuzzer = await read();
await page.evaluate(() => {
  window.__teetimeturrets.sim.match.remaining = 1 / 60;
});
await page.waitForFunction(() => window.__teetimeturrets.screen === "matchResults", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 300));
// docs/TEST-AND-SPEC-PITFALLS.md §5: a held pointer lock leaves the results screen unclickable for
// anyone who aimed with the mouse. Only a check if the lock was held when the buzzer went. Two
// things release it -- the match screen's input source on exit, and the results screen on entry --
// and this asserts the outcome, so it goes red only with both gone.
check("the pointer is still locked when the match ends", lockedAtBuzzer.pointerLocked === true, `${lockedAtBuzzer.pointerLocked}`);
check(
  "the pointer lock is released once the results screen shows",
  (await page.evaluate(() => document.pointerLockElement)) === null,
);
const over = await page.evaluate(() => ({
  screen: window.__teetimeturrets.screen,
  bots: window.__teetimeturrets.sim.bots.length,
  headline: document.querySelector(".arena-results__title")?.textContent ?? null,
  scores: [...document.querySelectorAll(".arena-results__score-value")].map((el) => el.textContent),
  mvp: document.querySelector(".arena-results__mvp")?.textContent ?? null,
  rowNames: [...document.querySelectorAll(".arena-results__row-name")].map((el) => el.textContent),
}));
check("the clock running out routes to the results screen", over.screen === "matchResults", over.screen);
// MatchResultsScreen builds this markup fresh in enter(), so non-empty text is deriveScoreboard's.
check("results names a winner", (over.headline ?? "").length > 0, String(over.headline));
check(
  "results shows both teams' strokes",
  over.scores.length === 2 && over.scores[0].startsWith("US ") && over.scores[1].startsWith("THEM "),
  JSON.stringify(over.scores),
);
check("results names an MVP", (over.mvp ?? "").startsWith("MVP"), String(over.mvp));
check(
  "results lists the whole roster, player first",
  over.rowNames.length === over.bots + 1 && over.rowNames[0] === "YOU",
  `${JSON.stringify(over.rowNames)} for ${over.bots} bots`,
);

await page.click(".arena-results__actions .btn--primary"); // PLAY AGAIN
await page.waitForFunction(() => window.__teetimeturrets.screen === "match", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 400));
const rematch = await page.evaluate(() => ({
  remaining: window.__teetimeturrets.sim.match.remaining,
  over: window.__teetimeturrets.sim.matchOver,
}));
check("PLAY AGAIN resets the match clock", rematch.remaining > 1, `${rematch.remaining}`);
check("PLAY AGAIN resets the match itself", rematch.over === false, `${rematch.over}`);

await page.evaluate(() => window.__teetimeturrets.screens.show("title"));
await new Promise((r) => setTimeout(r, 300));

console.log("=== SETTINGS ===");
await clickTitle("SETTINGS");
await page.waitForFunction(() => window.__teetimeturrets.screen === "settings", { timeout: 10000 }).catch(() => {});
const settingsOut = await page.evaluate(() => {
  const range = document.querySelector('.settings-screen [data-setting="master"]');
  if (!range) return { screen: window.__teetimeturrets.screen, saved: null, live: null };
  range.value = "37";
  range.dispatchEvent(new Event("input", { bubbles: true }));
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("teetimeturrets.settings.v1") ?? "null")?.master ?? null;
  } catch {
    saved = "unreadable";
  }
  return { screen: window.__teetimeturrets.screen, saved, live: window.__teetimeturrets.settings.master };
});
check("SETTINGS opens from the title", settingsOut.screen === "settings", settingsOut.screen);
check("a volume change is saved", settingsOut.saved === 0.37, `${settingsOut.saved}`);
check("and applied at once", settingsOut.live === 0.37, `${settingsOut.live}`);
await page.evaluate(() => [...document.querySelectorAll(".settings-screen .btn")].find((b) => b.textContent === "BACK").click());
await page.waitForFunction(() => window.__teetimeturrets.screen === "title", { timeout: 10000 });

console.log("=== SCREEN LIFECYCLE (Phase 1.75 memory gate) ===");
const leak = await page.evaluate(async () => {
  const { screens, renderer } = window.__teetimeturrets;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // Two warm-up cycles first: the very first entry allocates shared, legitimately cached things
  // (shader programs, the renderer's own internals) that never come back, and counting those as
  // a leak would make the gate cry wolf on a correct implementation.
  for (let i = 0; i < 2; i++) {
    screens.show("title");
    await frame();
  }
  const before = { ...renderer.info.memory };

  for (let i = 0; i < 20; i++) {
    screens.show("title");
    await frame();
  }
  const after = { ...renderer.info.memory };
  return { before, after };
});
check(
  "20 screen entries leak no geometries",
  leak.after.geometries <= leak.before.geometries,
  `${leak.before.geometries} -> ${leak.after.geometries}`,
);
check(
  "20 screen entries leak no textures",
  leak.after.textures <= leak.before.textures,
  `${leak.before.textures} -> ${leak.after.textures}`,
);


// ROADMAP.md Phase 3.5 repeats the same gate against the clubhouse, "now run against the heaviest
// screen". It is the one that builds a cart, a podium, a shadow-mapped three-point rig and a
// floor on every entry, so a missed dispose shows up here first.
const clubhouseLeak = await page.evaluate(async () => {
  const { screens, renderer } = window.__teetimeturrets;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // The clubhouse loads its backdrop GLB asynchronously, so a count taken mid-flight compares
  // "before the backdrop arrived" against "after", and reports the backdrop itself as a leak.
  // Settle first: wait until the geometry count stops moving, so both samples describe the same
  // steady state and any difference between them is a real one.
  // Stable for many consecutive frames, not merely for two: an in-flight fetch leaves the count
  // motionless while it is still on the wire, so a two-frame check returns before the backdrop
  // has arrived and samples a state the next sample will never match.
  const settle = async () => {
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 600; i++) {
      await frame();
      const now = renderer.info.memory.geometries;
      stable = now === last ? stable + 1 : 0;
      last = now;
      if (stable >= 45) return;
    }
  };

  screens.show("clubhouse");
  await settle();
  const before = { ...renderer.info.memory };

  for (let i = 0; i < 20; i++) {
    screens.show("clubhouse");
    await frame();
  }
  await settle();
  return { before, after: { ...renderer.info.memory } };
});
check(
  "20 clubhouse entries leak no geometries",
  clubhouseLeak.after.geometries <= clubhouseLeak.before.geometries,
  `${clubhouseLeak.before.geometries} -> ${clubhouseLeak.after.geometries}`,
);
check(
  "20 clubhouse entries leak no textures",
  clubhouseLeak.after.textures <= clubhouseLeak.before.textures,
  `${clubhouseLeak.before.textures} -> ${clubhouseLeak.after.textures}`,
);

// The cosmetic/stat split from ROADMAP.md, asserted end to end rather than trusted: a tire is the
// one purchase that reaches the physics.
console.log("=== CLUBHOUSE ===");
const club = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".clubhouse__category")];
  const label = (r) => r.querySelector(".clubhouse__category-label").textContent;
  return {
    screen: window.__teetimeturrets.screen,
    categories: rows.map(label),
    clubCards: [...document.querySelectorAll(".club-card__name")].map((n) => n.textContent),
    bars: [...document.querySelectorAll(".club-card")][0]
      ? [...document.querySelectorAll(".club-card")][0]
          .querySelectorAll(".club-card__stat")
          .values()
          .toArray()
          .map((n) => n.textContent)
      : [],
    coins: document.querySelector(".chip span:last-child").textContent,
    confirmDisabled: document.querySelector(".clubhouse__actions .btn--primary").disabled,
  };
});
check(
  "clubhouse lists the three categories from image 11",
  JSON.stringify(club.categories) === JSON.stringify(["TURRET SKIN", "CHASSIS PAINT", "TIRE TYPE"]),
  club.categories.join(" / "),
);
check(
  "clubhouse shows a stat card per club",
  JSON.stringify(club.clubCards) === JSON.stringify(["PUTTER", "IRON", "DRIVER"]),
  club.clubCards.join(" / "),
);
check(
  "each card carries POWER / RANGE / RELOAD",
  JSON.stringify(club.bars) === JSON.stringify(["POWER", "RANGE", "RELOAD"]),
  club.bars.join(" / "),
);
check("clubhouse shows a coin balance", /^\d+$/.test(club.coins), club.coins);
// Preview is not purchase: nothing is selected yet, so there is nothing to confirm.
check("CONFIRM is inert until something changes", club.confirmDisabled === true);

const painted = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".clubhouse__category")];
  const before = window.__teetimeturrets.screens.activeName;
  rows[1].querySelectorAll(".swatch")[1].click(); // a different chassis paint
  const confirm = document.querySelector(".clubhouse__actions .btn--primary");
  return { before, confirmEnabled: !confirm.disabled, label: confirm.textContent };
});
check("selecting a swatch arms CONFIRM with a price", painted.confirmEnabled === true, painted.label);
check("a swatch click does not leave the clubhouse", painted.before === "clubhouse");

// The Phase 3.5 gate, end to end through the real UI: "a purchased tire type measurably changes
// cart handling, proving the cosmetic/stat split is real and not decorative". Paint is appearance
// and must NOT reach the sim; the tire must.
const tireBefore = await page.evaluate(() => window.__teetimeturrets.sim?.cart.tire ?? null);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".clubhouse__category")];
  const tires = rows[2].querySelectorAll(".swatch");
  tires[tires.length - 1].click(); // TURF
  document.querySelector(".clubhouse__actions .btn--primary").click();
  document.querySelector(".clubhouse__actions .btn").click(); // BACK -> title
});
await page.waitForFunction(() => window.__teetimeturrets.screen === "title", { timeout: 10000 });
await page.evaluate(() => {
  [...document.querySelectorAll("#screens .title__menu .btn")].find((b) => b.textContent === "PLAY").click();
});
await page.waitForFunction(() => window.__teetimeturrets.screen === "match", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 400));
// TIRE_TUNING gives turf a different top speed, grip and off-road penalty from street, so the
// tire the cart is actually running is the proof the purchase reached the physics, not the menu.
const tireAfter = await page.evaluate(() => ({ tire: window.__teetimeturrets.sim.cart.tire }));
check(
  "a tire bought in the clubhouse is the tire the sim runs",
  tireAfter.tire === "turf" && tireAfter.tire !== tireBefore,
  `${tireBefore} -> ${tireAfter.tire}`,
);

check("no console errors during the session", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
stopServer();

console.log(`\n${failures.length === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures.length}): ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
