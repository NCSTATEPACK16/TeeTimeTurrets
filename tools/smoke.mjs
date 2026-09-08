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
await page.goto(URL, { waitUntil: "networkidle0" });
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
check(
  "shows the four actions from image 10",
  JSON.stringify(title.labels) === JSON.stringify(["PLAY", "CLUBHOUSE", "MULTIPLAYER", "SETTINGS"]),
  title.labels.join(" / "),
);
// ROADMAP.md: buttons for unbuilt screens are visibly disabled, not dead. A button that looks
// alive and does nothing is the failure this asserts against. PLAY and CLUBHOUSE are built;
// MULTIPLAYER and SETTINGS are not, and must read as "not yet" rather than silently do nothing.
check(
  "built screens are live and unbuilt ones are disabled, not absent",
  JSON.stringify(title.disabled) === JSON.stringify([false, false, true, true]),
  JSON.stringify(title.disabled),
);
check("no sim exists before PLAY is pressed", title.simBeforePlay === null, String(title.simBeforePlay));
check("shows a version string", typeof title.version === "string" && title.version.length > 0, title.version);

await page.evaluate(() => {
  [...document.querySelectorAll("#screens .title__menu .btn")].find((b) => b.textContent === "PLAY").click();
});
await page.waitForFunction(() => window.__teetimeturrets.sim !== null, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 600));
check("PLAY starts a round", (await page.evaluate(() => window.__teetimeturrets.screen)) === "round");

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
      nameplates: document.querySelectorAll("#nameplates .nameplate").length,
      // These three can only be produced by the per-frame draw path (Nameplates.setPlate), never
      // by the constructor alone: a plate is built `hidden = true` with no transform and a
      // 100% fill, so a element-count check on its own cannot tell "wired up" from "built and
      // never touched again".
      firstPlateHidden: document.querySelector("#nameplates .nameplate")?.hidden ?? null,
      firstPlateTransform: document.querySelector("#nameplates .nameplate")?.style.transform ?? null,
      firstPlateFillWidth: document.querySelector("#nameplates .nameplate-fill")?.style.width ?? null,
      hudCombatHidden: document.getElementById("hud-combat").hidden,
      hudAmmo: document.getElementById("ammo-count").textContent,
      cart: { ...sim.cart.position },
      ball: { ...sim.current.position },
      heading: sim.cart.heading,
      turretYaw: sim.cart.turretYaw,
      turretOffset: sim.cart.turretOffset,
      hudClub: document.getElementById("hud-club").textContent,
      resultsHidden: document.getElementById("match-results").hidden,
      timer: document.getElementById("hud-timer").textContent,
    };
  });

const boot = await read();
check("starts in cart mode", boot.mode === "cart", boot.mode);

// Nothing below this line, and no unit test, can see a course whose geometry has gone NaN: the
// sim keeps running, the HUD keeps counting, and the renderer keeps clearing to the sky colour
// while every vertex it is handed is NaN, so the page looks like a plain blue rectangle. That is
// what shipped when `WOODS_OFFSET_M` read an uninitialised `WOODS_WEIGHT` across an import cycle
// (see the constant's comment in src/sim/terrain.ts). Checked against the *bundle*, because the
// bug only exists in the bundle -- vitest's module order differs and never reproduces it.
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
  const position = render.ground.mesh.geometry.getAttribute("position").array;
  let nanVertexComponents = 0;
  for (let i = 0; i < position.length; i++) if (!Number.isFinite(position[i])) nanVertexComponents++;
  return { bad: bad.slice(0, 6), badCount: bad.length, nanVertexComponents };
});
check(
  "every hole's placed hazards have finite coordinates",
  geometry.badCount === 0,
  geometry.badCount === 0 ? "18 holes" : `${geometry.badCount}: ${geometry.bad.join(", ")}`,
);
check(
  "the ground mesh has no NaN vertices",
  geometry.nanVertexComponents === 0,
  `${geometry.nanVertexComponents} NaN components`,
);

