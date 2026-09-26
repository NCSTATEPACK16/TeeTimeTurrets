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
// The game is the arena and nothing else (docs/HANDOFF.md, 2026-09-24): PLAY is the arena, and
// the image-10 menu keeps its other three actions.
check(
  "shows the four actions from image 10",
  JSON.stringify(title.labels) === JSON.stringify(["PLAY", "CLUBHOUSE", "MULTIPLAYER", "SETTINGS"]),
  title.labels.join(" / "),
);
// ROADMAP.md: buttons for unbuilt screens are visibly disabled, not dead or absent.
check(
  "built screens are live and unbuilt ones are disabled, not absent",
  JSON.stringify(title.disabled) === JSON.stringify([false, false, true, true]),
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
await new Promise((r) => setTimeout(r, 600));
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
    const { sim } = window.__teetimeturrets;
    const plates = [...document.querySelectorAll("#nameplates .nameplate")];
    // The first plate the per-frame path has shown. A plate is built `hidden = true` with no
    // transform, fill or distance, so everything read off it can only have been written by
    // Nameplates.setPlate, never by the constructor.
    const shown = plates.find((p) => p.hidden === false) ?? null;
    return {
      club: sim.cart.equippedClub,
      ammo: sim.cart.ammo,
      health: sim.cart.health.hp,
      dead: sim.cart.dead,
      // The highest-flying active pooled ball: the only honest way to ask "did a ball leave".
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
// Ammo is refilled by buckets and by landed balls, so a shot is measured as the decrement across
// the one press, read immediately, not as a final count.
const ammoBefore = putter.ammo;
const cartBeforeShot = putter.cart;
await hold(page, "KeyF", 700);
await new Promise((r) => setTimeout(r, 60));
const shot = await read();
check("firing spends a round of ammo", shot.ammo === ammoBefore - 1, `${ammoBefore} -> ${shot.ammo}`);
check("a pooled ball is in flight", shot.topPooledBallY !== null, `y=${shot.topPooledBallY}`);
check(
  "the ball leaves from above the ground under the cart",
  shot.topPooledBallY !== null && shot.topPooledBallY > cartBeforeShot.y,
  `ball y=${shot.topPooledBallY?.toFixed(2)} vs cart y=${cartBeforeShot.y.toFixed(2)}`,
);

console.log("=== COMBAT HUD ===");
check("health and ammo are always visible", shot.hudCombatHidden === false);
check("the ammo card matches the sim", shot.hudAmmo === String(shot.ammo), `${shot.hudAmmo} vs ${shot.ammo}`);

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

console.log("=== MATCH OVER ===");
// Written on `sim.match.remaining`, the clock itself: `sim.matchTimeRemaining` is a getter with no
// setter, and page.evaluate's sloppy mode would swallow the assignment silently. One tick short of
// zero rather than `match.finish()`, so `Match.tick` ends the match the way a real one ends.
await page.evaluate(() => {
  window.__teetimeturrets.sim.match.remaining = 1 / 60;
});
await page.waitForFunction(() => window.__teetimeturrets.screen === "matchResults", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 300));
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
server?.kill();

console.log(`\n${failures.length === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures.length}): ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