console.log("=== DRIVE (W) ===");
const before = boot.cart;
await hold(page, "KeyW", 1600);
await new Promise((r) => setTimeout(r, 150));
const driven = await read();
const moved = Math.hypot(driven.cart.x - before.x, driven.cart.z - before.z);
check("cart moves under throttle", moved > 3, `${moved.toFixed(1)} m`);
// `y` arrives as null when the page's value was NaN -- page.evaluate serialises it through JSON.
// Formatting it unguarded threw a TypeError out of the whole run, which turned the one check that
// catches a NaN'd height field into a crash with no FAIL line. Report it instead.
check("cart does not fall through the world", Number.isFinite(driven.cart.y) && driven.cart.y > -20, `y=${Number.isFinite(driven.cart.y) ? driven.cart.y.toFixed(2) : String(driven.cart.y)}`);

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
check("cart-mode fire costs no stroke", fired.strokes === strokesBefore, `strokes ${fired.strokes}`);
check("firing shoves the cart (recoil propulsion)", shoved > 0.2, `${shoved.toFixed(2)} m`);

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
check("health and ammo are always visible", shot.hudCombatHidden === false);
check("the ammo card matches the sim", shot.hudAmmo === String(shot.ammo), `${shot.hudAmmo} vs ${shot.ammo}`);

console.log("=== NAMEPLATES ===");
// H13's data source is remote cart positions (docs/UI-SPEC.md) -- the player's own cart is never
// plated -- so with the default single bot there is exactly one plate, not one per cart.
const plated = await read();
check("one nameplate per remote cart", plated.nameplates === 1, `${plated.nameplates}`);

// The count above is satisfied by Nameplates' constructor alone and proves nothing about the
// per-frame path (main.ts's drawNameplates / RenderScene.projectToScreen / Nameplates.setPlate).
// These three assert on state only that path can produce.
check("bot's plate is not hidden while the bot is on screen", plated.firstPlateHidden === false, `${plated.firstPlateHidden}`);

// The browser's CSSOM normalizes the trailing unitless "0" in translate3d(...) to "0px" when it
// serializes style.transform back out, so the third component's unit is optional here.
const transformMatch = plated.firstPlateTransform?.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0(?:px)?\)/) ?? null;
const plateX = transformMatch ? Number(transformMatch[1]) : null;
const plateY = transformMatch ? Number(transformMatch[2]) : null;
check(
  "bot's plate transform places it inside the viewport",
  transformMatch !== null &&
    plateX !== null &&
    plateY !== null &&
    plateX >= 0 &&
    plateX <= canvas.w &&
    plateY >= 0 &&
    plateY <= canvas.h,
  `${plated.firstPlateTransform}`,
);

check(
  "bot's health fill is a percentage width",
  /^\d+%$/.test(plated.firstPlateFillWidth ?? ""),
  `${plated.firstPlateFillWidth}`,
);

// The visible === false branch (a point outside the camera's view) is reachable independent of
// where the bot currently is: a point far behind the chase camera along the cart's own heading is
// guaranteed behind the near plane.
const behindCamera = await page.evaluate(() => {
  const { render, sim } = window.__teetimeturrets;
  const out = { x: 0, y: 0 };
  const heading = sim.cart.heading;
  const forwardX = Math.cos(heading);
  const forwardZ = Math.sin(heading);
  const p = sim.cart.position;
  const visible = render.projectToScreen(p.x - forwardX * 100000, p.y, p.z - forwardZ * 100000, out);
  return visible;
});
check("a point far behind the camera projects as not visible", behindCamera === false, `${behindCamera}`);

console.log("=== MATCH RESULTS ===");
check("results overlay is hidden while the match runs", (await read()).resultsHidden === true);

// Run the clock out rather than waiting three minutes for it.
await page.evaluate(() => {
  window.__teetimeturrets.sim.matchTimeRemaining = 1 / 60;
});
await new Promise((r) => setTimeout(r, 400));
const ended = await page.evaluate(() => {
  const { sim } = window.__teetimeturrets;
  return {
    hidden: document.getElementById("match-results").hidden,
    headline: document.getElementById("results-headline").textContent,
    you: document.getElementById("results-you").textContent,
    bot: document.getElementById("results-bot").textContent,
    strokes: sim.cart.strokesTaken,
    bestBot: sim.bestBotStrokes(),
  };
});
check("results overlay appears when the clock runs out", ended.hidden === false);
check("results overlay names an outcome", ended.headline.length > 0, ended.headline);
// index.html now ships these two spans empty (review round 1: a placeholder "YOU 0"/"BOT 0"
// let the check above pass even with the writer never called). Checking against the sim's own
// numbers also pins the results-you/results-bot id mapping in matchResults.ts -- a swap of
// those two ids would fail one of these two checks.
check("results overlay shows the player's score", ended.you === `YOU ${ended.strokes}`, ended.you);
check(
  "results overlay shows the bot's score",
  ended.bot === (Number.isFinite(ended.bestBot) ? `BOT ${ended.bestBot}` : "BOT —"),
  ended.bot,
);

await page.click("#play-again");
await new Promise((r) => setTimeout(r, 400));
const restarted = await read();
check("play again restarts the match", restarted.resultsHidden === true, `t=${restarted.timer}`);

// ROADMAP.md Phase 1.75's gate, verbatim: "enter and leave every registered screen 20x in a loop
// with no growth in renderer.info.memory (geometries/textures)". This is the check the phase
// exists for, and the one Phase 3.5 repeats against the clubhouse -- a screen that forgets to
// dispose its scene looks completely fine until the twentieth transition.
//
// The title screen is the subject because it is the heaviest thing that can be cycled cheaply: a
// full terrain, ground mesh and instanced tree wood, with no Rapier world to rebuild each time.
// Advancing a hole, through the real button rather than through the module.
//
// This is the wiring session.test.ts cannot reach. That suite proves the Session arithmetic in
// node; what it cannot see is whether main.ts's startRound closure actually asks the session which
// hole to load, because main.ts is boot code with no seam. The defect it replaced lived exactly
// there -- every unit test was green while NEXT HOLE replayed hole 2 forever.
//
// Holing out for real would take a full round per hole, so the completion is fabricated and
// everything after it is the shipped path: the Results screen is entered normally, NEXT HOLE is a
// real click, and the hole that comes back is read off the new Sim's own spec.
console.log("=== HOLE ADVANCE ===");
const advanced = await page.evaluate(async () => {
  const api = window.__teetimeturrets;
  const first = api.sim.terrain.spec.index;

  api.session.completeHole(4);
  api.screens.show("results");
  const next = [...document.querySelectorAll("#screens .results__actions .btn")]
    .find((b) => b.textContent.startsWith("NEXT HOLE"));
  const enabled = next !== undefined && !next.disabled;
  next?.click();

  for (let i = 0; i < 400 && api.screens.activeName !== "round"; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    first,
    enabled,
    second: api.sim.terrain.spec.index,
    holeIndex: api.session.holeIndex,
    card: api.round.card.map((c) => c.strokes),
  };
});
check("NEXT HOLE is offered while the round is unfinished", advanced.enabled === true);
check(
  "NEXT HOLE loads a different hole",
  advanced.second === advanced.first + 1,
  `hole ${advanced.first} -> ${advanced.second}`,
);
check(
  "the finished hole keeps its score on the card",
  advanced.card[0] === 4 && advanced.card[1] === null,
  JSON.stringify(advanced.card.slice(0, 3)),
);
check("the session is on the second hole", advanced.holeIndex === 1, String(advanced.holeIndex));

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
await page.waitForFunction(() => window.__teetimeturrets.screen === "round", { timeout: 30000 });
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
server?.kill();

console.log(`\n${failures.length === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures.length}): ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
